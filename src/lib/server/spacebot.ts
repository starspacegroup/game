/**
 * SpaceBot integration client.
 *
 * Handles syncing the command manifest and sending periodic heartbeats
 * to SpaceBot so it knows *Space Game is online.
 *
 * On Cloudflare Pages (serverless) there is no persistent process, so
 * sync/heartbeat are piggybacked on incoming requests via module-level
 * state that persists for the lifetime of the Workers isolate.
 */

const DEFAULT_SPACEBOT_URL = 'https://spacebot.starspace.group';

export const INTEGRATION_SLUG = 'starspace-game';
export const INTEGRATION_VERSION = '0.1.0';

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Timestamp of isolate start — used to compute uptime. */
const startedAt = Date.now();

/** Tracks last successful heartbeat to throttle calls. */
let lastHeartbeatAt = 0;

/** Whether we've synced the manifest in this isolate lifetime. */
let hasSynced = false;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Build the integration manifest using the current request origin so
 * webhook URLs match the deployment (prod vs preview vs localhost).
 */
export function getManifest(origin: string) {
  return {
    name: '*Space Game',
    slug: INTEGRATION_SLUG,
    version: INTEGRATION_VERSION,
    description:
      'Explore a spherical world, battle asteroids, and solve puzzles in *Space Game',
    author: 'StarSpace Group',
    author_url: 'https://starspace.group',
    icon: '🚀',
    category: 'gaming',
    homepage: origin,
    health_endpoint: `${origin}/api/spacebot/health`,

    commands: [
      {
        name: 'game',
        description: 'Game commands for *Space',
        type: 1,
        options: [
          {
            name: 'stats',
            description: 'View player stats and high scores',
            type: 1,
            options: [
              {
                name: 'player',
                description: 'Player to look up (defaults to yourself)',
                type: 6,
                required: false
              }
            ]
          },
          {
            name: 'leaderboard',
            description: 'View the top players leaderboard',
            type: 1
          },
          {
            name: 'play',
            description: 'Get a link to play *Space Game',
            type: 1
          }
        ]
      }
    ],

    webhooks: {
      on_enable: `${origin}/api/spacebot/on-enable`,
      on_disable: `${origin}/api/spacebot/on-disable`,
      command_handler: `${origin}/api/spacebot/command`
    }
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function getApiBase(spaceBotUrl?: string): string {
  return (spaceBotUrl || DEFAULT_SPACEBOT_URL).replace(/\/$/, '');
}

/**
 * Sync the integration manifest with SpaceBot.
 * Only runs once per isolate lifetime (retries on failure).
 */
export async function syncManifest(
  token: string,
  origin: string,
  spaceBotUrl?: string
): Promise<void> {
  if (hasSynced) return;
  hasSynced = true;

  const apiBase = getApiBase(spaceBotUrl);
  const manifest = getManifest(origin);

  try {
    const res = await fetch(`${apiBase}/api/v1/integrations/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(manifest)
    });

    if (res.ok) {
      const data = (await res.json()) as { guilds_synced?: number; };
      console.log(
        `[SpaceBot] Manifest synced — ${data.guilds_synced ?? 0} guild(s)`
      );
    } else {
      console.error(`[SpaceBot] Manifest sync failed: ${res.status}`);
      hasSynced = false; // retry on next request
    }
  } catch (err) {
    console.error('[SpaceBot] Manifest sync error:', err);
    hasSynced = false;
  }
}

/**
 * Send a heartbeat to SpaceBot.
 * Internally throttled to one call per HEARTBEAT_INTERVAL_MS.
 */
export async function sendHeartbeat(
  token: string,
  spaceBotUrl?: string
): Promise<void> {
  const now = Date.now();
  if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatAt = now;

  const apiBase = getApiBase(spaceBotUrl);
  const uptime = Math.floor((now - startedAt) / 1000);

  try {
    const res = await fetch(`${apiBase}/api/v1/integrations/heartbeat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ version: INTEGRATION_VERSION, uptime })
    });

    if (!res.ok) {
      console.error(`[SpaceBot] Heartbeat failed: ${res.status}`);
      lastHeartbeatAt = 0; // allow immediate retry
    }
  } catch (err) {
    console.error('[SpaceBot] Heartbeat error:', err);
    lastHeartbeatAt = 0;
  }
}

// ---------------------------------------------------------------------------
// Hook integration
// ---------------------------------------------------------------------------

/** Whether a KV settings load is already in-flight this tick. */
let kvLoadPromise: Promise<void> | null = null;

/**
 * Called from `hooks.server.ts` on every incoming request.
 *
 * Reads SpaceBot settings from KV (`settings:global`), then fires
 * manifest sync (once per isolate) and heartbeat (every 2 min)
 * without blocking the request. Uses `waitUntil` on Cloudflare to
 * keep the isolate alive, or falls back to fire-and-forget in local dev.
 */
export function tickSpaceBot(
  platform: App.Platform | undefined,
  origin: string,
  waitUntil?: (promise: Promise<unknown>) => void
): void {
  // Avoid duplicate KV reads within the same tick
  if (kvLoadPromise) return;

  const fire = (p: Promise<void>) => {
    if (waitUntil) {
      waitUntil(p);
    } else {
      p.catch(() => { });
    }
  };

  kvLoadPromise = (async () => {
    try {
      const settings = await loadSpaceBotSettings(platform);
      if (!settings.spacebot_token) return;

      await syncManifest(settings.spacebot_token, origin, settings.spacebot_url || undefined);
      await sendHeartbeat(settings.spacebot_token, settings.spacebot_url || undefined);
    } finally {
      kvLoadPromise = null;
    }
  })();

  fire(kvLoadPromise);
}

// ---------------------------------------------------------------------------
// KV settings reader (avoids circular import with the settings route)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'settings:global';

interface SpaceBotSettings {
  spacebot_token: string;
  spacebot_url: string;
}

async function loadSpaceBotSettings(
  platform: App.Platform | undefined
): Promise<SpaceBotSettings> {
  const fallback: SpaceBotSettings = { spacebot_token: '', spacebot_url: '' };
  if (!platform?.env?.GAME_DATA) return fallback;
  try {
    const raw = await platform.env.GAME_DATA.get(SETTINGS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
