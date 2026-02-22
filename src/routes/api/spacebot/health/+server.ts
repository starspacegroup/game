import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { INTEGRATION_SLUG, INTEGRATION_VERSION } from '$lib/server/spacebot';

/** GET /api/spacebot/health — SpaceBot polls this to verify the service is reachable. */
export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    integration: INTEGRATION_SLUG,
    version: INTEGRATION_VERSION,
    timestamp: new Date().toISOString()
  });
};
