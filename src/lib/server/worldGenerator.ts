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
  BASE_NPC_COUNT,
  SPHERE_RADIUS
} from '../shared/protocol';

import { getE8Roots, getE8MaxRadius, E8_TOTAL_WAVES } from '../game/e8';

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

/** Get tangent frame at a point on the sphere (plain-object math) */
function getTangentFrame(pos: Vector3): { east: Vector3; north: Vector3; normal: Vector3; } {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  const normal = len > 0.001
    ? { x: pos.x / len, y: pos.y / len, z: pos.z / len }
    : { x: 0, y: 0, z: 1 };

  // Smooth blend between Y-up and Z-up references near the poles
  let ux: number, uy: number, uz: number;
  const absY = Math.abs(normal.y);
  if (absY > 0.999) {
    ux = 0; uy = 0; uz = 1;
  } else if (absY > 0.9) {
    const t = (absY - 0.9) / (0.999 - 0.9);
    const smooth = t * t * (3 - 2 * t);
    ux = 0; uy = 1 - smooth; uz = smooth;
    const rlen = Math.sqrt(uy * uy + uz * uz);
    uy /= rlen; uz /= rlen;
  } else {
    ux = 0; uy = 1; uz = 0;
  }

  let ex = uy * normal.z - uz * normal.y;
  let ey = uz * normal.x - ux * normal.z;
  let ez = ux * normal.y - uy * normal.x;
  const elen = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (elen > 0) { ex /= elen; ey /= elen; ez /= elen; }

  const nx = normal.y * ez - normal.z * ey;
  const ny = normal.z * ex - normal.x * ez;
  const nz = normal.x * ey - normal.y * ex;

  return { east: { x: ex, y: ey, z: ez }, north: { x: nx, y: ny, z: nz }, normal };
}

/** Generate a world-space tangent velocity at a position on the sphere */
function randomWorldVelocity(pos: Vector3, maxSpeed: number): Vector3 {
  const { east, north } = getTangentFrame(pos);
  const vx = (Math.random() - 0.5) * 2 * maxSpeed;
  const vy = (Math.random() - 0.5) * 2 * maxSpeed;
  return {
    x: east.x * vx + north.x * vy,
    y: east.y * vx + north.y * vy,
    z: east.z * vx + north.z * vy
  };
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
    const pos = randomSphereNear(playerStart, 10, 60);
    asteroids.push({
      id: genId('ast'),
      position: pos,
      velocity: randomWorldVelocity(pos, 1),
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
    const pos = randomSpherePos();
    asteroids.push({
      id: genId('ast'),
      position: pos,
      velocity: randomWorldVelocity(pos, 1),
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
 * Generate puzzle nodes from the E8 root system projected to 3D.
 *
 * The 240 roots of E8 are projected into the interior sphere using
 * the H3 (icosahedral) symmetry basis. Nodes are grouped into waves
 * (concentric shells of the 421 polytope).
 *
 * Past-wave nodes start connected at their target position.
 * Current-wave nodes are scattered and need to be nudged into place.
 * Future-wave nodes are not created yet.
 *
 * @param currentWave  The current wave number (1-based). All roots up to and
 *                     including this wave will be generated.
 */
export function generatePuzzleNodes(
  currentWave: number = 1
): PuzzleNodeState[] {
  const e8Roots = getE8Roots();
  const maxR = getE8MaxRadius();
  const scale = PUZZLE_INTERIOR_RADIUS * 0.85 / (maxR || 1);

  // Wave-based HSL colour palette
  const WAVE_HUES = [200, 280, 50, 120, 340, 30];

  const nodes: PuzzleNodeState[] = [];

  for (let i = 0; i < e8Roots.length; i++) {
    const root = e8Roots[i];
    if (root.wave > currentWave) continue; // future-wave nodes are hidden

    const targetX = root.x * scale;
    const targetY = root.y * scale;
    const targetZ = root.z * scale;

    // Clamp to interior radius
    let tx = targetX, ty = targetY, tz = targetZ;
    const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tlen > PUZZLE_INTERIOR_RADIUS * 0.95) {
      const clamp = (PUZZLE_INTERIOR_RADIUS * 0.95) / tlen;
      tx *= clamp; ty *= clamp; tz *= clamp;
    }

    const isPastWave = root.wave < currentWave;
    const hue = WAVE_HUES[(root.wave - 1) % WAVE_HUES.length];

    let cx: number, cy: number, cz: number;
    if (isPastWave) {
      // Already solved — sits at target
      cx = tx; cy = ty; cz = tz;
    } else {
      // Current wave — scatter from target
      const scatterFactor = 0.4 + root.wave * 0.05;
      cx = tx + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
      cy = ty + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
      cz = tz + (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
      // Keep inside the sphere
      const clen = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (clen > PUZZLE_INTERIOR_RADIUS) {
        const clampC = (PUZZLE_INTERIOR_RADIUS * 0.9) / clen;
        cx *= clampC; cy *= clampC; cz *= clampC;
      }
    }

    nodes.push({
      id: genId('pzl'),
      position: vec3(cx, cy, cz),
      targetPosition: vec3(tx, ty, tz),
      radius: 2.0,
      connected: isPastWave,
      color: `hsl(${hue}, 70%, ${isPastWave ? 50 : 60}%)`,
      wave: root.wave,
      e8Index: i
    });
  }

  return nodes;
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
  const pos = randomSpherePos();
  return {
    id: genId('ast'),
    position: pos,
    velocity: randomWorldVelocity(pos, 1),
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
