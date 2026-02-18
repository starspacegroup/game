import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
  wave: number;
  date: string;
}

const LEADERBOARD_KEY = 'leaderboard:solo:top';
const MAX_ENTRIES = 100;

// In-memory fallback for local dev when KV is not available
let devLeaderboard: LeaderboardEntry[] = [];

/** GET /api/leaderboard — public, no auth required */
export const GET: RequestHandler = async ({ platform, url }) => {
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || MAX_ENTRIES, MAX_ENTRIES) : MAX_ENTRIES;

  if (!platform?.env?.GAME_DATA) {
    // Dev fallback: use in-memory store
    return json({ entries: devLeaderboard.slice(0, limit) });
  }

  try {
    const raw = await platform.env.GAME_DATA.get(LEADERBOARD_KEY);
    const entries: LeaderboardEntry[] = raw ? JSON.parse(raw) : [];
    return json({ entries: entries.slice(0, limit) });
  } catch {
    return json({ entries: [] });
  }
};

/** Shared leaderboard upsert logic — works on any LeaderboardEntry[] */
function upsertEntry(entries: LeaderboardEntry[], userId: string, username: string, score: number, wave: number): { entries: LeaderboardEntry[]; rank: number; newHighScore: boolean; } {
  const newEntry: LeaderboardEntry = {
    userId,
    username,
    score: Math.round(score),
    wave: Math.max(1, Math.round(wave)),
    date: new Date().toISOString()
  };

  const existingIdx = entries.findIndex(e => e.userId === userId);
  if (existingIdx !== -1) {
    if (entries[existingIdx].score >= score) {
      return { entries, rank: existingIdx + 1, newHighScore: false };
    }
    entries.splice(existingIdx, 1);
  }

  let insertIdx = entries.findIndex(e => e.score < score);
  if (insertIdx === -1) insertIdx = entries.length;
  entries.splice(insertIdx, 0, newEntry);

  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  return { entries, rank: insertIdx + 1, newHighScore: existingIdx === -1 || true };
}

/** POST /api/leaderboard — submit a solo high score (auth optional; guests use provided ID) */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
  let body: { score?: number; wave?: number; guestId?: string; guestName?: string; };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const score = body.score;
  const wave = body.wave ?? 1;

  if (typeof score !== 'number' || score <= 0 || !Number.isFinite(score)) {
    return json({ success: false, error: 'Invalid score' }, { status: 400 });
  }

  // Determine user identity: prefer authenticated user, fall back to guest
  let userId: string;
  let username: string;
  if (locals.user) {
    userId = locals.user.id;
    username = locals.user.username;
  } else if (body.guestId && typeof body.guestId === 'string') {
    userId = `guest_${body.guestId}`;
    username = body.guestName && typeof body.guestName === 'string'
      ? body.guestName.slice(0, 20)
      : 'Guest';
  } else {
    return json({ success: false, error: 'Authentication or guest ID required' }, { status: 401 });
  }

  // Cap score to prevent absurd values
  if (score > 10_000_000) {
    return json({ success: false, error: 'Score too high' }, { status: 400 });
  }

  // Dev fallback: use in-memory store when KV is not available
  if (!platform?.env?.GAME_DATA) {
    const result = upsertEntry(devLeaderboard, userId, username, score, wave);
    devLeaderboard = result.entries;
    return json({ success: true, newHighScore: result.newHighScore, rank: result.rank });
  }

  try {
    const raw = await platform.env.GAME_DATA.get(LEADERBOARD_KEY);
    const entries: LeaderboardEntry[] = raw ? JSON.parse(raw) : [];

    const result = upsertEntry(entries, userId, username, score, wave);

    await platform.env.GAME_DATA.put(LEADERBOARD_KEY, JSON.stringify(result.entries));

    return json({
      success: true,
      newHighScore: result.newHighScore,
      rank: result.rank
    });
  } catch (err) {
    console.error('Leaderboard write error:', err);
    return json({ success: false, error: 'Internal error' }, { status: 500 });
  }
};
