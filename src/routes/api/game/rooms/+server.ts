import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()) ?? [];

interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  createdAt: number;
  createdBy: string;
  createdById?: string;
  isPrivate: boolean;
  phase: 'lobby' | 'playing' | 'ended';
}

interface RoomStatus {
  playerCount: number;
  players: Array<{ id: string; username: string; }>;
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
  isPrivate?: boolean;
  phase?: string;
}

// GET: List all active game rooms
export const GET: RequestHandler = async ({ platform }) => {
  if (!platform?.env?.GAME_DATA || !platform?.env?.GAME_ROOM) {
    return json({
      error: 'Server not configured for multiplayer',
      rooms: []
    }, { status: 503 });
  }

  try {
    // Get list of room IDs from KV
    const roomList = await platform.env.GAME_DATA.list({ prefix: 'room:' });
    const rooms: Array<RoomInfo & RoomStatus> = [];

    // Fetch status for each room
    for (const key of roomList.keys) {
      const roomData = await platform.env.GAME_DATA.get(key.name, 'json') as RoomInfo | null;
      if (!roomData) continue;

      // Get current status from Durable Object
      try {
        const id = platform.env.GAME_ROOM.idFromName(roomData.id);
        const room = platform.env.GAME_ROOM.get(id);
        const statusUrl = new URL('https://internal/status');
        const response = await room.fetch(statusUrl.toString());
        const status = await response.json() as RoomStatus;

        // Use DO's authoritative privacy/phase if available
        const isPrivate = status.isPrivate ?? roomData.isPrivate ?? false;
        const phase = (status.phase as RoomInfo['phase']) ?? roomData.phase ?? 'playing';

        // Rooms that have ended should be cleaned up
        if (phase === 'ended') {
          await platform.env.GAME_DATA.delete(key.name);
          notifyLobbyDelete(platform, roomData.id);
          continue;
        }

        // Only include rooms with players or recently created (within 5 minutes)
        const isRecent = Date.now() - roomData.createdAt < 5 * 60 * 1000;
        if (status.playerCount > 0 || isRecent) {
          // Skip private rooms from public listing
          if (isPrivate) continue;

          rooms.push({
            ...roomData,
            ...status,
            isPrivate,
            phase
          });
        } else {
          // Clean up stale empty rooms
          await platform.env.GAME_DATA.delete(key.name);
          // Notify lobby of removal
          notifyLobbyDelete(platform, roomData.id);
        }
      } catch {
        // Room fetch failed, skip it
        continue;
      }
    }

    return json({ rooms });
  } catch (error) {
    console.error('Failed to list rooms:', error);
    return json({ error: 'Failed to list rooms', rooms: [] }, { status: 500 });
  }
};

// POST: Create a new game room
export const POST: RequestHandler = async ({ platform, request }) => {
  if (!platform?.env?.GAME_DATA || !platform?.env?.GAME_ROOM) {
    return json({
      error: 'Server not configured for multiplayer'
    }, { status: 503 });
  }

  try {
    const body = await request.json() as { name?: string; createdBy?: string; createdById?: string; isPrivate?: boolean; };

    // Generate a unique room ID
    const roomId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const roomName = body.name || `Game ${roomId.slice(-6)}`;
    const isPrivate = body.isPrivate !== undefined ? body.isPrivate : true; // Default to private

    const roomInfo: RoomInfo = {
      id: roomId,
      name: roomName,
      playerCount: 0,
      createdAt: Date.now(),
      createdBy: body.createdBy || 'Anonymous',
      createdById: body.createdById || '',
      isPrivate,
      phase: 'lobby'
    };

    // Store room info in KV (no TTL - rooms persist indefinitely)
    await platform.env.GAME_DATA.put(`room:${roomId}`, JSON.stringify(roomInfo));

    // Configure the Durable Object with host and privacy settings
    try {
      const id = platform.env.GAME_ROOM.idFromName(roomId);
      const room = platform.env.GAME_ROOM.get(id);
      await room.fetch(new Request('https://internal/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: body.createdById || '',
          isPrivate,
          roomCode: roomId
        })
      }));
    } catch {
      // Configuration is best-effort
    }

    // Only notify lobby of new room if it's public
    if (!isPrivate) {
      notifyLobbyUpsert(platform, roomInfo);
    }

    return json({ success: true, room: roomInfo });
  } catch (error) {
    console.error('Failed to create room:', error);
    return json({ error: 'Failed to create room' }, { status: 500 });
  }
};

