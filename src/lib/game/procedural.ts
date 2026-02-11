import * as THREE from 'three';
import type { AsteroidData, NpcData, PuzzleNodeData, PowerUpData } from './world';
import { SPHERE_RADIUS, PUZZLE_INTERIOR_RADIUS, randomSpherePosition, randomSpherePositionNear, projectToSphere, getTangentFrame } from './world';

/**
 * Generate a random tangent-frame velocity for an entity on the sphere.
 * Returns a Vector3 where x = east speed, y = north speed, z = 0.
 * This matches the server convention used by moveSphere().
 */
function randomTangentVelocity(maxSpeed: number): THREE.Vector3 {
	return new THREE.Vector3(
		(Math.random() - 0.5) * 2 * maxSpeed,
		(Math.random() - 0.5) * 2 * maxSpeed,
		0
	);
}

let nextId = 0;
function genId(prefix: string): string {
	return `${prefix}_${nextId++}`;
}

export function resetIdCounter(): void {
	nextId = 0;
}

export function generateAsteroids(
	count: number,
	_bounds?: { x: number; y: number; z: number; }
): AsteroidData[] {
	const asteroids: AsteroidData[] = [];
	const playerStart = new THREE.Vector3(0, 0, SPHERE_RADIUS);

	// Spawn some asteroids near the player start for immediate visibility
	const nearPlayerCount = Math.min(Math.floor(count * 0.15), 20);
	for (let i = 0; i < nearPlayerCount; i++) {
		const radius = 0.5 + Math.random() * 3;
		const pos = randomSpherePositionNear(playerStart, 10, 60);
		asteroids.push({
			id: genId('ast'),
			position: pos,
			velocity: randomTangentVelocity(1),
			rotation: new THREE.Euler(
				Math.random() * Math.PI * 2,
				Math.random() * Math.PI * 2,
				0
			),
			rotationSpeed: new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2
			),
			radius,
			health: radius * 10,
			maxHealth: radius * 10,
			puzzleIndex: Math.random() < 0.15 ? i : null,
			destroyed: false
		});
	}

	// Spawn remaining asteroids across the entire sphere
	for (let i = nearPlayerCount; i < count; i++) {
		const radius = 0.5 + Math.random() * 3;
		asteroids.push({
			id: genId('ast'),
			position: randomSpherePosition(),
			velocity: randomTangentVelocity(1),
			rotation: new THREE.Euler(
				Math.random() * Math.PI * 2,
				Math.random() * Math.PI * 2,
				0
			),
			rotationSpeed: new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2
			),
			radius,
			health: radius * 10,
			maxHealth: radius * 10,
			puzzleIndex: Math.random() < 0.15 ? i : null,
			destroyed: false
		});
	}
	return asteroids;
}

export function generateNpcs(
	count: number,
	_bounds?: { x: number; y: number; z: number; }
): NpcData[] {
	const npcs: NpcData[] = [];
	const playerStart = new THREE.Vector3(0, 0, SPHERE_RADIUS);
	for (let i = 0; i < count; i++) {
		const pos = randomSpherePositionNear(playerStart, 15, 30);
		npcs.push({
			id: genId('npc'),
			position: pos,
			velocity: new THREE.Vector3(0, 0, 0),
			rotation: new THREE.Euler(0, 0, 0),
			radius: 1.2,
			health: 30,
			maxHealth: 30,
			shootCooldown: Math.random() * 2 + 1,
			destroyed: false,
			converted: false,
			conversionProgress: 0,
			targetNodeId: null,
			orbitAngle: Math.random() * Math.PI * 2,
			orbitDistance: 5 + Math.random() * 3,
			hintTimer: 3 + Math.random() * 2,
			hintData: null
		});
	}
	return npcs;
}

export function generatePuzzleNodes(count = 12): PuzzleNodeData[] {
	// Icosahedron vertices — the hidden structure inside the sphere
	// Players on the surface can see this geometry through the semi-transparent shell
	const phi = (1 + Math.sqrt(5)) / 2;
	const scale = PUZZLE_INTERIOR_RADIUS * 0.65; // Scale relative to interior radius

	const basePositions: [number, number, number][] = [
		[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
		[1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
		[phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]
	];

	return basePositions.slice(0, count).map((pos, i) => {
		// Normalize icosahedron vertex to unit length, then scale to interior radius
		const len = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
		const targetPos = new THREE.Vector3(
			(pos[0] / len) * scale,
			(pos[1] / len) * scale,
			(pos[2] / len) * scale
		);

		// Current position: scattered from target inside the sphere
		const current = targetPos.clone();
		current.x += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * 0.6;
		current.y += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * 0.6;
		current.z += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * 0.6;
		// Clamp to stay inside the sphere
		if (current.length() > PUZZLE_INTERIOR_RADIUS) {
			current.normalize().multiplyScalar(PUZZLE_INTERIOR_RADIUS * 0.9);
		}

		return {
			id: genId('pzl'),
			position: current,
			targetPosition: targetPos,
			radius: 2.5, // Bigger for visibility inside the sphere
			connected: false,
			color: `hsl(${(i / count) * 360}, 70%, 60%)`
		};
	});
}

export function generatePowerUps(
	count: number,
	_bounds?: { x: number; y: number; z: number; }
): PowerUpData[] {
	const types: PowerUpData['type'][] = ['health', 'speed', 'multishot', 'shield'];
	const powerUps: PowerUpData[] = [];
	const playerStart = new THREE.Vector3(0, 0, SPHERE_RADIUS);

	// Spawn some power-ups near the player start
	const nearPlayerCount = Math.min(Math.floor(count * 0.15), 5);
	for (let i = 0; i < nearPlayerCount; i++) {
		powerUps.push({
			id: genId('pwr'),
			position: randomSpherePositionNear(playerStart, 15, 50),
			type: types[Math.floor(Math.random() * types.length)],
			radius: 0.8,
			collected: false,
			bobPhase: Math.random() * Math.PI * 2
		});
	}

	// Remaining power-ups across the sphere
	for (let i = nearPlayerCount; i < count; i++) {
		powerUps.push({
			id: genId('pwr'),
			position: randomSpherePosition(),
			type: types[Math.floor(Math.random() * types.length)],
			radius: 0.8,
			collected: false,
			bobPhase: Math.random() * Math.PI * 2
		});
	}
	return powerUps;
}
