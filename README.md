# Game

A mobile-first, responsive, fullscreen 3D multiplayer space game built with SvelteKit, Threlte (Three.js), and Cloudflare Workers + Durable Objects.

## Game Overview

**Solo Mode:** Pilot your ship across the surface of a sphere, convert hostile NPCs into allied satellites, collect power-ups, and survive waves of enemies. A hidden puzzle structure exists within the sphere — not obvious when playing alone.

**Multiplayer Mode:** As players join, NPC bots decrease. The hidden puzzle reveals itself — players collaborate to align puzzle nodes into a symmetrical structure by converting NPCs and interacting with nodes directly.

## Controls

**Desktop:** WASD/Arrows to move, Mouse to aim, Click/Space to shoot, E to interact with puzzle nodes, Shift to boost.

**Mobile:** Left virtual joystick to move, Right virtual joystick to aim, Tap fire button to shoot.

## Tech Stack

- **SvelteKit** — App framework
- **Threlte** — Svelte + Three.js for 3D rendering
- **Cloudflare Workers + Durable Objects** — Real-time multiplayer (WebSocket)
- **Cloudflare Pages** — Deployment target

## Development

```bash
npm install
npm run dev
```

## Deployment to Cloudflare Pages

1. Create a new GitHub repository and push this code
2. Go to the Cloudflare dashboard -> Pages
3. Click "Create a project" -> "Connect to Git"
4. Select your repository
5. Configure build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `.svelte-kit/cloudflare`
   - **Node.js version:** 18+ (set in Environment Variables: `NODE_VERSION` = `18`)
6. Click "Save and Deploy"

## Multiplayer Server

Multiplayer runs on Cloudflare Workers with Durable Objects for room-based WebSocket connections. Each room is a Durable Object that handles:

- Player join/leave events
- Position synchronization (~20 ticks/sec server-authoritative)
- Puzzle state sharing
- Chat messages

The game gracefully falls back to solo mode when no server is available.
