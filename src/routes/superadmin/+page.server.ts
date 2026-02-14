import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()) ?? [];

/**
 * Server load only handles auth gating.
 * All data is streamed in real-time via the admin WebSocket.
 */
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user || !adminIds.includes(locals.user.id)) {
    throw redirect(302, '/');
  }

  return { user: locals.user };
};
