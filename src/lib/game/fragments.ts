/**
 * E8 Fragment Generation System
 *
 * When a player completes the E8 puzzle, a unique "fragment" is generated
 * from a deterministic seed. 12 fragments form a meta-puzzle. Each fragment
 * contains procedurally generated lore, a title, and glyph parameters.
 *
 * Fragments are seeded so the same seed always produces the same content.
 */

// ===========================
// Types
// ===========================

export interface FragmentData {
  /** Unique fragment ID (hash-based) */
  id: string;
  /** Fragment index 0-11 (which archetype) */
  index: number;
  /** Deterministic seed string */
  seed: string;
  /** Generated title */
  title: string;
  /** Generated lore text (2-3 sentences) */
  loreText: string;
  /** 8 floats that control the procedural glyph visual */
  glyphParams: number[];
  /** ISO timestamp when unlocked */
  unlockedAt: string;
  /** Game session that produced this fragment */
  gameSessionId: string;
}

export interface FragmentCollection {
  fragments: FragmentData[];
  metaSolved: boolean;
  metaSolvedAt?: string;
}

export const TOTAL_FRAGMENTS = 12;

// ===========================
// Seeded PRNG (splitmix32)
// ===========================

function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x9e3779b9) | 0;
    let t = seed ^ (seed >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

function seededRng(seedStr: string): () => number {
  return splitmix32(hashString(seedStr));
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ===========================
// Seed generation
// ===========================

export function generateFragmentSeed(userId: string, sessionId: string, solveTimestamp: number): string {
  // Combine user, session, and timestamp into a deterministic seed
  const raw = `e8frag:${userId}:${sessionId}:${solveTimestamp}`;
  const h = hashString(raw);
  return h.toString(36).padStart(8, '0');
}

export function generateFragmentId(seed: string, index: number): string {
  const h = hashString(`${seed}:${index}:id`);
  return `frag_${h.toString(36).padStart(8, '0')}`;
}

// ===========================
// 12 Fragment Archetypes
// ===========================

/** Each archetype maps to an aspect of E8 / higher math / quantum physics */
const ARCHETYPES = [
  {
    domain: 'Origin Symmetry',
    e8Aspect: 'the inner shell where all roots converge',
    concepts: ['zero-point field', 'vacuum symmetry', 'origin manifold'],
  },
  {
    domain: 'Root Duality',
    e8Aspect: 'the integer roots of paired coordinates',
    concepts: ['wave-particle duality', 'entangled states', 'complementary observables'],
  },
  {
    domain: 'Golden Projection',
    e8Aspect: 'projection through H3 icosahedral symmetry',
    concepts: ['golden ratio embedding', 'quasicrystal lattice', 'Penrose tiling'],
  },
  {
    domain: 'Half-Integer Roots',
    e8Aspect: 'the 128 spinor vertices with even parity',
    concepts: ['fermion spin networks', 'half-integer quantum numbers', 'spinor geometry'],
  },
  {
    domain: 'Shell Resonance',
    e8Aspect: 'concentric shells of the 421 polytope',
    concepts: ['standing wave harmonics', 'orbital resonance', 'overtone series'],
  },
  {
    domain: 'Edge Adjacency',
    e8Aspect: 'inner-product-one connections between roots',
    concepts: ['quantum graph theory', 'adjacency eigenvalues', 'spectral gap'],
  },
  {
    domain: 'Weyl Reflection',
    e8Aspect: 'the Weyl group acting on the root system',
    concepts: ['mirror symmetry breaking', 'reflection operators', 'Coxeter chambers'],
  },
  {
    domain: 'Dynkin Encoding',
    e8Aspect: 'the simple roots encoding the full lattice',
    concepts: ['information compression', 'holographic principle', 'minimal encoding'],
  },
  {
    domain: 'Cartan Subalgebra',
    e8Aspect: 'the 8-dimensional maximal torus',
    concepts: ['dimensional reduction', 'compactified dimensions', 'Kaluza-Klein modes'],
  },
  {
    domain: 'Lie Bracket',
    e8Aspect: 'the commutation relations of E8 generators',
    concepts: ['non-commutative geometry', 'quantum uncertainty', 'gauge field curvature'],
  },
  {
    domain: 'Exceptional Holonomy',
    e8Aspect: 'the 248-dimensional adjoint representation',
    concepts: ['Calabi-Yau manifolds', 'string landscape', 'M-theory compactification'],
  },
  {
    domain: 'The Complete Lattice',
    e8Aspect: 'all 240 roots aligned in perfect symmetry',
    concepts: ['grand unification', 'theory of everything', 'cosmic coherence'],
  },
] as const;

// ===========================
// Title generation
// ===========================

const TITLE_PATTERNS = [
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `The ${pick(rng, ['Theorem', 'Axiom', 'Principle', 'Postulate', 'Law'])} of ${arch.domain}`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `${pick(rng, ['On', 'Regarding', 'Concerning'])} ${pick(rng, arch.concepts)}`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `${arch.domain}: ${pick(rng, ['A Fragment', 'Signal Decoded', 'Transmission', 'Revelation'])}`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `${pick(rng, ['First', 'Second', 'Third', 'Higher', 'Final', 'Hidden'])} ${pick(rng, ['Harmonic', 'Resonance', 'Symmetry', 'Reflection'])} of ${arch.domain}`,
] as const;

// ===========================
// Lore text generation
// ===========================

const OPENINGS = [
  'When the lattice aligns at this vertex,',
  'The pattern reveals itself:',
  'In the space between dimensions,',
  'As the roots converge,',
  'Beyond the sphere surface,',
  'The E8 structure whispers:',
  'At this frequency of symmetry,',
  'Where eight dimensions fold into three,',
  'The projection illuminates',
  'Through the golden-ratio lens,',
  'Encoded in the root system:',
  'The polytope speaks of',
] as const;

const MIDDLES = [
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `${pick(rng, arch.concepts)} ${pick(rng, ['emerges from', 'is encoded within', 'resonates through', 'unfolds across'])} ${arch.e8Aspect}.`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `the ${pick(rng, ['hidden', 'deeper', 'fundamental', 'underlying'])} structure of ${pick(rng, arch.concepts)} ${pick(rng, ['becomes visible', 'crystallizes', 'resolves into clarity', 'reveals its nature'])}.`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `each of the 240 vertices ${pick(rng, ['carries', 'encodes', 'preserves', 'transmits'])} a ${pick(rng, ['quantum', 'geometric', 'algebraic', 'harmonic'])} signature of ${pick(rng, arch.concepts)}.`,
  (arch: (typeof ARCHETYPES)[number], rng: () => number) =>
    `${pick(rng, ['information', 'meaning', 'structure', 'pattern'])} flows along ${arch.e8Aspect}, ${pick(rng, ['connecting', 'bridging', 'unifying', 'weaving'])} ${pick(rng, arch.concepts)} into a single ${pick(rng, ['framework', 'topology', 'manifold', 'lattice'])}.`,
] as const;

const CLOSINGS = [
  'This fragment is one facet of a truth that spans all dimensions.',
  'The complete picture awaits — more vertices must align.',
  'What was scattered across eight dimensions begins to cohere.',
  'The lattice remembers what the universe forgot.',
  'Twelve fragments, twelve aspects of the exceptional structure.',
  'Each alignment brings the full symmetry closer to revelation.',
  'The E8 pattern is not discovered — it is remembered.',
  'Between these roots lies a space where physics becomes geometry.',
  'The universe computes itself through structures like this.',
  'This is not abstraction — this is the substrate of reality.',
  'In 248 dimensions, this truth needs no proof. Here, it needs 12 fragments.',
  'The answer was always geometric. The question was always: which geometry?',
] as const;

// ===========================
// Glyph parameter generation
// ===========================

function generateGlyphParams(rng: () => number): number[] {
  return [
    rng(),              // 0: primary hue (0-1)
    rng() * 0.5 + 0.5, // 1: saturation (0.5-1)
    Math.floor(rng() * 5) + 3, // 2: vertex count (3-7)
    rng() * Math.PI * 2,       // 3: rotation offset
    rng() * 0.4 + 0.1,         // 4: inner radius ratio (0.1-0.5)
    Math.floor(rng() * 3) + 1, // 5: symmetry order (1-3)
    rng() * 0.3 + 0.1,         // 6: vertex displacement (0.1-0.4)
    rng() * 0.5 + 0.5,         // 7: pulse speed (0.5-1.0)
  ];
}

// ===========================
// Fragment generation
// ===========================

export function generateFragment(
  seed: string,
  index: number,
  sessionId: string,
  unlockedAt?: string,
): FragmentData {
  if (index < 0 || index >= TOTAL_FRAGMENTS) {
    throw new Error(`Fragment index must be 0-${TOTAL_FRAGMENTS - 1}, got ${index}`);
  }

  const rng = seededRng(`${seed}:${index}`);

  const archetype = ARCHETYPES[index];

  // Generate title
  const titleFn = pick(rng, TITLE_PATTERNS);
  const title = titleFn(archetype, rng);

  // Generate lore text (opening + middle + closing)
  const opening = pick(rng, OPENINGS);
  const middleFn = pick(rng, MIDDLES);
  const middle = middleFn(archetype, rng);
  const closing = pick(rng, CLOSINGS);
  const loreText = `${opening} ${middle} ${closing}`;

  // Generate glyph parameters
  const glyphParams = generateGlyphParams(rng);

  return {
    id: generateFragmentId(seed, index),
    index,
    seed,
    title,
    loreText,
    glyphParams,
    unlockedAt: unlockedAt ?? new Date().toISOString(),
    gameSessionId: sessionId,
  };
}

/**
 * Determine which fragment index a player should receive next.
 * Returns -1 if all fragments are collected.
 */
export function getNextFragmentIndex(collection: FragmentCollection): number {
  if (collection.fragments.length >= TOTAL_FRAGMENTS) return -1;
  const owned = new Set(collection.fragments.map((f) => f.index));
  for (let i = 0; i < TOTAL_FRAGMENTS; i++) {
    if (!owned.has(i)) return i;
  }
  return -1;
}

/**
 * Create an empty fragment collection.
 */
export function emptyCollection(): FragmentCollection {
  return { fragments: [], metaSolved: false };
}

/**
 * Generate the meta-puzzle culmination text from all 12 fragment seeds.
 * This is unique per-user since each fragment has a different seed.
 */
export function generateMetaRevelation(fragments: FragmentData[]): string {
  if (fragments.length < TOTAL_FRAGMENTS) return '';

  // Sort by index to ensure deterministic ordering
  const sorted = [...fragments].sort((a, b) => a.index - b.index);

  // Combine all seeds into a master seed
  const masterSeed = sorted.map((f) => f.seed).join(':');
  const rng = seededRng(`meta:${masterSeed}`);

  const META_OPENINGS = [
    'The twelve aspects of E8 have aligned.',
    'All 240 roots resonate as one.',
    'The exceptional lattice is complete.',
    'Across twelve solves, the pattern emerged.',
  ];

  const META_BODIES = [
    'What appeared as scattered vertices in eight-dimensional space has revealed its true nature: a single, self-consistent structure encoding the symmetries of everything that can exist. The 240 roots are not points in a lattice — they are the lattice dreaming itself into being.',
    'The E8 Lie algebra is not merely exceptional — it is inevitable. Every fragment you recovered was a projection of a truth that exists independent of dimension, observer, or time. The polytope does not approximate reality. Reality approximates the polytope.',
    'From origin symmetry to the complete lattice, each fragment carried a piece of a theorem that no single dimension can contain. The proof is not mathematical — it is experiential. You have traversed the root system not as an abstraction, but as a space.',
    'Twelve perspectives on a single truth: that the deepest structure of physical law is geometric, exceptional, and beautiful. The E8 lattice does not explain the universe. It is the universe, viewed from a vantage point that only exists in eight dimensions.',
  ];

  const META_CLOSINGS = [
    'The lattice holds. The symmetry is unbroken. What you have assembled cannot be unlearned.',
    'This is not the end of the pattern. This is the resolution of its first octave.',
    'You have seen what the sphere contains. The question now is: what contains the sphere?',
    'The 421 polytope has 6720 edges, 60480 triangular faces, and one observer. You.',
  ];

  const opening = pick(rng, META_OPENINGS);
  const body = pick(rng, META_BODIES);
  const closing = pick(rng, META_CLOSINGS);

  return `${opening}\n\n${body}\n\n${closing}`;
}
