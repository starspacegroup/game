# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on port 4201
npm run build        # Production build (Cloudflare Pages)
npm run preview      # Preview production build on port 4201
npm run check        # Type-check with svelte-check
npm run check:watch  # Type-check in watch mode
```

No test framework is configured. Use `npm run check` for validation.

**The dev server exits on its own, and it takes the dev tunnel down with it.**
Observed four times in one session (2026-07-26), always a clean exit — code 0,
no error in its output. Expect to restart `npm run dev` periodically, and check
it before assuming the tunnel is broken:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4201/
```

What is known: `npm run check` and `npm run build` both begin with
`svelte-kit sync`, which rewrites `.svelte-kit/generated/*` and makes the dev
server reload every route. Deaths have followed those commands. What is *not*
established: that the sync causes the exit. A controlled test — run
`npx svelte-check --tsconfig ./tsconfig.json`, then poll for 30s — produced the
same reload lines and the server survived; and one death happened with no log
output at all, minutes after the last command. Treat the correlation as a hint,
not a diagnosis.

`npx svelte-check --tsconfig ./tsconfig.json` gives the same result as
`npm run check` and is the lighter option, but it is not a proven fix.

Copy `.env.example` to `.env` before either command — `$env/static/private`
errors on imports it can't resolve, so a missing file fails the build.

### Dev virtual login

`npm run dev` shows a **DEV LOGIN** panel on the welcome screen: pick any
username, optionally tick "super admin", and it mints the same `session` cookie
the Discord callback writes — no Discord app needed. Also scriptable:

```bash
curl -X POST localhost:4201/api/auth/dev-login -H 'Content-Type: application/json' \
  -d '{"username":"Tester","superAdmin":true}' -c jar.txt
open 'http://localhost:4201/api/auth/dev-login?username=Tester&superAdmin=1'  # or via browser
```

Dev accounts get a generated avatar instead of a Discord one: `$lib/devAvatar`
builds a deterministic SVG in the style of a Discord *default* avatar — the
white Clyde mark on a flat colour — served from `/api/auth/dev-avatar/<id>.svg`.
The palette is Discord's own six colours plus six more in the same register;
colours repeat across accounts the same way Discord's do, so don't rely on
colour alone to tell more than a few test accounts apart. The session stores
that path in `avatar` where a real session stores a Discord hash, and
`authState.avatarUrl` passes through anything starting with `/` or `http`
rather than prefixing the CDN. Same-origin, so it also loads into the ship's
canvas texture without tainting it.

Every part of it is gated on `dev` from `$app/environment`, so a production
build dead-code-eliminates both endpoints to a bare 404, drops the UI, and
strips the dev branch from `isSuperAdmin()`. `hooks.server.ts` also deletes any
`dev: true` cookie it sees outside dev. Keep all these gates when touching this.

## Tech Stack

- **SvelteKit 2.x + Svelte 5** (runes: `$state`, `$props`, `$derived`, `$effect`)
- **Threlte v8** (@threlte/core, @threlte/extras) — Svelte 5 Three.js wrapper
- **Three.js 0.172.0** — 3D rendering
- **Cloudflare Pages** with Durable Objects for multiplayer
- **Discord OAuth** for authentication

## Architecture

### State Management (dual-layer)

The game uses two distinct state layers for performance:

1. **World state** (`src/lib/game/world.ts`) — Plain JS objects (non-reactive). Entity positions, velocities, and physics data are updated directly on Three.js objects via mesh refs. This avoids Svelte reactivity overhead at 60fps.

2. **UI state** (`src/lib/stores/gameState.svelte.ts`) — Svelte 5 `$state` class pattern for reactive UI values (score, health, phase, messages). Entity ID arrays are reactive to control which components render, but the entity data itself is not.

### Game Loop

`GameWorld.svelte` runs the main loop via `useTask(delta)` from @threlte/core:

```
useTask(delta) →
  updatePlayer → updateShooting → updateLasers →
  updateAsteroids → updateNpcs → updatePowerUps →
  handleCollisions (~20fps) → updatePuzzle →
  updateEntityLists (~7fps) → syncMultiplayer (~20fps) →
  respawnEntities (~6s) → checkGameOver
```

Delta is clamped to 0.1s to prevent physics explosions on tab-switch. Different systems run at different rates using cooldown timers.

### Sphere World

