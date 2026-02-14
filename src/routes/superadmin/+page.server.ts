import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()) ?? [];

interface KvRoomInfo {
  id: string;
  name: string;
  playerCount: number;
  createdAt: number;
  createdBy: string;
  createdById?: string;
  isPrivate: boolean;
  phase: string;
}

export const load: PageServerLoad = async ({ locals, platform }) => {
  // Auth guard - only super admins can access
  if (!locals.user || !adminIds.includes(locals.user.id)) {
    throw redirect(302, '/');
  }

  const errors: string[] = [];

  // If platform APIs aren't available (local dev), return empty defaults
  if (!platform?.env?.GAME_LOBBY || !platform?.env?.GAME_DATA || !platform?.env?.GAME_ROOM) {
    return {
      user: locals.user,
      rooms: [] as Array<KvRoomInfo & { detail: unknown; }>,
      archivedRooms: [] as unknown[],
      lobbyRooms: [] as unknown[],
      lobbyClients: 0,
      kvKeyCount: 0,
      fetchedAt: Date.now(),
      errors: ['Platform APIs not available (local dev mode)']
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lobbyRooms: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let archivedRooms: any[] = [];
  let lobbyClients = 0;
  let kvKeyCount = 0;

  // 1. Fetch lobby status (rooms, archived, WS client count)
  try {
    const id = platform.env.GAME_LOBBY.idFromName('global');
    const lobby = platform.env.GAME_LOBBY.get(id);
    const res = await lobby.fetch('https://internal/admin-status');
    const data = await res.json() as {
      rooms: unknown[];
      archivedRooms: unknown[];
      connectedClients: number;
    };
    lobbyRooms = data.rooms ?? [];
    archivedRooms = data.archivedRooms ?? [];
    lobbyClients = data.connectedClients ?? 0;
  } catch (e) {
    errors.push(`Lobby fetch failed: ${e}`);
  }

  // 2. List KV room keys and fetch per-room detail from GameRoom DOs
  const rooms: Array<KvRoomInfo & { detail: unknown; }> = [];
  try {
    const roomList = await platform.env.GAME_DATA.list({ prefix: 'room:' });
    kvKeyCount = roomList.keys.length;

    for (const key of roomList.keys) {
      try {
        const roomData = await platform.env.GAME_DATA.get(key.name, 'json') as KvRoomInfo | null;
        if (!roomData) continue;

        let detail: unknown = null;
        try {
          const doId = platform.env.GAME_ROOM.idFromName(roomData.id);
          const room = platform.env.GAME_ROOM.get(doId);
          const detailRes = await room.fetch('https://internal/admin-detail');
          detail = await detailRes.json();
        } catch (e) {
          errors.push(`Room ${roomData.id} detail: ${e}`);
        }

        rooms.push({ ...roomData, detail });
      } catch (e) {
        errors.push(`KV read ${key.name}: ${e}`);
      }
    }
  } catch (e) {
    errors.push(`KV list failed: ${e}`);
  }

  return {
    user: locals.user,
    rooms,
    archivedRooms,
    lobbyRooms,
    lobbyClients,
    kvKeyCount,
    fetchedAt: Date.now(),
    errors
  };
};
