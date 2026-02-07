import * as THREE from 'three';
import type { AsteroidData, NpcData, PuzzleNodeData, PowerUpData } from './world';

let nextId = 0;
function genId(prefix: string): string {
	return `${prefix}_${nextId++}`;
}

export function resetIdCounter(): void {
	nextId = 0;
}

export function generateAsteroids(
	count: number,
	bounds: { x: number; y: number; z: number; }
): AsteroidData[] {
	const asteroids: AsteroidData[] = [];
	for (let i = 0; i < count; i++) {
		const radius = 0.5 + Math.random() * 3;
		asteroids.push({
			id: genId('ast'),
			position: new THREE.Vector3(
				(Math.random() - 0.5) * bounds.x * 2,
				(Math.random() - 0.5) * bounds.y * 2,
				(Math.random() - 0.5) * bounds.z * 0.3
			),
			velocity: new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 0.5
			),
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
	bounds: { x: number; y: number; z: number; }
): NpcData[] {
	const npcs: NpcData[] = [];
	for (let i = 0; i < count; i++) {
		const angle = (i / count) * Math.PI * 2;
		const dist = 30 + Math.random() * 20;
		npcs.push({
			id: genId('npc'),
			position: new THREE.Vector3(
				Math.cos(angle) * dist,
				Math.sin(angle) * dist,
				0
			),
			velocity: new THREE.Vector3(0, 0, 0),
			rotation: new THREE.Euler(0, 0, 0),
			radius: 1.2,
			health: 30,
			maxHealth: 30,
			shootCooldown: Math.random() * 2 + 1,
			destroyed: false,
			// Conversion system - starts unconverted
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
	// Icosahedron vertices — the hidden structure players must reconstruct
	const phi = (1 + Math.sqrt(5)) / 2;
	const scale = 25;

	const basePositions: [number, number, number][] = [
		[0, 1, phi],
		[0, -1, phi],
		[0, 1, -phi],
		[0, -1, -phi],
		[1, phi, 0],
		[-1, phi, 0],
		[1, -phi, 0],
		[-1, -phi, 0],
		[phi, 0, 1],
		[-phi, 0, 1],
		[phi, 0, -1],
		[-phi, 0, -1]
	];

	return basePositions.slice(0, count).map((pos, i) => ({
		id: genId('pzl'),
		position: new THREE.Vector3(
			pos[0] * scale + (Math.random() - 0.5) * 30,
			pos[1] * scale + (Math.random() - 0.5) * 30,
			pos[2] * scale * 0.2 + (Math.random() - 0.5) * 5
		),
		targetPosition: new THREE.Vector3(
			pos[0] * scale,
			pos[1] * scale,
			pos[2] * scale * 0.2
		),
		radius: 1.5,
		connected: false,
		color: `hsl(${(i / count) * 360}, 70%, 60%)`
	}));
}

export function generatePowerUps(
	count: number,
	bounds: { x: number; y: number; z: number; }
): PowerUpData[] {
	const types: PowerUpData['type'][] = ['health', 'speed', 'multishot', 'shield'];
	const powerUps: PowerUpData[] = [];
	for (let i = 0; i < count; i++) {
		powerUps.push({
			id: genId('pwr'),
			position: new THREE.Vector3(
				(Math.random() - 0.5) * bounds.x * 2,
				(Math.random() - 0.5) * bounds.y * 2,
				(Math.random() - 0.5) * 3
			),
			type: types[Math.floor(Math.random() * types.length)],
			radius: 0.8,
			collected: false,
			bobPhase: Math.random() * Math.PI * 2
		});
	}
	return powerUps;
}
