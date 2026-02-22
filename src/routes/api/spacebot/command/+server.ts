import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
}

interface SpaceBotCommandPayload {
  type: string;
  command: string;
  options: CommandOption[];
  guild_id: string;
  user: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
  };
  channel_id: string;
  integration_slug: string;
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
  wave: number;
  date: string;
}

const LEADERBOARD_KEY = 'leaderboard:solo:top';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk into the first subcommand from the options array. */
function findSubcommand(
  options: CommandOption[]
): { name: string; options: CommandOption[]; } | null {
  const sub = options.find((o) => o.type === 1);
  if (sub) return { name: sub.name, options: sub.options ?? [] };
  return null;
}

/** Pull a named option value from an options array. */
function getOptionValue(
  options: CommandOption[],
  name: string
): string | number | boolean | undefined {
  return options.find((o) => o.name === name)?.value;
}

/** Fetch leaderboard entries from KV. */
async function getLeaderboard(
  platform: App.Platform | undefined
): Promise<LeaderboardEntry[]> {
  if (!platform?.env?.GAME_DATA) return [];
  try {
    const raw = await platform.env.GAME_DATA.get(LEADERBOARD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleStats(
  body: SpaceBotCommandPayload,
  options: CommandOption[],
  platform: App.Platform | undefined,
  origin: string
) {
  const targetUserId = getOptionValue(options, 'player') as string | undefined;
  const userId = targetUserId || body.user.id;

  const entries = await getLeaderboard(platform);
  const entry = entries.find((e) => e.userId === userId);
  const rank = entry ? entries.indexOf(entry) + 1 : null;

  if (!entry) {
    const name = targetUserId ? `<@${targetUserId}>` : body.user.username;
    return json({
      content: `🔭 **${name}** hasn't played *Space Game yet!\nPlay now: ${origin}`
    });
  }

  return json({
    embeds: [
      {
        title: `🚀 ${entry.username}'s Stats`,
        color: 0x5865f2,
        fields: [
          {
            name: 'High Score',
            value: entry.score.toLocaleString(),
            inline: true
          },
          { name: 'Best Wave', value: String(entry.wave), inline: true },
          { name: 'Rank', value: rank ? `#${rank}` : 'N/A', inline: true },
          {
            name: 'Last Played',
            value: new Date(entry.date).toLocaleDateString(),
            inline: true
          }
        ],
        footer: { text: '*Space Game' },
        url: origin
      }
    ]
  });
}

async function handleLeaderboard(platform: App.Platform | undefined) {
  const entries = await getLeaderboard(platform);

  if (entries.length === 0) {
    return json({
      content: '🏆 No scores recorded yet! Be the first to play.'
    });
  }

  const top = entries.slice(0, 10);
  const medals = ['🥇', '🥈', '🥉'];

  const lines = top.map((e, i) => {
    const medal = medals[i] ?? `**${i + 1}.**`;
    return `${medal} **${e.username}** — ${e.score.toLocaleString()} pts (Wave ${e.wave})`;
  });

  return json({
    embeds: [
      {
        title: '🏆 *Space Game Leaderboard',
        description: lines.join('\n'),
        color: 0xffd700,
        footer: {
          text: `Top ${top.length} of ${entries.length} players`
        }
      }
    ]
  });
}

function handlePlay(origin: string) {
  return json({
    content: [
      '🚀 **Play *Space Game now!**',
      origin,
      '',
      'Explore a spherical world, battle asteroids, convert NPCs, and solve the E₈ puzzle!'
    ].join('\n')
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request, platform, url }) => {
  let body: SpaceBotCommandPayload;
  try {
    body = await request.json();
  } catch {
    return json({ content: '❌ Invalid request' }, { status: 400 });
  }

  if (body.command !== 'game') {
    return json({ content: `❌ Unknown command: ${body.command}` }, { status: 404 });
  }

  const sub = findSubcommand(body.options);
  if (!sub) {
    return json({ content: '❌ Missing subcommand' }, { status: 400 });
  }

  const origin = url.origin;

  switch (sub.name) {
    case 'stats':
      return handleStats(body, sub.options, platform, origin);
    case 'leaderboard':
      return handleLeaderboard(platform);
    case 'play':
      return handlePlay(origin);
    default:
      return json(
        { content: `❌ Unknown subcommand: ${sub.name}` },
        { status: 404 }
      );
  }
};
