/**
 * Server-side world generation
 * No THREE.js dependency - uses plain objects for Cloudflare Workers compatibility
 * All entities placed on the surface of a sphere with radius SPHERE_RADIUS
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
  ASTEROID_COUNT,
  POWER_UP_COUNT,
  PUZZLE_NODE_COUNT,
  BASE_NPC_COUNT,
  SPHERE_RADIUS
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

/** Normalize a plain vector and scale to sphere surface */
function projectToSphereV(pos: Vector3): Vector3 {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (len < 0.001) return { x: 0, y: 0, z: SPHERE_RADIUS };
  const scale = SPHERE_RADIUS / len;
  return { x: pos.x * scale, y: pos.y * scale, z: pos.z * scale };
}

/** Random position on the sphere surface */
function randomSpherePos(): Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return {
    x: SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta),
    y: SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta),
    z: SPHERE_RADIUS * Math.cos(phi)
  };
}

/** Random position on the sphere near a given point, between minDist and maxDist (chord) */
function randomSphereNear(center: Vector3, minDist: number, maxDist: number): Vector3 {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pos = randomSpherePos();
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    const dz = pos.z - center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= minDist && dist <= maxDist) return pos;
  }
  // Fallback: offset from center and re-project
  const angle = Math.random() * Math.PI * 2;
  const tangentDist = minDist + Math.random() * (maxDist - minDist);
  const pos = {
    x: center.x + Math.cos(angle) * tangentDist,
    y: center.y + Math.sin(angle) * tangentDist * 0.5,
    z: center.z + Math.sin(angle) * tangentDist * 0.5
  };
  return projectToSphereV(pos);
}

/**
 * Generate asteroids on the sphere surface
 */
