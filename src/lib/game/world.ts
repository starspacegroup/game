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
	bounds: { x: 400, y: 300, z: 40 }
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
}
