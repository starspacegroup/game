import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';
import type { LobbyRoomInfo, ArchivedRoomInfo } from '$lib/server/GameLobby';

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

interface Vector3 { x: number; y: number; z: number; }

interface RoomDetail {
  roomCode: string;
  phase: string;
  isPrivate: boolean;
  hostId: string;
  tick: number;
  wave: number;
  puzzleProgress: number;
  puzzleSolved: boolean;
  connectedSockets: number;
  players: Array<{
    id: string;
    username: string;
    avatarUrl?: string;
    position?: Vector3;
    velocity?: Vector3;
    health: number;
    maxHealth?: number;
    score: number;
    speed?: number;
    damageCooldownUntil?: number;
    lastProcessedInput?: number;
  }>;
  asteroids: Array<{
    id: string;
    position: Vector3;
    radius: number;
    health: number;
    maxHealth: number;
    destroyed: boolean;
  }>;
  npcs: Array<{
    id: string;
    position: Vector3;
    health: number;
    maxHealth: number;
    destroyed: boolean;
    converted: boolean;
    conversionProgress: number;
    targetNodeId: string | null;
  }>;
  lasers: Array<{
    id: string;
    ownerId: string;
    life: number;
  }>;
  puzzleNodes: Array<{
    id: string;
    position: Vector3;
    targetPosition: Vector3;
    connected: boolean;
    color: string;
  }>;
  powerUps: Array<{
    id: string;
    position: Vector3;
    type: string;
    collected: boolean;
  }>;
  eventLog: Array<{
    time: number;
    event: string;
    actor?: string;
    detail?: string;
  }>;
}

export const load: PageServerLoad = async ({ locals, platform }) => {
  // Auth guard — only super admins can access
  if (!locals.user || !adminIds.includes(locals.user.id)) {
    throw redirect(302, '/');
  }

  const rooms: Array<RoomInfo & { detail: RoomDetail | null }> = [];
  let archivedRooms: ArchivedRoomInfo[] = [];
  let lobbyRooms: LobbyRoomInfo[] = [];
  let lobbyClients = 0;
  let kvKeyCount = 0;
  const errors: string[] = [];

  if (platform?.env?.GAME_DATA && platform?.env?.GAME_ROOM) {
    try {
      const roomList = await platform.env.GAME_DATA.list({ prefix: 'room:' });
      kvKeyCount = roomList.keys.length;

      // Fetch full detail for all rooms in parallel
      const detailPromises = roomList.keys.map(async (key) => {
        const roomData = await platform.env.GAME_DATA.get(key.name, 'json') as RoomInfo | null;
        if (!roomData) return null;

        let detail: RoomDetail | null = null;
        try {
          const doId = platform.env.GAME_ROOM.idFromName(roomData.id);
          const room = platform.env.GAME_ROOM.get(doId);
          const response = await room.fetch('https://internal/admin-detail');
          detail = await response.json() as RoomDetail;
        } catch (e) {
          errors.push(`Room ${roomData.id}: ${e}`);
        }

        return { ...roomData, detail };
      });

      const results = await Promise.allSettled(detailPromises);
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          rooms.push(result.value);
        }
      }
    } catch (e) {
      errors.push(`KV list failed: ${e}`);
    }
  } else {
    errors.push('Platform bindings not available (GAME_DATA / GAME_ROOM)');
  }

  // Fetch lobby data (all rooms + archived)
  if (platform?.env?.GAME_LOBBY) {
    try {
      const lobbyId = platform.env.GAME_LOBBY.idFromName('global');
      const lobby = platform.env.GAME_LOBBY.get(lobbyId);
      const response = await lobby.fetch('https://internal/admin-status');
      const data = await response.json() as {
        rooms: LobbyRoomInfo[];
        archivedRooms: ArchivedRoomInfo[];
        connectedClients: number;
      };
      lobbyRooms = data.rooms;
      archivedRooms = data.archivedRooms;
      lobbyClients = data.connectedClients;
    } catch (e) {
      errors.push(`Lobby fetch failed: ${e}`);
    }
  } else {
    errors.push('Platform binding not available (GAME_LOBBY)');
  }

  // Sort rooms: playing first, then lobby, then ended
  const phaseOrder = { playing: 0, lobby: 1, ended: 2 };
  rooms.sort((a, b) => {
    const pa = phaseOrder[a.detail?.phase as keyof typeof phaseOrder ?? a.phase] ?? 2;
    const pb = phaseOrder[b.detail?.phase as keyof typeof phaseOrder ?? b.phase] ?? 2;
    return pa - pb || b.createdAt - a.createdAt;
  });

  // Sort archived by most recent first
  archivedRooms.sort((a, b) => b.endedAt - a.endedAt);

  return {
    user: locals.user,
    rooms,
    lobbyRooms,
    archivedRooms,
    lobbyClients,
    kvKeyCount,
    errors,
    fetchedAt: Date.now()
  };
};
