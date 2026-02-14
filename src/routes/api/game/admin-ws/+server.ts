import type { RequestHandler } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()) ?? [];

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  // Verify WebSocket upgrade
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  // Auth: must be a superadmin
  if (!locals.user || !adminIds.includes(locals.user.id)) {
    return new Response('Unauthorized', { status: 403 });
  }

  if (!platform?.env?.GAME_LOBBY) {
    return new Response('Lobby not available', { status: 503 });
  }

  // Forward to GameLobby DO with admin indicator in URL
  const id = platform.env.GAME_LOBBY.idFromName('global');
  const lobby = platform.env.GAME_LOBBY.get(id);

  const url = new URL(request.url);
  url.searchParams.set('admin', '1');

  return lobby.fetch(new Request(url.toString(), request));
};
