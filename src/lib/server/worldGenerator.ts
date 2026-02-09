/**
 * Server-side world generation
 * No THREE.js dependency - uses plain objects for Cloudflare Workers compatibility
 */

import type {
  AsteroidState,
  NpcState,
  PuzzleNodeState,
  PowerUpState,
  WorldBounds,
  Vector3,
  Euler3,
  PowerUpType
} from '../shared/protocol';

import {
  DEFAULT_BOUNDS,
  ASTEROID_COUNT,
  POWER_UP_COUNT,
  PUZZLE_NODE_COUNT,
  BASE_NPC_COUNT
} from '../shared/protocol';

let nextId = 0;

function genId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

export function resetIdCounter(): void {
  nextId = 0;
}

function vec3(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

function euler3(x: number, y: number, z: number): Euler3 {
  return { x, y, z };
}

/**
 * Generate asteroids for the world
 */
export function generateAsteroids(
  count: number = ASTEROID_COUNT,
  bounds: WorldBounds = DEFAULT_BOUNDS
): AsteroidState[] {
  const asteroids: AsteroidState[] = [];

  for (let i = 0; i < count; i++) {
    const radius = 0.5 + Math.random() * 3;
    asteroids.push({
      id: genId('ast'),
      position: vec3(
        (Math.random() - 0.5) * bounds.x * 2,
        (Math.random() - 0.5) * bounds.y * 2,
        (Math.random() - 0.5) * bounds.z * 0.3
      ),
      velocity: vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 0.5
      ),
      rotation: euler3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        0
      ),
      rotationSpeed: vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ),
      radius,
      health: radius * 10,
      maxHealth: radius * 10,
      destroyed: false
    });
  }

  return asteroids;
}

/**
 * Generate NPCs (hostile ships) for the world
 */
export function generateNpcs(
  count: number = BASE_NPC_COUNT,
  bounds: WorldBounds = DEFAULT_BOUNDS
): NpcState[] {
  const npcs: NpcState[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dist = 30 + Math.random() * 20;

    npcs.push({
      id: genId('npc'),
      position: vec3(
        Math.cos(angle) * dist,
        Math.sin(angle) * dist,
        0
      ),
      velocity: vec3(0, 0, 0),
      rotation: euler3(0, 0, 0),
      radius: 1.2,
      health: 30,
      maxHealth: 30,
      shootCooldown: Math.random() * 2 + 1,
      destroyed: false,
      converted: false,
      conversionProgress: 0,
      targetNodeId: null,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitDistance: 5 + Math.random() * 3
    });
  }

  return npcs;
}

/**
 * Generate puzzle nodes (hidden structure)
 * Uses icosahedron vertices as base positions
 */
export function generatePuzzleNodes(
  count: number = PUZZLE_NODE_COUNT
): PuzzleNodeState[] {
  // Icosahedron vertices — the hidden structure players must reconstruct
  const phi = (1 + Math.sqrt(5)) / 2;
  const scale = 25;

  const basePositions: [number, number, number][] = [
    [0, 1, phi],
    [0, -1, phi],
    [0, 1, -phi],
    [0, -1, -phi],
    [1, phi, 0],
    [-1, phi, 0],
    [1, -phi, 0],
    [-1, -phi, 0],
    [phi, 0, 1],
    [-phi, 0, 1],
    [phi, 0, -1],
    [-phi, 0, -1]
  ];

  return basePositions.slice(0, count).map((pos, i) => ({
    id: genId('pzl'),
    position: vec3(
      pos[0] * scale + (Math.random() - 0.5) * 30,
      pos[1] * scale + (Math.random() - 0.5) * 30,
      pos[2] * scale * 0.2 + (Math.random() - 0.5) * 5
    ),
    targetPosition: vec3(
      pos[0] * scale,
      pos[1] * scale,
      pos[2] * scale * 0.2
    ),
    radius: 1.5,
    connected: false,
    color: `hsl(${(i / count) * 360}, 70%, 60%)`
  }));
}