The world is a sphere with `SPHERE_RADIUS = 200`. Players fly on the surface. All positions are 3D vectors projected onto the sphere via `projectToSphere()`. Navigation uses tangent-frame movement with parallel-transported "up" vector (`world.playerUp`) using Rodrigues rotation to prevent orientation snaps at the poles. Distance uses `sphereDistance()` (chord distance). The `chunk.ts` module provides sphere-aware spatial utilities: `toSpherical()`, `fromSpherical()`, `arcDistance()`, and `SpatialHash`. Puzzle nodes exist inside the sphere at `PUZZLE_INTERIOR_RADIUS`. In multiplayer, the client sends world-space velocity vectors to the server, eliminating tangent-frame mismatch.

### Multiplayer

- **Client**: `socketClient.ts` connects via WebSocket, sends inputs at 50ms intervals
- **Server**: `GameRoom.ts` (Durable Object) runs at 20 ticks/sec, broadcasts full world state
- **Fallback**: Solo mode if server is unavailable
- **Rooms**: `/api/game/rooms` endpoint for listing/creating/joining rooms
- **Protocol**: Shared types in `src/lib/shared/protocol.ts`

### Entity Lifecycle

Entities are generated procedurally (`src/lib/game/procedural.ts`) on the sphere surface via `randomSpherePosition()` / `randomSpherePositionNear()`, updated per-frame in the game loop, culled by `RENDER_DISTANCE` (100 chord units) for rendering, and respawned on intervals. Entity IDs use prefixed counters: `ast_`, `npc_`, `laser_`, `pu_`.

### Collision Detection

Simple distance-based (sum of radii vs chord distance). Uses `sphereDistance()` for accurate 3D collision on the sphere surface. No physics engine.

### Puzzle System

Nodes are the **240 E8 roots**, projected to 3D by the H3 basis (`e8.ts`) and placed inside the sphere. They are not random: each node's *target* is a lattice vertex, and only its *start* position is scattered. Six waves reveal them as contiguous bands of the radius-sorted roots — **20, 28, 36, 44, 52, 60** nodes, computed by `computeWaveSizes()` so the curve climbs. Past-wave nodes render locked at their vertices; future waves are not generated.

> Wave sizes are computed, not hardcoded per shell. The projection makes seven shells of `[4, 24, 40, 78, 40, 24, 30]` — the biggest in the middle — so no grouping of whole shells gives a rising curve. Don't reintroduce a shell→wave table.

Players and converted NPCs push nodes toward their targets; a node within `NODE_CONNECT_DIST` locks. NPCs convert from hostile to allied via repeated laser hits, then orbit nodes and generate hints. Completing a wave unlocks one of the 12 `/secrets` fragments.

**Alignment and conversion are server-authoritative** (`shared/protocol.ts` holds the shared `NODE_ALIGN_RATE`/`NODE_CONNECT_DIST`). Clients predict locally and are corrected by the next state broadcast; they send nothing back. The `interact` message is a deliberate no-op — see the handler in `GameRoom.ts` before re-enabling it.

## Platform Notes

**Very important:** When you are on Windows (dev or otherwise) → never use `/dev/null`. Use `>nul` or `> NUL` or `1>nul 2>&1` instead.

## Key Conventions

- SSR is disabled on the game page (`+page.ts: export const ssr = false`)
- Constants use `SCREAMING_SNAKE_CASE` (e.g., `SHOOT_COOLDOWN`, `LASER_SPEED`)
- Stores use Svelte 5 `$state` class pattern (not writable stores)
- Three.js objects use Threlte's `<T>` component with `bind:ref` for direct manipulation
- Mobile detected via `navigator.maxTouchPoints` / viewport width, uses VirtualJoystick

## Goals

- **Durable Object storage lifecycle** (goal closed 2026-07-25). Shipped and purged: 22 stale rooms reclaimed, 0.95 MiB → 0.34 MiB. The original "~12.5 GB / $2.30 a month" framing was wrong by ~13,000× — do not cite it. `game-worker` is deployed; the Pages half is committed but unpushed. Details in the workspace `ROADMAP.md` and `planning/DECISIONS.md`.

  The rules below still apply — they are why the leaks happened. Keep them in mind when touching `GameRoom.ts`:
  - **Never delete a room's KV pointer without first terminating its DO.** The KV key is the only handle on that DO; drop it first and the storage is orphaned and unfindable. `terminateRoomDO()` in `api/game/rooms` exists for this.
  - **`sessions` does not survive hibernation.** This DO uses `acceptWebSocket()`, and `sessions` is never rebuilt from `getWebSockets()`. Any cleanup keyed on a session lookup will silently not run after an eviction — use `state.getWebSockets().length` for liveness.
  - **`storage.deleteAll()` does not cancel a pending alarm.** Call `deleteAlarm()` too, or the DO wakes forever on an empty room.
  - **Don't reintroduce per-tick persistence.** Saves are transition-driven; `SAVE_INTERVAL_TICKS` is only a safety net.
