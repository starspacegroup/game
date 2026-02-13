/**
 * Game Worker — hosts the GameRoom Durable Object class.
 * Deployed as a standalone Worker so Cloudflare Pages can bind to it via script_name.
 */

// Re-export the Durable Object class (wrangler bundles transitively)
export { GameRoom } from '../../src/lib/server/GameRoom';

export default {
  async fetch(_request: Request): Promise<Response> {
    // All traffic to this worker should go through DO bindings, not direct fetch.
    return new Response('game-worker is running. Use DO bindings to interact.', { status: 200 });
  }
};
