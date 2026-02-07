/**
 * Worker entry point for Cloudflare Workers with Durable Objects
 * This file wraps the SvelteKit build output and exports the Durable Object class
 */

// Export the Durable Object class
export { GameRoom } from './src/lib/server/GameRoom';

// Import and re-export the SvelteKit worker
// After building, the adapter-cloudflare outputs to .svelte-kit/cloudflare/_worker.js
import worker from './.svelte-kit/cloudflare/_worker.js';
export default worker;
