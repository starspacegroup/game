import { dev } from '$app/environment';
import { devAvatarSvg } from '$lib/devAvatar';
import type { RequestHandler } from './$types';

/**
 * Avatar images for dev virtual sessions — DEV ONLY.
 *
 * `dev` is false in any production build, so this 404s there (and the body is
 * dead-code-eliminated, same as /api/auth/dev-login).
 */
export const GET: RequestHandler = async ({ params }) => {
  if (!dev) return new Response('Not found', { status: 404 });

  // Callers request `<id>.svg`; the extension is cosmetic.
  const seed = params.seed.replace(/\.svg$/, '').slice(0, 64);

  return new Response(devAvatarSvg(seed), {
    headers: {
      'Content-Type': 'image/svg+xml',
      // Deterministic per seed, so it can be cached hard — but keep it short
      // enough that tweaking the generator shows up on reload.
      'Cache-Control': 'public, max-age=300'
    }
  });
};
