import * as THREE from 'three';
import { world, sphereDistance, SPHERE_RADIUS } from './world';

/**
 * Sphere-based spatial system
 *
 * All entities live on or inside a sphere of radius SPHERE_RADIUS.
 * Visibility is determined by chord or arc distance from the player.
 * No wrapping is needed - the sphere is naturally finite and seamless.
 */

/** View distance - entities beyond this chord distance are not rendered */
export const VIEW_DISTANCE = 100;

/** Check if a position is within view range of the player (chord distance) */
export function isInViewRange(position: THREE.Vector3, viewDistance = VIEW_DISTANCE): boolean {
  return sphereDistance(world.player.position, position) <= viewDistance;
}

/**
 * Get arc (geodesic) distance between two points on the sphere surface.
 * More accurate than chord distance for large separations.
 */
export function arcDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const aN = a.clone().normalize();
  const bN = b.clone().normalize();
  const dot = THREE.MathUtils.clamp(aN.dot(bN), -1, 1);
  return Math.acos(dot) * SPHERE_RADIUS;
}

/**
 * Convert a position to spherical coordinates (latitude, longitude in radians)
 */
export function toSpherical(position: THREE.Vector3): { lat: number; lon: number; } {
  const n = position.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1));
  const lon = Math.atan2(n.x, n.z);
  return { lat, lon };
}

/**
 * Convert spherical coordinates back to a Cartesian position on the sphere
 */
export function fromSpherical(lat: number, lon: number): THREE.Vector3 {
  return new THREE.Vector3(
    SPHERE_RADIUS * Math.cos(lat) * Math.sin(lon),
    SPHERE_RADIUS * Math.sin(lat),
    SPHERE_RADIUS * Math.cos(lat) * Math.cos(lon)
  );
}

/**
 * Interface for a visible entity instance
 */
export interface VisibleInstance {
  id: string;
  position: THREE.Vector3;
}

/**
 * Get all visible entity instances within range of the player.
 * No ghost copies needed - sphere has no edges.
 */
export function getVisibleEntities<T extends { id: string; position: THREE.Vector3; destroyed?: boolean; collected?: boolean; }>(
  entities: T[],
  viewDistance = VIEW_DISTANCE
): VisibleInstance[] {
  const instances: VisibleInstance[] = [];
  for (const entity of entities) {
    if ('destroyed' in entity && entity.destroyed) continue;
    if ('collected' in entity && entity.collected) continue;
    if (sphereDistance(world.player.position, entity.position) <= viewDistance) {
      instances.push({ id: entity.id, position: entity.position });
    }
  }
  return instances;
}

/**
 * Simple seeded random number generator (mulberry32)
 */
export function seededRandom(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grid-based spatial hash for efficient proximity lookups on a sphere.
 * Uses (lat, lon) cells for O(1)-ish neighbor queries.
 */
export class SpatialHash {
  private cellSize: number;
  private grid: Map<string, Set<string>> = new Map();

  constructor(cellSizeDegrees = 10) {
    this.cellSize = (cellSizeDegrees * Math.PI) / 180;
  }

  private key(position: THREE.Vector3): string {
    const { lat, lon } = toSpherical(position);
    const cx = Math.floor(lat / this.cellSize);
    const cy = Math.floor(lon / this.cellSize);
    return `${cx},${cy}`;
  }

  clear(): void {
    this.grid.clear();
  }

  insert(id: string, position: THREE.Vector3): void {
    const k = this.key(position);
    if (!this.grid.has(k)) {
      this.grid.set(k, new Set());
    }
    this.grid.get(k)!.add(id);
  }

  query(position: THREE.Vector3, radiusDegrees: number): Set<string> {
    const results = new Set<string>();
    const { lat, lon } = toSpherical(position);
    const radiusRad = (radiusDegrees * Math.PI) / 180;
    const minLat = Math.floor((lat - radiusRad) / this.cellSize);
    const maxLat = Math.floor((lat + radiusRad) / this.cellSize);
    const minLon = Math.floor((lon - radiusRad) / this.cellSize);
    const maxLon = Math.floor((lon + radiusRad) / this.cellSize);

    for (let cx = minLat; cx <= maxLat; cx++) {
      for (let cy = minLon; cy <= maxLon; cy++) {
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
