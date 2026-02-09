import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  createdAt: number;
  createdBy: string;
}

interface RoomStatus {
  playerCount: number;
  players: Array<{ id: string; username: string; }>;
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
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

        // Only include rooms with players or recently created (within 5 minutes)
        const isRecent = Date.now() - roomData.createdAt < 5 * 60 * 1000;
        if (status.playerCount > 0 || isRecent) {
          rooms.push({
            ...roomData,
            ...status
          });
        } else {
          // Clean up stale empty rooms
          await platform.env.GAME_DATA.delete(key.name);
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
    const body = await request.json() as { name?: string; createdBy?: string; };

    // Generate a unique room ID
    const roomId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const roomName = body.name || `Game ${roomId.slice(-6)}`;

    const roomInfo: RoomInfo = {
      id: roomId,
      name: roomName,
      playerCount: 0,
      createdAt: Date.now(),
      createdBy: body.createdBy || 'Anonymous'
    };

    // Store room info in KV
    await platform.env.GAME_DATA.put(`room:${roomId}`, JSON.stringify(roomInfo), {
      // Auto-expire after 24 hours if not updated
      expirationTtl: 24 * 60 * 60
    });

    return json({ success: true, room: roomInfo });
  } catch (error) {
    console.error('Failed to create room:', error);
    return json({ error: 'Failed to create room' }, { status: 500 });
  }
};
