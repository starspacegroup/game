import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  emptyCollection,
  type FragmentCollection,
} from '$lib/game/fragments';

function kvKey(userId: string, mode: string): string {
  return `user:${userId}:fragments:${mode}`;
}

// In-memory fallback for dev
const devStore = new Map<string, FragmentCollection>();

async function getCollection(
  kv: KVNamespace | undefined,
  userId: string,
  mode: string,
): Promise<FragmentCollection> {
  const key = kvKey(userId, mode);

  if (!kv) {
    return devStore.get(key) ?? emptyCollection();
  }

  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : emptyCollection();
  } catch {
    return emptyCollection();
  }
}

/** GET /api/secrets/fragment/[id] — get a specific fragment by ID */
export const GET: RequestHandler = async ({ params, platform, locals }) => {
  if (!locals.user) {
    return json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const fragmentId = params.id;
  if (!fragmentId) {
    return json({ success: false, error: 'Fragment ID required' }, { status: 400 });
  }

  const kv = platform?.env?.GAME_DATA;

  // Search both solo and multi collections
  for (const mode of ['solo', 'multi']) {
    const collection = await getCollection(kv, locals.user.id, mode);
    const fragment = collection.fragments.find((f) => f.id === fragmentId);
    if (fragment) {
      return json({
        success: true,
        fragment,
        mode,
        metaSolved: collection.metaSolved,
      });
    }
  }

  return json(
    { success: false, error: 'This secret belongs to another explorer' },
    { status: 403 },
  );
};
