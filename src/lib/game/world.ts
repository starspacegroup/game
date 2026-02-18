import * as THREE from 'three';

export const SPHERE_RADIUS = 100;

/** Puzzle nodes live inside the sphere at this fraction of the radius */
export const PUZZLE_INTERIOR_RADIUS = SPHERE_RADIUS * 0.55;

export interface AsteroidData {
	id: string;
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	rotation: THREE.Euler;
	rotationSpeed: THREE.Vector3;
	radius: number;
	health: number;
	maxHealth: number;
	puzzleIndex: number | null;
	destroyed: boolean;
	/** MP interpolation target — set by network, consumed by game loop */
	_serverTarget?: THREE.Vector3;
}

export interface NpcData {
	id: string;
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	rotation: THREE.Euler;
	radius: number;
	health: number;
	maxHealth: number;
	shootCooldown: number;
	destroyed: boolean;
	converted: boolean;
	conversionProgress: number;
	targetNodeId: string | null;
	orbitAngle: number;
	orbitDistance: number;
	hintTimer: number;
	hintData: string | null;
	/** MP interpolation target — set by network, consumed by game loop */
	_serverTarget?: THREE.Vector3;
}

export interface LaserData {
	id: string;
	position: THREE.Vector3;
	direction: THREE.Vector3;
	speed: number;
	life: number;
	owner: string;
	radius: number;
}

export interface PuzzleNodeData {
	id: string;
	position: THREE.Vector3;
	targetPosition: THREE.Vector3;
	radius: number;
	connected: boolean;
	color: string;
	/** Which wave this node belongs to (1-based) */
	wave: number;
	/** Index into the E8 root array (for edge lookup) */
	e8Index: number;
}

export interface PowerUpData {
	id: string;
	position: THREE.Vector3;
	type: 'health' | 'speed' | 'multishot' | 'shield';
	radius: number;
	collected: boolean;
	bobPhase: number;
}

export interface OtherPlayerBuff {
	type: string;
	expiresAt: number;
}

export interface OtherPlayerData {
	id: string;
	username: string;
	avatarUrl?: string;
	position: THREE.Vector3;
	rotation: THREE.Euler;
	health: number;
	maxHealth: number;
	activeBuffs: OtherPlayerBuff[];
	lastUpdate: number;
}

export interface PlayerState {
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	rotation: THREE.Euler;
	radius: number;
	health: number;
	maxHealth: number;
	shootCooldown: number;
	speed: number;
	score: number;
	/** Timestamp (ms) until which the player is invincible */
	damageCooldownUntil: number;
}

export const world = {
	player: {
		position: new THREE.Vector3(0, 0, SPHERE_RADIUS),
		velocity: new THREE.Vector3(0, 0, 0),
		rotation: new THREE.Euler(0, 0, 0),
		radius: 1,
		health: 100,
		maxHealth: 100,
		shootCooldown: 0,
		speed: 20,
		score: 0,
		damageCooldownUntil: 0
	} as PlayerState,
	/** Persistent tangent-plane "up" for the player – parallel-transported so controls never snap to geographic poles */
	playerUp: new THREE.Vector3(0, 1, 0),
	asteroids: [] as AsteroidData[],
	npcs: [] as NpcData[],
	lasers: [] as LaserData[],
	puzzleNodes: [] as PuzzleNodeData[],
	powerUps: [] as PowerUpData[],
	otherPlayers: [] as OtherPlayerData[]
};

// ==========================================
// Sphere utility functions
// ==========================================

/** Project a position onto the sphere surface */
export function projectToSphere(position: THREE.Vector3): void {
	const len = position.length();
	if (len > 0.0001) {
		position.multiplyScalar(SPHERE_RADIUS / len);
	} else {
		position.set(0, 0, SPHERE_RADIUS);
	}
}

/** Generate a random position on the sphere surface */
export function randomSpherePosition(): THREE.Vector3 {
	const u = Math.random() * 2 - 1;
	const theta = Math.random() * Math.PI * 2;
	const r = Math.sqrt(1 - u * u);
	return new THREE.Vector3(
		r * Math.cos(theta) * SPHERE_RADIUS,
		r * Math.sin(theta) * SPHERE_RADIUS,
		u * SPHERE_RADIUS
	);
}

