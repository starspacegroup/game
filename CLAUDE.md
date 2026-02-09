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

### Toroidal World

The world wraps at ±2116 units in both axes. All distance/direction calculations must use `wrappedDistance()` and `wrappedDirection()` from `world.ts` to find the shortest path across boundaries. `wrapPosition()` keeps entities in bounds.

### Multiplayer

- **Client**: `socketClient.ts` connects via WebSocket, sends inputs at 50ms intervals
- **Server**: `GameRoom.ts` (Durable Object) runs at 20 ticks/sec, broadcasts full world state
- **Fallback**: Solo mode if server is unavailable
- **Rooms**: `/api/game/rooms` endpoint for listing/creating/joining rooms
- **Protocol**: Shared types in `src/lib/shared/protocol.ts`

### Entity Lifecycle

Entities are generated procedurally (`src/lib/game/procedural.ts`), updated per-frame in the game loop, culled by `VIEW_DISTANCE` (200 units) for rendering, and respawned on intervals. Entity IDs use prefixed counters: `ast_`, `npc_`, `laser_`, `pu_`.

### Collision Detection

Simple distance-based (sum of radii vs distance). Uses `wrappedDistance()` for toroidal accuracy. No physics engine.

### Puzzle System (Kal-Toh)

12 puzzle nodes placed randomly. Players and converted NPCs push nodes toward target positions. NPCs convert from hostile to allied via repeated laser hits, then orbit puzzle nodes and generate hints.

## Key Conventions

- SSR is disabled on the game page (`+page.ts: export const ssr = false`)
- Constants use `SCREAMING_SNAKE_CASE` (e.g., `SHOOT_COOLDOWN`, `LASER_SPEED`)
- Stores use Svelte 5 `$state` class pattern (not writable stores)
- Three.js objects use Threlte's `<T>` component with `bind:ref` for direct manipulation
- Mobile detected via `navigator.maxTouchPoints` / viewport width, uses VirtualJoystick
