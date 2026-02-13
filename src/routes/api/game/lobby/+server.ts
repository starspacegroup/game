import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform }) => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (!platform?.env?.GAME_LOBBY) {
    return new Response('Lobby not configured', { status: 503 });
  }

  // All lobby clients connect to the single GameLobby DO instance
  const id = platform.env.GAME_LOBBY.idFromName('global');
  const lobby = platform.env.GAME_LOBBY.get(id);

  // Forward the WebSocket upgrade to the Durable Object
  return lobby.fetch(request);
};
