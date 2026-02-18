import * as THREE from 'three';
import type { AsteroidData, NpcData, PuzzleNodeData, PowerUpData } from './world';
import { SPHERE_RADIUS, PUZZLE_INTERIOR_RADIUS, randomSpherePosition, randomSpherePositionNear, projectToSphere, getTangentFrame } from './world';
import { getE8Roots, getE8MaxRadius, E8_TOTAL_WAVES } from './e8';

/**
 * Generate a random world-space tangent velocity for an entity on the sphere.
 * Returns a Vector3 in world space lying in the tangent plane at `position`.
 * Using world-space avoids tangent-frame discontinuities near the poles.
 */
function randomWorldVelocity(position: THREE.Vector3, maxSpeed: number): THREE.Vector3 {
	const { east, north } = getTangentFrame(position);
	const vx = (Math.random() - 0.5) * 2 * maxSpeed;
	const vy = (Math.random() - 0.5) * 2 * maxSpeed;
	return new THREE.Vector3(
		east.x * vx + north.x * vy,
		east.y * vx + north.y * vy,
		east.z * vx + north.z * vy
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
			velocity: randomWorldVelocity(pos, 1),
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
		const pos2 = randomSpherePosition();
		asteroids.push({
			id: genId('ast'),
			position: pos2,
			velocity: randomWorldVelocity(pos2, 1),
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

/**
 * Generate puzzle nodes from the E8 root system projected to 3D.
 *
 * The 240 roots of E8 are projected into the interior sphere using
 * the H3 (icosahedral) symmetry basis from:
 * https://en.wikipedia.org/wiki/E8_(mathematics)#Construction
 *
 * Nodes are grouped into waves (concentric shells of the 421 polytope).
 * Nodes from waves already solved start connected at their target position.
 * Current-wave nodes are scattered and need to be nudged into place.
 * Future-wave nodes are not created yet.
 *
 * @param currentWave  The current wave number (1-based). All roots up to and
 *                     including this wave will be generated.
 */
export function generatePuzzleNodes(currentWave = 1): PuzzleNodeData[] {
	const e8Roots = getE8Roots();
	const maxR = getE8MaxRadius();
	const scale = PUZZLE_INTERIOR_RADIUS * 0.85 / (maxR || 1);

	// Wave-based HSL colour palette
	const WAVE_HUES = [200, 280, 50, 120, 340, 30];

	const nodes: PuzzleNodeData[] = [];

	for (let i = 0; i < e8Roots.length; i++) {
		const root = e8Roots[i];
		if (root.wave > currentWave) continue; // future-wave nodes are hidden

		const targetPos = new THREE.Vector3(
			root.x * scale,
			root.y * scale,
			root.z * scale
		);

		// Clamp to interior radius
		if (targetPos.length() > PUZZLE_INTERIOR_RADIUS * 0.95) {
			targetPos.normalize().multiplyScalar(PUZZLE_INTERIOR_RADIUS * 0.95);
		}

		const isPastWave = root.wave < currentWave;
		const hue = WAVE_HUES[(root.wave - 1) % WAVE_HUES.length];

		let currentPos: THREE.Vector3;
		if (isPastWave) {
			// Already solved — sits at target
			currentPos = targetPos.clone();
		} else {
			// Current wave — scatter from target
			const scatterFactor = 0.4 + root.wave * 0.05;
			currentPos = targetPos.clone();
			currentPos.x += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
			currentPos.y += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
			currentPos.z += (Math.random() - 0.5) * PUZZLE_INTERIOR_RADIUS * scatterFactor;
			// Keep inside the sphere
			if (currentPos.length() > PUZZLE_INTERIOR_RADIUS) {
				currentPos.normalize().multiplyScalar(PUZZLE_INTERIOR_RADIUS * 0.9);
			}
		}

		nodes.push({
			id: genId('pzl'),
			position: currentPos,
			targetPosition: targetPos,
			radius: 2.0,
			connected: isPastWave,
			color: `hsl(${hue}, 70%, ${isPastWave ? 50 : 60}%)`,
			wave: root.wave,
			e8Index: i
		});
	}

	return nodes;
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