// DELETE: Delete a game room (super admin or room creator)
export const DELETE: RequestHandler = async ({ platform, request }) => {
  if (!platform?.env?.GAME_DATA || !platform?.env?.GAME_ROOM) {
    return json({ error: 'Server not configured for multiplayer' }, { status: 503 });
  }

  try {
    const body = await request.json() as { roomId?: string; userId?: string; };
    const { roomId, userId } = body;

    if (!roomId || !userId) {
      return json({ error: 'Missing roomId or userId' }, { status: 400 });
    }

    // Allow super admins OR the room creator to delete
    const isSuperAdmin = adminIds.includes(userId);
    let isCreator = false;
    if (!isSuperAdmin) {
      // Check if the user created this room
      const roomData = await platform.env.GAME_DATA.get(`room:${roomId}`, 'json') as RoomInfo | null;
      isCreator = !!roomData && roomData.createdById === userId;
    }
    if (!isSuperAdmin && !isCreator) {
      return json({ error: 'Unauthorized — only the room creator or an admin can delete this room' }, { status: 403 });
    }

    // 1. Terminate the Durable Object FIRST — this stops the game loop and
    //    prevents any further lobby upserts from the room's tick or handlers.
    try {
      const id = platform.env.GAME_ROOM.idFromName(roomId);
      const room = platform.env.GAME_ROOM.get(id);
      await room.fetch(new Request('https://internal/terminate', { method: 'POST' }));
    } catch {
      // Room might already be inactive — continue with cleanup
    }

    // 2. Delete the KV entry
    await platform.env.GAME_DATA.delete(`room:${roomId}`);

    // 3. Notify lobby of removal LAST — this is the final authority, ensuring
    //    any stale upserts from the DO terminate are overridden.
    await notifyLobbyDeleteAsync(platform, roomId);

    return json({ success: true });
  } catch (error) {
    console.error('Failed to delete room:', error);
    return json({ error: 'Failed to delete room' }, { status: 500 });
  }
};

// ── Lobby notification helpers ──

function notifyLobbyUpsert(platform: App.Platform, room: RoomInfo): void {
  if (!platform.env?.GAME_LOBBY) return;
  try {
    const id = platform.env.GAME_LOBBY.idFromName('global');
    const lobby = platform.env.GAME_LOBBY.get(id);
    lobby.fetch(new Request('https://internal/room-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', room })
    })).catch(() => { /* best-effort */ });
  } catch { /* lobby unavailable */ }
}

function notifyLobbyDelete(platform: App.Platform, roomId: string): void {
  if (!platform.env?.GAME_LOBBY) return;
  try {
    const id = platform.env.GAME_LOBBY.idFromName('global');
    const lobby = platform.env.GAME_LOBBY.get(id);
    lobby.fetch(new Request('https://internal/room-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', roomId })
    })).catch(() => { /* best-effort */ });
  } catch { /* lobby unavailable */ }
}

/** Awaitable version of notifyLobbyDelete for critical paths (e.g. admin delete) */
async function notifyLobbyDeleteAsync(platform: App.Platform, roomId: string): Promise<void> {
  if (!platform.env?.GAME_LOBBY) return;
  try {
    const id = platform.env.GAME_LOBBY.idFromName('global');
    const lobby = platform.env.GAME_LOBBY.get(id);
    await lobby.fetch(new Request('https://internal/room-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', roomId })
    }));
  } catch { /* lobby unavailable */ }
}
