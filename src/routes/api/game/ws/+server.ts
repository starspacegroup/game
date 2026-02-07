import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform, url }) => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (!platform?.env?.GAME_ROOM) {
    return new Response('Server not configured for multiplayer', { status: 503 });
  }

  // Get or create game room (using a single shared room for now)
  // Could be extended to support multiple rooms based on URL params
  const roomId = url.searchParams.get('room') || 'default';
  const id = platform.env.GAME_ROOM.idFromName(roomId);
  const room = platform.env.GAME_ROOM.get(id);

  // Forward the WebSocket upgrade to the Durable Object
  return room.fetch(request);
};
