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
