/**
 * E8 Root System — generates the 240 root vectors of the E8 Lie algebra,
 * projects them to 3D for visualization inside the game sphere.
 *
 * Based on the "even coordinate system" construction from:
 * https://en.wikipedia.org/wiki/E8_(mathematics)#Construction
 *
 * The root system lives in R8. There are 240 roots:
 *   112 "integer" roots: permutations of (±1, ±1, 0, 0, 0, 0, 0, 0)
 *   128 "half-integer" roots: (±½)^8 with even number of minus signs
 *
 * Projected to 3D using H3 symmetry basis vectors (golden ratio projection),
 * producing concentric icosahedral shells — the 421 polytope.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * H3 symmetry projection basis (from Wikipedia E8 article).
 * These project the 8D root system into 3D with icosahedral symmetry.
 */
const U = [1, PHI, 0, -1, PHI, 0, 0, 0];
const V = [PHI, 0, 1, PHI, 0, -1, 0, 0];
const W = [0, 1, PHI, 0, -1, PHI, 0, 0];

function dot8(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < 8; i++) s += a[i] * b[i];
  return s;
}

export interface E8Root {
  /** 8D root coordinates */
  coords8d: number[];
  /** Projected 3D position */
  x: number;
  y: number;
  z: number;
  /** Radial distance from origin in 3D projection */
  radius3d: number;
  /** Shell index (0-based, sorted by radius) */
  shell: number;
  /** Wave assignment (1-based) */
  wave: number;
}

/**
 * Generate all 240 E8 root vectors in 8D.
 *
 * Integer roots (112): all permutations of (±1, ±1, 0, 0, 0, 0, 0, 0)
 * Half-integer roots (128): (±½)^8 with even number of minus signs
 */
function generateE8Roots8D(): number[][] {
  const roots: number[][] = [];

  // Integer roots: choose 2 of 8 positions, each ±1
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const root = [0, 0, 0, 0, 0, 0, 0, 0];
          root[i] = si;
          root[j] = sj;
          roots.push(root);
        }
      }
    }
  }

  // Half-integer roots: (±½)^8 with even number of negative entries
  for (let mask = 0; mask < 256; mask++) {
    let negCount = 0;
    const root = new Array(8);
    for (let bit = 0; bit < 8; bit++) {
      if (mask & (1 << bit)) {
        root[bit] = -0.5;
        negCount++;
      } else {
        root[bit] = 0.5;
      }
    }
    if (negCount % 2 === 0) {
      roots.push(root);
    }
  }

  return roots; // should be exactly 240
}

/**
 * Generate all 240 E8 roots projected to 3D, grouped into shells and waves.
 * Cached after first call.
 */
let _cachedRoots: E8Root[] | null = null;
let _cachedEdges: [number, number][] | null = null;

