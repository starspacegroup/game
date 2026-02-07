import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface GameRoomStatus {
  playerCount: number;
  players: Array<{ id: string; username: string; }>;
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
}

export const GET: RequestHandler = async ({ platform, url }) => {
  if (!platform?.env?.GAME_ROOM) {
    return json({
      error: 'Server not configured for multiplayer',
      available: false
    }, { status: 503 });
  }

  const roomId = url.searchParams.get('room') || 'default';
  const id = platform.env.GAME_ROOM.idFromName(roomId);
  const room = platform.env.GAME_ROOM.get(id);

  // Fetch status from the Durable Object
  const statusUrl = new URL('/status', url.origin);
  const response = await room.fetch(statusUrl.toString());
  const status = await response.json() as GameRoomStatus;

  return json({
    available: true,
    room: roomId,
    playerCount: status.playerCount,
    players: status.players,
    puzzleProgress: status.puzzleProgress,
    puzzleSolved: status.puzzleSolved,
    wave: status.wave
  });
};