/** Generate a random position on the sphere near a given point */
export function randomSpherePositionNear(center: THREE.Vector3, minDist: number, maxDist: number): THREE.Vector3 {
	const { east, north } = getTangentFrame(center);
	const angle = Math.random() * Math.PI * 2;
	const dist = minDist + Math.random() * (maxDist - minDist);
	const pos = center.clone();
	pos.addScaledVector(east, Math.cos(angle) * dist);
	pos.addScaledVector(north, Math.sin(angle) * dist);
	projectToSphere(pos);
	return pos;
}

/**
 * Get tangent frame at a point on the sphere.
 * Returns orthonormal {normal, east, north} where normal points outward.
 * Uses Y-up as the reference, which is well-conditioned everywhere except
 * the two Y-axis poles (0, ±R, 0). At the poles, falls back to Z-up.
 * Player spawns at (0, 0, R) which is far from the Y-poles.
 */
export function getTangentFrame(position: THREE.Vector3): { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } {
	const normal = position.clone().normalize();

	// Primary reference: Y-axis. Perpendicularity = sqrt(1 - ny²).
	// Near Y-poles (|ny| > 0.99), switch to Z-axis.
	const ref = Math.abs(normal.y) > 0.99
		? new THREE.Vector3(0, 0, 1)
		: new THREE.Vector3(0, 1, 0);

	const east = new THREE.Vector3().crossVectors(ref, normal).normalize();
	const north = new THREE.Vector3().crossVectors(normal, east).normalize();
	return { normal, east, north };
}

/**
 * Build a quaternion that orients an object tangent to the sphere,
 * with local Z pointing along the sphere outward normal.
 */
