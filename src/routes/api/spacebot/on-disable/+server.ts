import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/spacebot/on-disable
 *
 * Called by SpaceBot when a guild admin disables the *Space Game integration.
 * Fire-and-forget — SpaceBot does not wait for or validate the response.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as {
      event: string;
      guild_id: string;
    };
    console.log(
      `[SpaceBot] Integration disabled for guild ${body.guild_id}`
    );
  } catch {
    // Body parsing is best-effort
  }

  return json({ success: true });
};
