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

// ==========================================
// Pooled temp objects — avoid per-frame GC pressure.
// Functions below return refs to these; callers must
// consume results before the next call to the same fn.
// ==========================================
const _tfNormal = new THREE.Vector3();
const _tfEast = new THREE.Vector3();
const _tfNorth = new THREE.Vector3();
const _tfRef = new THREE.Vector3();
const _tfResult: { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } = { normal: _tfNormal, east: _tfEast, north: _tfNorth };

const _pfNormal = new THREE.Vector3();
const _pfEast = new THREE.Vector3();
const _pfNorth = new THREE.Vector3();
const _pfResult: { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } = { normal: _pfNormal, east: _pfEast, north: _pfNorth };

const _soMat = new THREE.Matrix4();
const _soQuat = new THREE.Quaternion();
const _poMat = new THREE.Matrix4();
const _poQuat = new THREE.Quaternion();

const _ptNormal = new THREE.Vector3();
const _sdNormal = new THREE.Vector3();
const _sdD = new THREE.Vector3();
const _spProjected = new THREE.Vector3();
const _roNormal = new THREE.Vector3();

const _ttN2 = new THREE.Vector3();
const _ttN1 = new THREE.Vector3();
const _ttAxis = new THREE.Vector3();
const _ttKCrossT = new THREE.Vector3();

/**
 * Get tangent frame at a point on the sphere.
 * Returns orthonormal {normal, east, north} where normal points outward.
 * WARNING: returns refs to pooled vectors — consume before the next call.
 */
export function getTangentFrame(position: THREE.Vector3): { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } {
	_tfNormal.copy(position).normalize();

	// Smooth blend between Y-up and Z-up references near the poles
	// to avoid a hard discontinuity in the tangent frame
	const absY = Math.abs(_tfNormal.y);
	if (absY > 0.999) {
		_tfRef.set(0, 0, 1);
	} else if (absY > 0.9) {
		// Smoothstep blend from Y-up to Z-up between 0.9 and 0.999
		const t = (absY - 0.9) / (0.999 - 0.9);
		const smooth = t * t * (3 - 2 * t);
		_tfRef.set(0, 1 - smooth, smooth).normalize();
	} else {
		_tfRef.set(0, 1, 0);
	}

	_tfEast.crossVectors(_tfRef, _tfNormal).normalize();
	_tfNorth.crossVectors(_tfNormal, _tfEast).normalize();
	return _tfResult;
}

/**
 * Build a quaternion that orients an object tangent to the sphere,
 * with local Z pointing along the sphere outward normal.
 * WARNING: returns a ref to a pooled Quaternion — copy before the next call.
 */
export function getSphereOrientation(position: THREE.Vector3): THREE.Quaternion {
	const { normal, east, north } = getTangentFrame(position);
	_soMat.makeBasis(east, north, normal);
	return _soQuat.setFromRotationMatrix(_soMat);
}

/** Chord distance between two points (works for collision detection) */
export function sphereDistance(a: THREE.Vector3, b: THREE.Vector3): number {
	return a.distanceTo(b);
}

/** Squared chord distance — use for comparisons to avoid sqrt */
export function sphereDistanceSq(a: THREE.Vector3, b: THREE.Vector3): number {
	return a.distanceToSquared(b);
}

/**
 * Angular proximity between a point on the sphere surface and a point inside.
 * Projects the interior point outward to the surface, then measures chord distance.
 * Used for puzzle node interaction — player on surface interacts with nodes inside.
 */
export function surfaceProximity(surfacePoint: THREE.Vector3, interiorPoint: THREE.Vector3): number {
	_spProjected.copy(interiorPoint);
	projectToSphere(_spProjected);
	return surfacePoint.distanceTo(_spProjected);
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
	_ptNormal.copy(position).normalize();
	vec.addScaledVector(_ptNormal, -vec.dot(_ptNormal));
}

/** Direction from one point to another, projected onto tangent plane at 'from' */
export function sphereDirection(from: THREE.Vector3, to: THREE.Vector3): { dx: number; dy: number; dz: number; dist: number; } {
	_sdNormal.copy(from).normalize();
	_sdD.subVectors(to, from);
	const normalComp = _sdD.dot(_sdNormal);
	_sdD.addScaledVector(_sdNormal, -normalComp);
	const dist = _sdD.length();
	return { dx: _sdD.x, dy: _sdD.y, dz: _sdD.z, dist };
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
	_ttN2.copy(newPosition).normalize();

	if (oldPosition) {
		_ttN1.copy(oldPosition).normalize();
		_ttAxis.crossVectors(_ttN1, _ttN2);
		const sinAngle = _ttAxis.length();
		const cosAngle = _ttN1.dot(_ttN2);

		if (sinAngle > 1e-10) {
			_ttAxis.multiplyScalar(1 / sinAngle);
			_ttKCrossT.crossVectors(_ttAxis, tangent);
			const kDotT = _ttAxis.dot(tangent);
			tangent.multiplyScalar(cosAngle);
			tangent.addScaledVector(_ttKCrossT, sinAngle);
			tangent.addScaledVector(_ttAxis, kDotT * (1 - cosAngle));
		}
	} else {
		tangent.addScaledVector(_ttN2, -tangent.dot(_ttN2));
	}

	tangent.addScaledVector(_ttN2, -tangent.dot(_ttN2));
	const len = tangent.length();
	if (len > 1e-6) {
		tangent.multiplyScalar(1 / len);
	} else {
		const { north } = getTangentFrame(newPosition);
		tangent.copy(north);
	}
}

/**
 * Get the player's local frame (east / north) from the parallel-transported
 * playerUp vector rather than the fixed geographic poles.
 */
export function getPlayerFrame(position: THREE.Vector3): { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } {
	_pfNormal.copy(position).normalize();
	_pfNorth.copy(world.playerUp);
	_pfEast.crossVectors(_pfNorth, _pfNormal);
	const eastLen = _pfEast.length();

	if (eastLen < 1e-4) {
		return getTangentFrame(position);
	}

	_pfEast.multiplyScalar(1 / eastLen);
	_pfNorth.crossVectors(_pfNormal, _pfEast).normalize();
	return _pfResult;
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
	_poMat.makeBasis(east, north, normal);
	return _poQuat.setFromRotationMatrix(_poMat);
}

/**
 * Re-orthogonalize playerUp against the current position normal.
 * Call periodically to prevent numerical drift over long play sessions.
 */
export function reorthogonalizePlayerUp(): void {
	_roNormal.copy(world.player.position).normalize();
	world.playerUp.addScaledVector(_roNormal, -world.playerUp.dot(_roNormal));
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
