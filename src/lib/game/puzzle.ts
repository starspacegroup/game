import * as THREE from 'three';
import type { PuzzleNodeData } from './world';
import { wrappedDistance } from './world';

/** Check overall puzzle progress (0 to 1) */
export function checkPuzzleProgress(nodes: PuzzleNodeData[]): number {
	if (nodes.length === 0) return 0;

	let totalDist = 0;
	for (const node of nodes) {
		totalDist += node.position.distanceTo(node.targetPosition);
	}

	const avgDist = totalDist / nodes.length;
	const threshold = 80; // scaled for interior sphere positions
	return Math.max(0, Math.min(1, 1 - avgDist / threshold));
}

/** Check if the puzzle is fully solved */
export function isPuzzleSolved(nodes: PuzzleNodeData[]): boolean {
	return nodes.length > 0 && nodes.every((n) => n.position.distanceTo(n.targetPosition) < 8);
}

/** Get edges for the interior icosahedral structure (connects nearby target positions) */
export function getPuzzleConnections(nodes: PuzzleNodeData[]): [number, number][] {
	const connections: [number, number][] = [];
	// With nodes inside the sphere at PUZZLE_INTERIOR_RADIUS * 0.65,
	// icosahedron edge length ≈ radius * 1.05, so threshold must be higher
	const maxEdgeLength = 100;
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const dist = nodes[i].targetPosition.distanceTo(nodes[j].targetPosition);
			if (dist < maxEdgeLength) {
				connections.push([i, j]);
			}
		}
	}
	return connections;
}

/** Generate hex grid positions for the Kadis-Kot element */
export function generateHexGrid(
	gridRadius: number,
	center: THREE.Vector3
): THREE.Vector3[] {
	const positions: THREE.Vector3[] = [];
	const hexSize = 3;

	for (let q = -gridRadius; q <= gridRadius; q++) {
		for (let r = -gridRadius; r <= gridRadius; r++) {
			const s = -q - r;
			if (Math.abs(s) <= gridRadius) {
				const x = hexSize * ((3 / 2) * q);
				const y = hexSize * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
				positions.push(new THREE.Vector3(center.x + x, center.y + y, center.z));
			}
		}
	}

	return positions;
}

/** Find the nearest unconnected puzzle node to a given position.
 *  Uses angular distance (angle between directions from sphere center)
 *  which works correctly for surface vs interior comparisons.
 *  @param excludeIds  Optional set of node IDs to deprioritize (already targeted by other NPCs).
 *                     If all untargeted nodes are connected, falls back to any nearest unconnected. */
export function findNearestPuzzleNode(
	position: THREE.Vector3,
	nodes: PuzzleNodeData[],
	_excludeIds?: Set<string>
): PuzzleNodeData | null {
	if (nodes.length === 0) return null;

	let nearest: PuzzleNodeData | null = null;
	let nearestAngle = Infinity;

	for (const node of nodes) {
		if (node.connected) continue;
		// Angular distance: angle between position vectors from sphere center
		const dot = position.dot(node.position) / (position.length() * node.position.length());
		const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
		if (angle < nearestAngle) {
			nearestAngle = angle;
			nearest = node;
		}
	}

	return nearest;
}

/** Generate a hint about the puzzle structure */
const HINT_TEMPLATES = [
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const dx = node.targetPosition.x - node.position.x;
		const dy = node.targetPosition.y - node.position.y;
		const dz = node.targetPosition.z - node.position.z;
		const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
		let dir: string;
		if (ax >= ay && ax >= az) dir = dx > 0 ? 'starboard' : 'port';
		else if (ay >= az) dir = dy > 0 ? 'skyward' : 'coreward';
		else dir = dz > 0 ? 'forward' : 'aft';
		return `Data suggests node should shift ${dir}...`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const dist = node.position.distanceTo(node.targetPosition);
		if (dist < 10) return 'Node alignment nearly complete!';
		if (dist < 20) return 'Node getting closer to target...';
		return 'Node requires significant repositioning...';
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const connected = nodes.filter(n => n.connected).length;
		return `${connected}/${nodes.length} nodes aligned. Structure emerging...`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const dist = node.position.distanceTo(node.targetPosition);
		const pct = Math.max(0, 100 - (dist / 2));
		return `Alignment: ${pct.toFixed(0)}% — vector correction needed`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		return node.connected
			? 'This node is locked in place. Well done!'
			: 'Approaching node will enable alignment...';
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const targetDist = node.position.distanceTo(node.targetPosition);
		return `Distance to target: ${targetDist.toFixed(1)} units`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		// Hint about the icosahedral structure
		return 'Detecting geometric resonance... icosahedral symmetry?';
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const nearbyNodes = nodes.filter(n =>
			n.id !== node.id &&
			node.targetPosition.distanceTo(n.targetPosition) < 250
		);
		return `This node connects to ${nearbyNodes.length} others in the structure`;
	}
];

export function generateHint(node: PuzzleNodeData, allNodes: PuzzleNodeData[]): string {
	const template = HINT_TEMPLATES[Math.floor(Math.random() * HINT_TEMPLATES.length)];
	return template(node, allNodes);
}
