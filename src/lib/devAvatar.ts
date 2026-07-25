/**
 * Generated avatars for dev virtual sessions (see /api/auth/dev-login).
 *
 * These mimic Discord's *default* avatar — the white Clyde mark on a flat
 * colour — so dev sessions look like real accounts and the game's avatar
 * rendering can be judged the way it will actually appear in production.
 *
 * Real Discord sessions carry an avatar *hash* that the CDN turns into an
 * image. Dev sessions have no Discord behind them, so they get this SVG served
 * from /api/auth/dev-avatar/<id>.svg instead — same-origin (so it loads through
 * the tunnel and into a canvas texture without CORS trouble), deterministic per
 * user id, and small enough that stashing the URL in the session cookie, the
 * multiplayer protocol, and DO player state costs nothing.
 *
 * No `$app/environment` import here: this module is pulled in by both the
 * dev-login endpoint and the avatar route, and each does its own `dev` gating.
 */

const AVATAR_SIZE = 128;

/**
 * Discord's six real default-avatar colours, then six more in the same flat,
 * mid-saturation register. Discord picks from six and repeats; we carry twelve
 * so a handful of test accounts stay tellable apart at 18px without ever
 * looking like something Discord wouldn't ship.
 */
const PALETTE = [
  '#5865f2', // blurple
  '#747f8d', // grey
  '#3ba55c', // green
  '#faa61a', // yellow
  '#ed4245', // red
  '#eb459e', // fuchsia
  '#00a8fc', // blue
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // orange
  '#f47b67', // salmon
  '#b084f5'  // lavender
];

/**
 * The Clyde mark, as drawn on a 24×24 grid. Scaled ×3 and centred below, which
 * lands it at roughly the 60% of the frame Discord's own default avatars use.
 */
const CLYDE_PATH =
  'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.198.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';

/**
 * djb2 plus a murmur3 finalizer. The finalizer matters: plain djb2 maps similar
 * strings to nearby values, so `tester-one` and `tester-two` picked the same
 * colour — useless when the whole point is telling test accounts apart. The
 * avalanche step makes a one-character change land on an unrelated entry.
 */
function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Where a dev user's avatar lives. Stored as the session's `avatar` value. */
export function devAvatarPath(userId: string): string {
  return `/api/auth/dev-avatar/${encodeURIComponent(userId)}.svg`;
}

/** A Discord-style default avatar: white Clyde mark on a flat colour. */
export function devAvatarSvg(seed: string): string {
  const colour = PALETTE[hash(seed) % PALETTE.length];

  // Explicit width/height (not just viewBox) — an SVG without intrinsic size
  // can fail to rasterize when drawn into a canvas.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" fill="${colour}"/>` +
    `<g transform="translate(28 28) scale(3)" fill="#ffffff"><path d="${CLYDE_PATH}"/></g>` +
    `</svg>`;
}
