import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSuperAdmin } from '$lib/server/admin';

const SETTINGS_KEY = 'settings:global';

export interface GameSettings {
  spacebot_token: string;
  spacebot_url: string;
}

const DEFAULT_SETTINGS: GameSettings = {
  spacebot_token: '',
  spacebot_url: 'https://spacebot.starspace.group'
};

// In-memory fallback for local dev when KV is not available
let devSettings: GameSettings = { ...DEFAULT_SETTINGS };

/** Read settings from KV (or in-memory fallback). */
export async function _loadSettings(platform: App.Platform | undefined): Promise<GameSettings> {
  if (!platform?.env?.GAME_DATA) return devSettings;

  try {
    const raw = await platform.env.GAME_DATA.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** GET /api/game/settings — return current settings (admin only, tokens masked) */
export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!isSuperAdmin(locals)) {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  const settings = await _loadSettings(platform);

  // Mask the token for display
  return json({
    spacebot_token: settings.spacebot_token
      ? `${settings.spacebot_token.slice(0, 12)}${'•'.repeat(Math.max(0, settings.spacebot_token.length - 12))}`
      : '',
    spacebot_url: settings.spacebot_url
  });
};

/** PUT /api/game/settings — update settings (admin only) */
export const PUT: RequestHandler = async ({ request, locals, platform }) => {
  if (!isSuperAdmin(locals)) {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Partial<GameSettings>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Load existing then merge
  const current = await _loadSettings(platform);
  const updated: GameSettings = {
    spacebot_token: typeof body.spacebot_token === 'string' ? body.spacebot_token : current.spacebot_token,
    spacebot_url: typeof body.spacebot_url === 'string' && body.spacebot_url.length > 0
      ? body.spacebot_url.replace(/\/$/, '')
      : current.spacebot_url
  };

  if (!platform?.env?.GAME_DATA) {
    // Dev fallback
    devSettings = updated;
  } else {
    await platform.env.GAME_DATA.put(SETTINGS_KEY, JSON.stringify(updated));
  }

  return json({ success: true });
};
