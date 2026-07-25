import { json, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { devAvatarPath } from '$lib/devAvatar';
import type { RequestHandler } from './$types';

/**
 * Virtual login — DEV ONLY.
 *
 * Mints the same `session` cookie the Discord callback writes, but with a fake
 * user, so the game (and /superadmin) can be exercised without a Discord app.
 * The session is marked `dev: true` so hooks.server.ts never tries to refresh
 * it against Discord.
 *
 * `dev` is false in any production build, so both handlers 404 there.
 */

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Stable, readable, and clearly not a Discord snowflake. */
function devUserId(username: string): string {
  const slug = username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `dev-${slug || 'player'}`;
}

function mintSession(
  cookies: import('@sveltejs/kit').Cookies,
  url: URL,
  username: string,
  superAdmin: boolean
) {
  const id = devUserId(username);
  const user = {
    id,
    username,
    // Real sessions store a Discord avatar hash here; dev sessions store a
    // ready-made URL, which authState.avatarUrl passes through untouched.
    avatar: devAvatarPath(id) as string | null
  };

  cookies.set(
    'session',
    JSON.stringify({
      ...user,
      accessToken: 'dev',
      refreshToken: 'dev',
      expiresAt: Date.now() + THIRTY_DAYS * 1000,
      dev: true,
      superAdmin
    }),
    {
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS
    }
  );

  return user;
}

/** POST { username?, superAdmin? } → the user object, for client-side hydration. */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
  if (!dev) return new Response('Not found', { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    username?: string;
    superAdmin?: boolean;
  };

  const username = (body.username ?? '').trim().slice(0, 32) || 'Dev Player';
  const user = mintSession(cookies, url, username, !!body.superAdmin);

  return json({ user, superAdmin: !!body.superAdmin });
};

/** GET ?username=…&superAdmin=1 → sets the cookie and bounces to `/`. */
export const GET: RequestHandler = async ({ url, cookies }) => {
  if (!dev) return new Response('Not found', { status: 404 });

  const username = (url.searchParams.get('username') ?? '').trim().slice(0, 32) || 'Dev Player';
  const superAdmin = url.searchParams.get('superAdmin') === '1';

  mintSession(cookies, url, username, superAdmin);

  throw redirect(302, '/');
};
