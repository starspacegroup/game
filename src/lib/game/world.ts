import * as THREE from 'three';

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
	// Conversion system
	converted: boolean;
	conversionProgress: number; // 0-1, visual effect during conversion
	targetNodeId: string | null; // Which puzzle node to orbit
	orbitAngle: number; // Current angle around the puzzle node
	orbitDistance: number; // Distance from puzzle node center
	hintTimer: number; // Time until next hint is generated
	hintData: string | null; // Current hint being transmitted
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
		position: new THREE.Vector3(0, 0, 0),
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
	// World size: 4232 x 4232 (bounds are half-width/half-height from center)
	bounds: { x: 2116, y: 2116, z: 40 }
};

// Wrap a position to create an infinite/borderless world
export function wrapPosition(position: THREE.Vector3): void {
	const bx = world.bounds.x;
	const by = world.bounds.y;

	if (position.x > bx) position.x -= bx * 2;
	else if (position.x < -bx) position.x += bx * 2;

	if (position.y > by) position.y -= by * 2;
	else if (position.y < -by) position.y += by * 2;
}

// Get wrapped (toroidal) distance between two points - shortest path considering wrapping
export function wrappedDistance(a: THREE.Vector3, b: THREE.Vector3): number {
	const worldW = world.bounds.x * 2;
	const worldH = world.bounds.y * 2;

	let dx = Math.abs(a.x - b.x);
	let dy = Math.abs(a.y - b.y);

	// Take shorter wrapped path
	if (dx > worldW / 2) dx = worldW - dx;
	if (dy > worldH / 2) dy = worldH - dy;

	return Math.sqrt(dx * dx + dy * dy + (a.z - b.z) ** 2);
}

// Get wrapped direction from source to target (shortest path)
export function wrappedDirection(from: THREE.Vector3, to: THREE.Vector3): { dx: number; dy: number; dz: number; dist: number; } {
	const worldW = world.bounds.x * 2;
	const worldH = world.bounds.y * 2;

	let dx = to.x - from.x;
	let dy = to.y - from.y;
	const dz = to.z - from.z;

	// Wrap to shortest path
	if (dx > worldW / 2) dx -= worldW;
	else if (dx < -worldW / 2) dx += worldW;

	if (dy > worldH / 2) dy -= worldH;
	else if (dy < -worldH / 2) dy += worldH;

	const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
	return { dx, dy, dz, dist };
}

// Get relative position considering world wrapping (for rendering)
export function getRelativeToPlayer(position: THREE.Vector3): THREE.Vector3 {
	const worldW = world.bounds.x * 2;
	const worldH = world.bounds.y * 2;

	let dx = position.x - world.player.position.x;
	let dy = position.y - world.player.position.y;

	// Wrap to shortest path
	if (dx > worldW / 2) dx -= worldW;
	else if (dx < -worldW / 2) dx += worldW;

	if (dy > worldH / 2) dy -= worldH;
	else if (dy < -worldH / 2) dy += worldH;

	return new THREE.Vector3(
		world.player.position.x + dx,
		world.player.position.y + dy,
		position.z
	);
}

export function resetWorld(): void {
	world.player.position.set(0, 0, 0);
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
