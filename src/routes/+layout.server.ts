import type { LayoutServerLoad } from './$types';
import { isSuperAdmin } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user ?? null,
    isSuperAdmin: isSuperAdmin(locals)
  };
};
