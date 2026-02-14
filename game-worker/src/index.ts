/**
 * Game Worker — hosts the GameRoom Durable Object class.
 * Deployed as a standalone Worker so Cloudflare Pages can bind to it via script_name.
 *
 * In local dev, the Vite proxy forwards WebSocket upgrades here so the
 * browser can reach the Durable Objects without going through SvelteKit
 * (which can't relay WS upgrades in dev mode).
 */

// Re-export the Durable Object classes (wrangler bundles transitively)
export { GameRoom } from '../../src/lib/server/GameRoom';
export { GameLobby } from '../../src/lib/server/GameLobby';

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  GAME_LOBBY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route /lobby WebSocket upgrades to the single GameLobby DO
    if (url.pathname === '/lobby') {
      const id = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(id);
      return lobby.fetch(request);
    }

    // Route /admin-ws to GameLobby with admin flag (local dev bypass — auth is handled by SvelteKit in prod)
    if (url.pathname === '/admin-ws') {
      const id = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(id);
      url.searchParams.set('admin', '1');
      return lobby.fetch(new Request(url.toString(), request));
    }

    // Route /ws WebSocket upgrades to the appropriate GameRoom DO
    if (url.pathname === '/ws') {
      const roomId = url.searchParams.get('room') || 'default';
      const id = env.GAME_ROOM.idFromName(roomId);
      const room = env.GAME_ROOM.get(id);
      return room.fetch(request);
    }

    // Route /status to the appropriate GameRoom DO
    if (url.pathname === '/status') {
      const roomId = url.searchParams.get('room') || 'default';
      const id = env.GAME_ROOM.idFromName(roomId);
      const room = env.GAME_ROOM.get(id);
      return room.fetch(new Request(new URL('/status', url.origin).toString()));
    }

    return new Response('game-worker is running. Use DO bindings to interact.', { status: 200 });
  }
};
