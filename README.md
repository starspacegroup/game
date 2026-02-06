# Starspace Puzzle Wars

A mobile-first, responsive, fullscreen 3D multiplayer space game built with SvelteKit, Threlte (Three.js), and Socket.io.

## Game Overview

**Solo Mode:** Classic 3D Asteroids — pilot your ship, destroy NPCs, collect power-ups, and survive waves of enemies. The asteroid field hides a secret puzzle structure (Kal-Toh) that isn't obvious when playing alone.

**Multiplayer Mode:** As players join, NPC bots decrease. The hidden puzzle reveals itself — players collaborate to align puzzle nodes into a symmetrical polyhedron, inspired by Star Trek's Kal-Toh. Strategic hex-grid elements (Kadis-Kot) and combat (Kotra) add depth.

## Controls

**Desktop:** WASD/Arrows to move, Mouse to aim, Click/Space to shoot, E to interact with puzzle nodes, Shift to boost.

**Mobile:** Left virtual joystick to move, Right virtual joystick to aim, Tap fire button to shoot.

## Tech Stack

- **SvelteKit** — App framework
- **Threlte** — Svelte + Three.js for 3D rendering
- **Socket.io** — Real-time multiplayer (requires separate server)
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

The game includes Socket.io client integration. To enable multiplayer, run a separate Node.js Socket.io server that handles:

- Player join/leave events
- Position synchronization
- Puzzle state sharing
- Chat messages

The game gracefully falls back to solo mode when no server is available.