export function getSphereOrientation(position: THREE.Vector3): THREE.Quaternion {
	const { normal, east, north } = getTangentFrame(position);
	const m = new THREE.Matrix4();
	m.makeBasis(east, north, normal);
	return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Chord distance between two points (works for collision detection) */
export function sphereDistance(a: THREE.Vector3, b: THREE.Vector3): number {
	return a.distanceTo(b);
}

/**
 * Angular proximity between a point on the sphere surface and a point inside.
 * Projects the interior point outward to the surface, then measures chord distance.
 * Used for puzzle node interaction — player on surface interacts with nodes inside.
 */
export function surfaceProximity(surfacePoint: THREE.Vector3, interiorPoint: THREE.Vector3): number {
	const projected = interiorPoint.clone();
	projectToSphere(projected); // project interior point to surface
	return surfacePoint.distanceTo(projected);
}

/**
 * Project a position to the interior puzzle radius.
 * Used for placing puzzle nodes inside the sphere.
 */
export function projectToInterior(position: THREE.Vector3): void {
	const len = position.length();
	if (len > 0.0001) {
		position.multiplyScalar(PUZZLE_INTERIOR_RADIUS / len);
	} else {
		position.set(0, 0, PUZZLE_INTERIOR_RADIUS);
	}
}

/**
 * Remove the radial (normal) component from a vector so it lies in the
 * tangent plane at `position` on the sphere.  Preserves magnitude of the
 * tangential part (does NOT re-normalise).
 */
export function projectToTangent(vec: THREE.Vector3, position: THREE.Vector3): void {
	const normal = position.clone().normalize();
	vec.addScaledVector(normal, -vec.dot(normal));
}

/** Direction from one point to another, projected onto tangent plane at 'from' */
export function sphereDirection(from: THREE.Vector3, to: THREE.Vector3): { dx: number; dy: number; dz: number; dist: number; } {
	const normal = from.clone().normalize();
	const d = new THREE.Vector3().subVectors(to, from);
	const normalComp = d.dot(normal);
	d.addScaledVector(normal, -normalComp);
	const dist = d.length();
	return { dx: d.x, dy: d.y, dz: d.z, dist };
}

/** Move a position along the sphere surface */
export function moveSphere(position: THREE.Vector3, velocity: THREE.Vector3, dt: number): void {
	position.addScaledVector(velocity, dt);
	projectToSphere(position);
}

/**
 * Parallel-transport a tangent vector when the surface point moves.
 * Uses Rodrigues rotation to exactly rotate the tangent vector from the
 * old tangent plane to the new one, keeping the player's sense of "up"
 * continuous across the whole sphere without any numerical drift.
 *
 * @param tangent  The tangent vector to transport (mutated in place)
 * @param oldPosition The previous position on the sphere (before movement)
 * @param newPosition The new position on the sphere (after movement)
 */
export function transportTangent(tangent: THREE.Vector3, newPosition: THREE.Vector3, oldPosition?: THREE.Vector3): void {
	const n2 = newPosition.clone().normalize();

	if (oldPosition) {
		const n1 = oldPosition.clone().normalize();
		// Rotation axis = n1 × n2
		const axis = new THREE.Vector3().crossVectors(n1, n2);
		const sinAngle = axis.length();
		const cosAngle = n1.dot(n2);

		if (sinAngle > 1e-10) {
			// Rodrigues rotation: rotate tangent by the same rotation that maps n1→n2
			axis.multiplyScalar(1 / sinAngle); // normalize axis
			const kCrossT = new THREE.Vector3().crossVectors(axis, tangent);
			const kDotT = axis.dot(tangent);
			// v' = v*cos(θ) + (k×v)*sin(θ) + k*(k·v)*(1-cos(θ))
			tangent.multiplyScalar(cosAngle);
			tangent.addScaledVector(kCrossT, sinAngle);
			tangent.addScaledVector(axis, kDotT * (1 - cosAngle));
		}
		// If sinAngle ≈ 0, positions are the same or antipodal; no transport needed
	} else {
		// Legacy fallback: project onto tangent plane (less accurate)
		tangent.addScaledVector(n2, -tangent.dot(n2));
	}

	// Ensure tangent stays unit-length and exactly tangent
	tangent.addScaledVector(n2, -tangent.dot(n2));
	const len = tangent.length();
	if (len > 1e-6) {
		tangent.multiplyScalar(1 / len);
	} else {
		// Degenerate – fall back to geographic frame
		const { north } = getTangentFrame(newPosition);
		tangent.copy(north);
	}
}

/**
 * Get the player's local frame (east / north) from the parallel-transported
 * playerUp vector rather than the fixed geographic poles.
 */
export function getPlayerFrame(position: THREE.Vector3): { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } {
	const normal = position.clone().normalize();
	// north = playerUp (already orthogonal to normal after transport)
	const north = world.playerUp.clone();
	// east = playerUp × normal  →  matches camera screen-right
	const east = new THREE.Vector3().crossVectors(north, normal);
	const eastLen = east.length();

	// Safety: if playerUp has degenerated, return a temp geographic frame
	// but do NOT overwrite world.playerUp — let transport/reorth fix it naturally
	if (eastLen < 1e-4) {
		return getTangentFrame(position);
	}

	east.multiplyScalar(1 / eastLen);
	// Re-derive north to guarantee orthonormality (normal × east = screen-up)
	north.crossVectors(normal, east).normalize();
	return { normal, east, north };
}

// ==========================================
// Legacy aliases (used throughout codebase)
// ==========================================

export const wrappedDistance = sphereDistance;

export const wrappedDirection = sphereDirection;

export function wrapPosition(position: THREE.Vector3): void {
	projectToSphere(position);
}

/** No-op on sphere — all positions are already in 3D */
export function getRelativeToPlayer(position: THREE.Vector3): THREE.Vector3 {
	return position;
}

/**
 * Get the player's world orientation using the parallel-transported frame.
 * Use this for rendering the player ship so it matches the camera frame exactly,
 * eliminating any orientation disagreement that causes visual jitter.
 */
export function getPlayerOrientation(): THREE.Quaternion {
	const { normal, east, north } = getPlayerFrame(world.player.position);
	const m = new THREE.Matrix4();
	m.makeBasis(east, north, normal);
	return new THREE.Quaternion().setFromRotationMatrix(m);
}

/**
 * Re-orthogonalize playerUp against the current position normal.
 * Call periodically to prevent numerical drift over long play sessions.
 */
export function reorthogonalizePlayerUp(): void {
	const normal = world.player.position.clone().normalize();
	world.playerUp.addScaledVector(normal, -world.playerUp.dot(normal));
	const len = world.playerUp.length();
	if (len > 1e-6) {
		world.playerUp.multiplyScalar(1 / len);
	} else {
		const { north } = getTangentFrame(world.player.position);
		world.playerUp.copy(north);
	}
}

export function resetWorld(): void {
	world.player.position.set(0, 0, SPHERE_RADIUS);
	world.player.velocity.set(0, 0, 0);
	world.player.rotation.set(0, 0, 0);
	world.player.health = 100;
	world.player.score = 0;
	world.player.shootCooldown = 0;
	world.player.speed = 12;
	world.player.damageCooldownUntil = 0;
	// Initialize playerUp from geographic tangent frame at spawn
	const { north } = getTangentFrame(world.player.position);
	world.playerUp.copy(north);
	world.asteroids = [];
	world.npcs = [];
	world.lasers = [];
	world.puzzleNodes = [];
	world.powerUps = [];
	world.otherPlayers = [];
}
