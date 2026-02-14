import type { LayoutServerLoad } from './$types';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()) ?? [];

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user ?? null,
    isSuperAdmin: !!locals.user && adminIds.includes(locals.user.id)
  };
};
