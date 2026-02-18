import type { PageServerLoad } from './$types';
import type { LeaderboardEntry } from '../api/leaderboard/+server';

export const load: PageServerLoad = async ({ platform, fetch }) => {
  // Use the API endpoint which has its own dev fallback
  try {
    const res = await fetch('/api/leaderboard');
    if (res.ok) {
      const data = await res.json() as { entries: LeaderboardEntry[]; };
      return { entries: data.entries ?? [] };
    }
  } catch { /* fall through */ }

  return { entries: [] as LeaderboardEntry[] };
};
