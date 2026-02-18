import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  emptyCollection,
  TOTAL_FRAGMENTS,
  type FragmentCollection,
} from '$lib/game/fragments';

function kvKey(userId: string, mode: string): string {
  return `user:${userId}:fragments:${mode}`;
}

// In-memory fallback for dev
const devStore = new Map<string, FragmentCollection>();

/** GET /api/secrets/fragments?mode=solo|multi — get user's fragment collection */
export const GET: RequestHandler = async ({ platform, locals, url }) => {
  if (!locals.user) {
    return json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const mode = url.searchParams.get('mode') === 'multi' ? 'multi' : 'solo';
  const key = kvKey(locals.user.id, mode);

  let collection: FragmentCollection;

  if (!platform?.env?.GAME_DATA) {
    collection = devStore.get(key) ?? emptyCollection();
  } else {
    try {
      const raw = await platform.env.GAME_DATA.get(key);
      collection = raw ? JSON.parse(raw) : emptyCollection();
    } catch {
      collection = emptyCollection();
    }
  }

  return json({
    success: true,
    fragments: collection.fragments,
    metaSolved: collection.metaSolved,
    metaSolvedAt: collection.metaSolvedAt ?? null,
    totalNeeded: TOTAL_FRAGMENTS,
    fragmentCount: collection.fragments.length,
  });
};
