import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/spacebot/on-enable
 *
 * Called by SpaceBot when a guild admin enables the *Space Game integration.
 * Fire-and-forget — SpaceBot does not wait for or validate the response.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as {
      event: string;
      guild_id: string;
      enabled_by: string;
      config: Record<string, unknown>;
    };
    console.log(
      `[SpaceBot] Integration enabled for guild ${body.guild_id} by ${body.enabled_by}`
    );
  } catch {
    // Body parsing is best-effort
  }

  return json({ success: true });
};
