import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isSuperAdmin } from '$lib/server/admin';

/**
 * Server load only handles auth gating.
 * All data is streamed in real-time via the admin WebSocket.
 */
export const load: PageServerLoad = async ({ locals }) => {
  if (!isSuperAdmin(locals)) {
    throw redirect(302, '/');
  }

  return { user: locals.user };
};