/**
 * Generate power-ups for the world
 */
export function generatePowerUps(
  count: number = POWER_UP_COUNT,
  bounds: WorldBounds = DEFAULT_BOUNDS
): PowerUpState[] {
  const types: PowerUpType[] = ['health', 'speed', 'multishot', 'shield'];
  const powerUps: PowerUpState[] = [];

  for (let i = 0; i < count; i++) {
    powerUps.push({
      id: genId('pwr'),
      position: vec3(
        (Math.random() - 0.5) * bounds.x * 2,
        (Math.random() - 0.5) * bounds.y * 2,
        (Math.random() - 0.5) * 3
      ),
      type: types[Math.floor(Math.random() * types.length)],
      radius: 0.8,
      collected: false
    });
  }

  return powerUps;
}

/**
 * Generate a complete world state
 */
export function generateWorld(playerCount: number = 1): {
  asteroids: AsteroidState[];
  npcs: NpcState[];
  puzzleNodes: PuzzleNodeState[];
  powerUps: PowerUpState[];
} {
  resetIdCounter();

  // Reduce NPCs as more players join
  const npcCount = Math.max(0, BASE_NPC_COUNT - (playerCount - 1));

  return {
    asteroids: generateAsteroids(),
    npcs: generateNpcs(npcCount),
    puzzleNodes: generatePuzzleNodes(),
    powerUps: generatePowerUps()
  };
}

/**
 * Create initial player state at spawn point
 */
export function createPlayerState(id: string, username: string): import('../shared/protocol').PlayerState {
  return {
    id,
    username,
    position: vec3(0, 0, 0),
    velocity: vec3(0, 0, 0),
    rotation: euler3(0, 0, 0),
    health: 100,
    maxHealth: 100,
    score: 0,
    speed: 20,
    shootCooldown: 0
  };
}

/**
 * Respawn an asteroid at a new position
 */
export function respawnAsteroid(bounds: WorldBounds = DEFAULT_BOUNDS): AsteroidState {
  const radius = 0.5 + Math.random() * 3;
  return {
    id: genId('ast'),
    position: vec3(
      (Math.random() - 0.5) * bounds.x * 2,
      (Math.random() - 0.5) * bounds.y * 2,
      (Math.random() - 0.5) * bounds.z * 0.3
    ),
    velocity: vec3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.5
    ),
    rotation: euler3(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      0
    ),
    rotationSpeed: vec3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    ),
    radius,
    health: radius * 10,
    maxHealth: radius * 10,
    destroyed: false
  };
}

/**
 * Respawn a power-up at a new position
 */
export function respawnPowerUp(bounds: WorldBounds = DEFAULT_BOUNDS): PowerUpState {
  const types: PowerUpType[] = ['health', 'speed', 'multishot', 'shield'];
  return {
    id: genId('pwr'),
    position: vec3(
      (Math.random() - 0.5) * bounds.x * 2,
      (Math.random() - 0.5) * bounds.y * 2,
      (Math.random() - 0.5) * 3
    ),
    type: types[Math.floor(Math.random() * types.length)],
    radius: 0.8,
    collected: false
  };
}

/**
 * Respawn an NPC near a specific position (for wave spawning)
 */
export function respawnNpc(nearPosition: Vector3): NpcState {
  const angle = Math.random() * Math.PI * 2;
  const dist = 30 + Math.random() * 20;

  return {
    id: genId('npc'),
    position: vec3(
      nearPosition.x + Math.cos(angle) * dist,
      nearPosition.y + Math.sin(angle) * dist,
      0
    ),
    velocity: vec3(0, 0, 0),
    rotation: euler3(0, 0, 0),
    radius: 1.2,
    health: 30,
    maxHealth: 30,
    shootCooldown: Math.random() * 2 + 1,
    destroyed: false,
    converted: false,
    conversionProgress: 0,
    targetNodeId: null,
    orbitAngle: Math.random() * Math.PI * 2,
    orbitDistance: 5 + Math.random() * 3
  };
}
