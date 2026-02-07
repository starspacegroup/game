import * as THREE from 'three';
import type { PuzzleNodeData } from './world';

/** Check overall puzzle progress (0 to 1) */
export function checkPuzzleProgress(nodes: PuzzleNodeData[]): number {
	if (nodes.length === 0) return 0;

	let totalDist = 0;
	for (const node of nodes) {
		totalDist += node.position.distanceTo(node.targetPosition);
	}

	const avgDist = totalDist / nodes.length;
	const threshold = 35;
	return Math.max(0, Math.min(1, 1 - avgDist / threshold));
}

/** Check if the puzzle is fully solved */
export function isPuzzleSolved(nodes: PuzzleNodeData[]): boolean {
	return nodes.length > 0 && nodes.every((n) => n.position.distanceTo(n.targetPosition) < 3);
}

/** Get edges for the Kal-Toh structure (connects nearby target positions) */
export function getPuzzleConnections(nodes: PuzzleNodeData[]): [number, number][] {
	const connections: [number, number][] = [];
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const dist = nodes[i].targetPosition.distanceTo(nodes[j].targetPosition);
			if (dist < 35) {
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

/** Find the nearest puzzle node to a given position */
export function findNearestPuzzleNode(
	position: THREE.Vector3,
	nodes: PuzzleNodeData[]
): PuzzleNodeData | null {
	if (nodes.length === 0) return null;

	let nearest: PuzzleNodeData | null = null;
	let minDist = Infinity;

	for (const node of nodes) {
		const dist = position.distanceTo(node.position);
		if (dist < minDist) {
			minDist = dist;
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
		const dir = Math.abs(dx) > Math.abs(dy)
			? (dx > 0 ? 'east' : 'west')
			: (dy > 0 ? 'north' : 'south');
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
		const angle = Math.atan2(
			node.targetPosition.y - node.position.y,
			node.targetPosition.x - node.position.x
		);
		const degrees = Math.round((angle * 180) / Math.PI);
		return `Vector correction: ${degrees}° from current position`;
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
			node.targetPosition.distanceTo(n.targetPosition) < 35
		);
		return `This node connects to ${nearbyNodes.length} others in the structure`;
	}
];

export function generateHint(node: PuzzleNodeData, allNodes: PuzzleNodeData[]): string {
	const template = HINT_TEMPLATES[Math.floor(Math.random() * HINT_TEMPLATES.length)];
	return template(node, allNodes);
}
