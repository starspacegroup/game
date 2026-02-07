import * as THREE from 'three';
import { world } from './world';

/**
 * Infinite World System
 * 
 * Creates a seamless, infinite-feeling world by:
 * 1. Wrapping entity positions when they exceed bounds
 * 2. Rendering "ghost" copies of entities near edges for visual continuity
 * 3. Only rendering entities within a view distance from the player
 * 4. Using seeded procedural generation for consistent content
 */

// View distance - entities beyond this aren't rendered
export const VIEW_DISTANCE = 200;

// Edge threshold - entities within this distance from edge get ghost copies
export const EDGE_THRESHOLD = 100;

// World dimensions (should match world.ts bounds)
export const WORLD_WIDTH = () => world.bounds.x * 2;  // 4232
export const WORLD_HEIGHT = () => world.bounds.y * 2; // 4232

/**
 * Calculate the wrapped/toroidal distance between two points
 * This is the shortest distance considering world wrapping
 */
export function wrappedDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const worldW = WORLD_WIDTH();
  const worldH = WORLD_HEIGHT();

  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);

  // Take shorter wrapped path if closer
  if (dx > worldW / 2) dx = worldW - dx;
  if (dy > worldH / 2) dy = worldH - dy;

  return Math.sqrt(dx * dx + dy * dy + (a.z - b.z) ** 2);
}

/**
 * Calculate the wrapped direction vector from source to target
 * Returns a normalized direction that accounts for world wrapping
 */
export function wrappedDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const worldW = WORLD_WIDTH();
  const worldH = WORLD_HEIGHT();

  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const dz = to.z - from.z;

  // Wrap dx
  if (dx > worldW / 2) dx -= worldW;
  else if (dx < -worldW / 2) dx += worldW;

  // Wrap dy
  if (dy > worldH / 2) dy -= worldH;
  else if (dy < -worldH / 2) dy += worldH;

  const dir = new THREE.Vector3(dx, dy, dz);
  if (dir.length() > 0) dir.normalize();
  return dir;
}

/**
 * Check if an entity is within view distance of the player
 * Uses wrapped distance for toroidal world
 */
export function isInViewRange(position: THREE.Vector3, viewDistance = VIEW_DISTANCE): boolean {
  return wrappedDistance(world.player.position, position) <= viewDistance;
}

/**
 * Get all ghost positions for an entity position
 * Returns array of relative offsets where ghost copies should appear
 * for seamless edge rendering
 */
export function getGhostOffsets(position: THREE.Vector3): THREE.Vector3[] {
  const offsets: THREE.Vector3[] = [];
  const worldW = WORLD_WIDTH();
  const worldH = WORLD_HEIGHT();
  const halfW = worldW / 2;
  const halfH = worldH / 2;

  const nearLeft = position.x < -halfW + EDGE_THRESHOLD;
  const nearRight = position.x > halfW - EDGE_THRESHOLD;
  const nearBottom = position.y < -halfH + EDGE_THRESHOLD;
  const nearTop = position.y > halfH - EDGE_THRESHOLD;

  // Horizontal ghosts
  if (nearLeft) offsets.push(new THREE.Vector3(worldW, 0, 0));
  if (nearRight) offsets.push(new THREE.Vector3(-worldW, 0, 0));

  // Vertical ghosts
  if (nearBottom) offsets.push(new THREE.Vector3(0, worldH, 0));
  if (nearTop) offsets.push(new THREE.Vector3(0, -worldH, 0));

  // Corner ghosts (diagonal)
  if (nearLeft && nearBottom) offsets.push(new THREE.Vector3(worldW, worldH, 0));
  if (nearLeft && nearTop) offsets.push(new THREE.Vector3(worldW, -worldH, 0));
  if (nearRight && nearBottom) offsets.push(new THREE.Vector3(-worldW, worldH, 0));
  if (nearRight && nearTop) offsets.push(new THREE.Vector3(-worldW, -worldH, 0));

  return offsets;
}

/**
 * Get all visible render positions for an entity
 * Returns the main position plus any ghost positions that are in view range
 */
export function getVisiblePositions(position: THREE.Vector3): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];

  // Check main position
  if (isInViewRange(position)) {
    positions.push(position.clone());
  }

  // Check ghost positions
  const ghosts = getGhostOffsets(position);
  for (const offset of ghosts) {
    const ghostPos = position.clone().add(offset);
    if (isInViewRange(ghostPos)) {
      positions.push(ghostPos);
    }
  }

  return positions;
}

