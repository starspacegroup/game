import * as THREE from 'three';

export const SPHERE_RADIUS = 500;

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
}

export interface PowerUpData {
	id: string;
	position: THREE.Vector3;
	type: 'health' | 'speed' | 'multishot' | 'shield';
	radius: number;
	collected: boolean;
	bobPhase: number;
}

export interface OtherPlayerData {
	id: string;
	username: string;
	position: THREE.Vector3;
	rotation: THREE.Euler;
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
		score: 0
	} as PlayerState,
	asteroids: [] as AsteroidData[],
	npcs: [] as NpcData[],
	lasers: [] as LaserData[],
	puzzleNodes: [] as PuzzleNodeData[],
	powerUps: [] as PowerUpData[],
	otherPlayers: [] as OtherPlayerData[],
	bounds: { x: SPHERE_RADIUS, y: SPHERE_RADIUS, z: SPHERE_RADIUS }
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
 * Uses smooth blending near poles to prevent "stuck on seam" artifacts.
 */
export function getTangentFrame(position: THREE.Vector3): { normal: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3; } {
	const normal = position.clone().normalize();
	const absZ = Math.abs(normal.z);

	// Two candidate reference vectors
	const refZ = new THREE.Vector3(0, 0, 1);
	const refX = new THREE.Vector3(1, 0, 0);

	// Smooth blend in the transition zone (0.7 – 0.95) to avoid seam discontinuity
	let ref: THREE.Vector3;
	if (absZ < 0.7) {
		ref = refZ;
	} else if (absZ > 0.95) {
		ref = refX;
	} else {
		// Blend factor: 0 at absZ=0.7, 1 at absZ=0.95
		const t = (absZ - 0.7) / 0.25;
		ref = refZ.clone().lerp(refX, t).normalize();
	}

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

export function resetWorld(): void {
	world.player.position.set(0, 0, SPHERE_RADIUS);
	world.player.velocity.set(0, 0, 0);
	world.player.rotation.set(0, 0, 0);
	world.player.health = 100;
	world.player.score = 0;
	world.player.shootCooldown = 0;
	world.player.speed = 20;
	world.asteroids = [];
	world.npcs = [];
	world.lasers = [];
	world.puzzleNodes = [];
	world.powerUps = [];
	world.otherPlayers = [];
}