export function getE8Roots(): E8Root[] {
  if (_cachedRoots) return _cachedRoots;

  const roots8d = generateE8Roots8D();

  // Project each root to 3D using H3 basis
  const projected: E8Root[] = roots8d.map((coords) => {
    const x = dot8(coords, U);
    const y = dot8(coords, V);
    const z = dot8(coords, W);
    const radius3d = Math.sqrt(x * x + y * y + z * z);
    return { coords8d: coords, x, y, z, radius3d, shell: 0, wave: 1 };
  });

  // Sort by radius to identify shells
  projected.sort((a, b) => a.radius3d - b.radius3d);

  // Group into shells: cluster points with similar radius
  const SHELL_TOL = 0.15;
  let currentShell = 0;
  projected[0].shell = 0;

  for (let i = 1; i < projected.length; i++) {
    if (projected[i].radius3d - projected[i - 1].radius3d > SHELL_TOL) {
      currentShell++;
    }
    projected[i].shell = currentShell;
  }

  // Assign waves as contiguous bands of the radius-sorted roots, so the
  // structure still grows outward, but with boundaries computed for the
  // difficulty curve instead of pinned to shell edges.
  //
  // The previous mapping gave one wave per shell, written against an expected
  // [4, 24, 24, 40, 48, 40, 30, 30]. The projection actually produces *seven*
  // shells, [4, 24, 40, 78, 40, 24, 30], so that mapping yielded wave sizes of
  // 28/40/78/40/24/30 — a spike at wave 3 followed by three easier waves.
  //
  // Whole shells cannot fix that: the largest shell sits in the middle, so no
  // grouping of adjacent shells is monotonic. Splitting a shell across two
  // waves is the only way to get a curve that climbs, and a partially-filled
  // shell still reads correctly in-game because past-wave nodes render locked
  // at their vertices — the shell visibly finishes filling in during the next
  // wave.
  const waveSizes = computeWaveSizes(projected.length, E8_TOTAL_WAVES);
  let cursor = 0;
  for (let w = 0; w < waveSizes.length; w++) {
    const end = Math.min(cursor + waveSizes[w], projected.length);
    for (let i = cursor; i < end; i++) {
      projected[i].wave = w + 1;
    }
    cursor = end;
  }
  // Only reachable if the root count ever stops matching the computed sizes.
  for (let i = cursor; i < projected.length; i++) {
    projected[i].wave = E8_TOTAL_WAVES;
  }

  _cachedRoots = projected;
  return projected;
}

/**
 * How much bigger the final wave is than the average one. 0 would make every
 * wave the same size; 0.5 means the last wave is 1.5× the mean and the first
 * is 0.5×.
 */
const WAVE_RAMP = 0.5;

/**
 * Wave sizes that increase steadily and sum to exactly `total`.
 *
 * For the 240 E8 roots over 6 waves: **20, 28, 36, 44, 52, 60**.
 */
export function computeWaveSizes(total: number, waves: number): number[] {
  if (waves <= 1) return [total];

  const mean = total / waves;
  const sizes: number[] = [];
  let assigned = 0;

  for (let w = 0; w < waves; w++) {
    const t = (2 * w) / (waves - 1) - 1; // −1 on the first wave, +1 on the last
    const size = Math.max(1, Math.round(mean * (1 + WAVE_RAMP * t)));
    sizes.push(size);
    assigned += size;
  }

  // Rounding drift lands on the last wave — it is the largest, so it absorbs a
  // few nodes either way without disturbing the curve.
  sizes[waves - 1] += total - assigned;
  return sizes;
}

/**
 * Get edges of the 421 polytope: two E8 roots are edge-adjacent
 * when their 8D inner product equals 1 (distance √2 apart).
 * Cached after first computation.
 */
export function getE8Edges(): [number, number][] {
  if (_cachedEdges) return _cachedEdges;

  const roots = getE8Roots();
  const edges: [number, number][] = [];

  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      const dp = dot8(roots[i].coords8d, roots[j].coords8d);
      if (Math.abs(dp - 1) < 0.01) {
        edges.push([i, j]);
      }
    }
  }

  _cachedEdges = edges;
  return edges;
}

/**
 * Get edges that are relevant for a given wave (both endpoints ≤ wave).
 */
export function getE8EdgesForWave(wave: number): [number, number][] {
  const roots = getE8Roots();
  const allEdges = getE8Edges();
  return allEdges.filter(
    ([i, j]) => roots[i].wave <= wave && roots[j].wave <= wave
  );
}

/**
 * Get E8 roots for a specific wave.
 */
export function getE8RootsForWave(wave: number): E8Root[] {
  return getE8Roots().filter((r) => r.wave === wave);
}

/**
 * Maximum 3D radius across all projected E8 roots.
 * Used to scale the structure to fit inside the puzzle sphere.
 */
export function getE8MaxRadius(): number {
  const roots = getE8Roots();
  let max = 0;
  for (const r of roots) {
    if (r.radius3d > max) max = r.radius3d;
  }
  return max;
}

/** Total number of waves in the E8 puzzle progression */
export const E8_TOTAL_WAVES = 6;