export function generateAsteroids(
  count: number = ASTEROID_COUNT,
  _bounds?: WorldBounds
): AsteroidState[] {
  const asteroids: AsteroidState[] = [];
  const playerStart = vec3(0, 0, SPHERE_RADIUS);

  // Some near the player start
  const nearCount = Math.min(Math.floor(count * 0.15), 20);
  for (let i = 0; i < nearCount; i++) {
    const radius = 0.5 + Math.random() * 3;
    asteroids.push({
      id: genId('ast'),
      position: randomSphereNear(playerStart, 10, 60),
      velocity: vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        0
      ),
      rotation: euler3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0),
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

  // Rest across the sphere
  for (let i = nearCount; i < count; i++) {
    const radius = 0.5 + Math.random() * 3;
    asteroids.push({
      id: genId('ast'),
      position: randomSpherePos(),
      velocity: vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        0
      ),
      rotation: euler3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0),
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
 * Generate NPCs on sphere surface near player start
 */
export function generateNpcs(
  count: number = BASE_NPC_COUNT,
  _bounds?: WorldBounds
): NpcState[] {
  const npcs: NpcState[] = [];
  const playerStart = vec3(0, 0, SPHERE_RADIUS);

  for (let i = 0; i < count; i++) {
    npcs.push({
      id: genId('npc'),
      position: randomSphereNear(playerStart, 55, 100),
      velocity: vec3(0, 0, 0),
      rotation: euler3(0, 0, 0),
      radius: 1.2,
      health: 30,
      maxHealth: 30,
      shootCooldown: Math.random() * 3 + 3,
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

/** Interior radius for puzzle nodes (inside the sphere) */
const PUZZLE_INTERIOR_RADIUS = SPHERE_RADIUS * 0.55;

/**
 * Generate puzzle nodes INSIDE the sphere
 * The icosahedral structure is visible through the semi-transparent shell
 */
export function generatePuzzleNodes(
  count: number = PUZZLE_NODE_COUNT
): PuzzleNodeState[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const scale = PUZZLE_INTERIOR_RADIUS * 0.65;

  const basePositions: [number, number, number][] = [
    [0, 0, 1],   // North pole — guarantees a node near player spawn area
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]
  ];

  return basePositions.slice(0, count).map((pos, i) => {
    // Normalize icosahedron vertex and scale to interior radius
    const len = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
    const target = vec3(
      (pos[0] / len) * scale,
      (pos[1] / len) * scale,
      (pos[2] / len) * scale
    );

    // Current position: scattered from target, still inside sphere
    // First node (polar) gets less scatter to stay near spawn area
    const scatterFactor = i === 0 ? 0.15 : 0.6;
    let cx = target.x + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
    let cy = target.y + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
    let cz = target.z + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
    const clen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (clen > PUZZLE_INTERIOR_RADIUS) {
      const clamp = (PUZZLE_INTERIOR_RADIUS * 0.9) / clen;
      cx *= clamp; cy *= clamp; cz *= clamp;
    }

    return {
      id: genId('pzl'),
      position: vec3(cx, cy, cz),
      targetPosition: target,
      radius: 2.5,
      connected: false,
      color: `hsl(${(i / count) * 360}, 70%, 60%)`
    };
  });
}

/**
 * Generate power-ups on the sphere surface
 */
export function generatePowerUps(
  count: number = POWER_UP_COUNT,
  _bounds?: WorldBounds
): PowerUpState[] {
  const types: PowerUpType[] = ['health', 'speed', 'multishot', 'shield'];
  const powerUps: PowerUpState[] = [];
  const playerStart = vec3(0, 0, SPHERE_RADIUS);

  const nearCount = Math.min(Math.floor(count * 0.15), 5);
  for (let i = 0; i < nearCount; i++) {
    powerUps.push({
      id: genId('pwr'),
      position: randomSphereNear(playerStart, 15, 50),
      type: types[Math.floor(Math.random() * types.length)],
      radius: 0.8,
      collected: false
    });
  }

  for (let i = nearCount; i < count; i++) {
    powerUps.push({
      id: genId('pwr'),
      position: randomSpherePos(),
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
  const npcCount = Math.max(0, BASE_NPC_COUNT - (playerCount - 1));

  return {
    asteroids: generateAsteroids(),
    npcs: generateNpcs(npcCount),
    puzzleNodes: generatePuzzleNodes(),
    powerUps: generatePowerUps()
  };
}

/**
 * Create initial player state at spawn point on the sphere
 */
export function createPlayerState(id: string, username: string): import('../shared/protocol').PlayerState {
  return {
    id,
    username,
    position: vec3(0, 0, SPHERE_RADIUS), // "North pole" of the sphere
    velocity: vec3(0, 0, 0),
    rotation: euler3(0, 0, 0),
    health: 100,
    maxHealth: 100,
    score: 0,
    speed: 12,
    shootCooldown: 0,
    damageCooldownUntil: 0,
    lastProcessedInput: 0
  };
}

/**
 * Respawn an asteroid at a random sphere position
 */
export function respawnAsteroid(_bounds?: WorldBounds): AsteroidState {
  const radius = 0.5 + Math.random() * 3;
  return {
    id: genId('ast'),
    position: randomSpherePos(),
    velocity: vec3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      0
    ),
    rotation: euler3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0),
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
 * Respawn a power-up at a random sphere position
 */
export function respawnPowerUp(_bounds?: WorldBounds): PowerUpState {
  const types: PowerUpType[] = ['health', 'speed', 'multishot', 'shield'];
  return {
    id: genId('pwr'),
    position: randomSpherePos(),
    type: types[Math.floor(Math.random() * types.length)],
    radius: 0.8,
    collected: false
  };
}

/**
 * Respawn an NPC near a specific position on the sphere
 */
export function respawnNpc(nearPosition: Vector3): NpcState {
  return {
    id: genId('npc'),
    position: randomSphereNear(nearPosition, 55, 100),
    velocity: vec3(0, 0, 0),
    rotation: euler3(0, 0, 0),
    radius: 1.2,
    health: 30,
    maxHealth: 30,
    shootCooldown: Math.random() * 3 + 3,
    destroyed: false,
    converted: false,
    conversionProgress: 0,
    targetNodeId: null,
    orbitAngle: Math.random() * Math.PI * 2,
    orbitDistance: 5 + Math.random() * 3
  };
}
