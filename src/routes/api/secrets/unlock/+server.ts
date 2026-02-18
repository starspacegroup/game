import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  generateFragmentSeed,
  generateFragment,
  getNextFragmentIndex,
  emptyCollection,
  TOTAL_FRAGMENTS,
  type FragmentCollection,
} from '$lib/game/fragments';

function kvKey(userId: string, mode: string): string {
  return `user:${userId}:fragments:${mode}`;
}

// In-memory fallback for dev when KV is unavailable
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

async function putCollection(
  kv: KVNamespace | undefined,
  userId: string,
  mode: string,
  collection: FragmentCollection,
): Promise<void> {
  const key = kvKey(userId, mode);

  if (!kv) {
    devStore.set(key, collection);
    return;
  }

  await kv.put(key, JSON.stringify(collection));
}

/** POST /api/secrets/unlock — unlock the next fragment after puzzle solve */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!locals.user) {
    return json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  let body: { mode?: string; sessionId?: string; solveTimestamp?: number; };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const mode = body.mode === 'multi' ? 'multi' : 'solo';
  const sessionId = body.sessionId ?? 'unknown';
  const solveTimestamp = body.solveTimestamp ?? Date.now();

  const kv = platform?.env?.GAME_DATA;
  const collection = await getCollection(kv, locals.user.id, mode);

  // Check if all fragments already collected
  const nextIndex = getNextFragmentIndex(collection);
  if (nextIndex === -1) {
    return json({
      success: true,
      alreadyComplete: true,
      fragment: null,
      fragmentCount: TOTAL_FRAGMENTS,
      metaSolved: collection.metaSolved,
    });
  }

  // Generate the fragment
  const seed = generateFragmentSeed(locals.user.id, sessionId, solveTimestamp);
  const now = new Date().toISOString();
  const fragment = generateFragment(seed, nextIndex, sessionId, now);

  // Add to collection
  collection.fragments.push(fragment);

  // Check if meta-puzzle is now complete
  if (collection.fragments.length >= TOTAL_FRAGMENTS && !collection.metaSolved) {
    collection.metaSolved = true;
    collection.metaSolvedAt = now;
  }

  await putCollection(kv, locals.user.id, mode, collection);

  return json({
    success: true,
    alreadyComplete: false,
    fragment,
    fragmentCount: collection.fragments.length,
    metaSolved: collection.metaSolved,
  });
};
