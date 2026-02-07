// Server hooks for SvelteKit
// Note: GameRoom Durable Object is exported from worker.ts for Cloudflare Workers

import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