/**
 * Interface for a visible entity instance (main or ghost)
 */
export interface VisibleInstance {
  id: string;
  position: THREE.Vector3;
  isGhost: boolean;
}

/**
 * Get all visible instances of entities (including ghosts)
 * for efficient batch rendering
 */
export function getVisibleEntities<T extends { id: string; position: THREE.Vector3; destroyed?: boolean; collected?: boolean; }>(
  entities: T[],
  viewDistance = VIEW_DISTANCE
): VisibleInstance[] {
  const instances: VisibleInstance[] = [];

  for (const entity of entities) {
    // Skip destroyed/collected entities
    if ('destroyed' in entity && entity.destroyed) continue;
    if ('collected' in entity && entity.collected) continue;

    // Check main position
    if (wrappedDistance(world.player.position, entity.position) <= viewDistance) {
      instances.push({
        id: entity.id,
        position: entity.position.clone(),
        isGhost: false
      });
    }

    // Check ghost positions near edges
    const ghosts = getGhostOffsets(entity.position);
    for (const offset of ghosts) {
      const ghostPos = entity.position.clone().add(offset);
      if (wrappedDistance(world.player.position, ghostPos) <= viewDistance) {
        instances.push({
          id: `${entity.id}_ghost_${offset.x.toFixed(0)}_${offset.y.toFixed(0)}`,
          position: ghostPos,
          isGhost: true
        });
      }
    }
  }

  return instances;
}

/**
 * Simple seeded random number generator for deterministic procedural content
 * Uses mulberry32 algorithm
 */
export function seededRandom(seed: number): () => number {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generate a chunk seed from chunk coordinates
 * Same coordinates always produce same seed
 */
export function chunkSeed(chunkX: number, chunkY: number, baseSeed = 12345): number {
  // Cantor pairing function + base seed
  const k = ((chunkX + chunkY) * (chunkX + chunkY + 1)) / 2 + chunkY;
  return Math.abs(Math.floor(k * 73856093 + baseSeed));
}

/**
 * Grid-based spatial hash for efficient proximity lookups
 */
export class SpatialHash {
  private cellSize: number;
  private grid: Map<string, Set<string>> = new Map();

  constructor(cellSize = 50) {
    this.cellSize = cellSize;
  }

  private key(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  clear(): void {
    this.grid.clear();
  }

  insert(id: string, position: THREE.Vector3): void {
    const k = this.key(position.x, position.y);
    if (!this.grid.has(k)) {
      this.grid.set(k, new Set());
    }
    this.grid.get(k)!.add(id);
  }

  query(position: THREE.Vector3, radius: number): Set<string> {
    const results = new Set<string>();
    const minCX = Math.floor((position.x - radius) / this.cellSize);
    const maxCX = Math.floor((position.x + radius) / this.cellSize);
    const minCY = Math.floor((position.y - radius) / this.cellSize);
    const maxCY = Math.floor((position.y + radius) / this.cellSize);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const k = `${cx},${cy}`;
        const cell = this.grid.get(k);
        if (cell) {
          for (const id of cell) {
            results.add(id);
          }
        }
      }
    }

    return results;
  }
}

/**
 * Player-relative coordinate transformation helpers
 */

/**
 * Get the relative position of a point from another reference point
 * considering world wrapping (toroidal coordinates)
 */
export function getRelativePosition(point: THREE.Vector3, reference: THREE.Vector3): THREE.Vector3 {
  const worldW = WORLD_WIDTH();
  const worldH = WORLD_HEIGHT();

  let dx = point.x - reference.x;
  let dy = point.y - reference.y;
  const dz = point.z - reference.z;

  // Wrap to shortest path
  if (dx > worldW / 2) dx -= worldW;
  else if (dx < -worldW / 2) dx += worldW;

  if (dy > worldH / 2) dy -= worldH;
  else if (dy < -worldH / 2) dy += worldH;

  return new THREE.Vector3(dx, dy, dz);
}

/**
 * Calculate which "tile" of the world the player is viewing
 * Used for tiling backgrounds
 */
export function getWorldTile(position: THREE.Vector3): { tileX: number; tileY: number; } {
  const worldW = WORLD_WIDTH();
  const worldH = WORLD_HEIGHT();

  return {
    tileX: Math.floor((position.x + worldW / 2) / worldW),
    tileY: Math.floor((position.y + worldH / 2) / worldH)
  };
}
