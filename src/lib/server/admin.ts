import { dev } from '$app/environment';
import { SUPER_ADMIN_DISCORD_IDS } from '$env/static/private';

const adminIds = SUPER_ADMIN_DISCORD_IDS?.split(',').map(id => id.trim()).filter(Boolean) ?? [];

/**
 * Single source of truth for the super-admin gate.
 *
 * In production this is purely "is your Discord ID in SUPER_ADMIN_DISCORD_IDS".
 * In dev a virtual session (see /api/auth/dev-login) can also carry the flag,
 * so the admin surfaces are testable without a real Discord app configured.
 */
export function isSuperAdmin(locals: App.Locals): boolean {
  if (!locals.user) return false;
  if (dev && locals.devSuperAdmin) return true;
  return adminIds.includes(locals.user.id);
}

/** ID-only variant, for callers that only have a user ID (no session). */
export function isSuperAdminId(userId: string): boolean {
  return adminIds.includes(userId);
}
