import * as THREE from 'three';
import type { PuzzleNodeData } from './world';
import { wrappedDistance } from './world';
import { getE8Roots, getE8Edges, getE8EdgesForWave, E8_TOTAL_WAVES } from './e8';

// ─── Wave-Aware Progress ────────────────────────────────────────────

/**
 * Check puzzle progress for the CURRENT wave only (0 to 1).
 * Only considers nodes whose `wave` equals `currentWave` and
 * that are not yet connected.
 */
export function checkPuzzleProgress(nodes: PuzzleNodeData[], currentWave?: number): number {
	const wave = currentWave ?? Math.max(1, ...nodes.map((n) => n.wave));
	const waveNodes = nodes.filter((n) => n.wave === wave);
	if (waveNodes.length === 0) return 1; // no nodes in this wave => progress complete

	let totalDist = 0;
	let connectedCount = 0;
	for (const node of waveNodes) {
		if (node.connected) {
			connectedCount++;
		} else {
			totalDist += node.position.distanceTo(node.targetPosition);
		}
	}

	// Mix of ratio-to-target and connected fraction
	const remainingNodes = waveNodes.length - connectedCount;
	if (remainingNodes === 0) return 1;

	const avgDist = totalDist / remainingNodes;
	const threshold = 40; // tuned for interior sphere scale
	const distProgress = Math.max(0, Math.min(1, 1 - avgDist / threshold));
	const connectedFraction = connectedCount / waveNodes.length;

	// Weighted average — both distance and lock-ins contribute
	return connectedFraction * 0.6 + distProgress * 0.4;
}

/**
 * Check if the current wave is fully solved (all wave nodes connected).
 */
export function isWaveSolved(nodes: PuzzleNodeData[], currentWave: number): boolean {
	const waveNodes = nodes.filter((n) => n.wave === currentWave);
	return waveNodes.length > 0 && waveNodes.every((n) => n.connected);
}

/**
 * Legacy: check if ALL puzzle nodes are solved (all waves complete).
 */
export function isPuzzleSolved(nodes: PuzzleNodeData[]): boolean {
	return nodes.length > 0 && nodes.every((n) => n.connected);
}

// ─── E8 Connections ─────────────────────────────────────────────────

/**
 * Get edges for the E8 lattice structure, filtered to nodes present
 * in the current scene (up to `currentWave`).
 *
 * Returns pairs of indices into the `nodes` array.
 * Edges come from the 421 polytope (E8 inner product = 1).
 */
export function getPuzzleConnections(
	nodes: PuzzleNodeData[],
	currentWave?: number
): [number, number][] {
	if (nodes.length === 0) return [];

	// Build a map from e8Index → local node array index
	const e8ToLocal = new Map<number, number>();
	for (let i = 0; i < nodes.length; i++) {
		e8ToLocal.set(nodes[i].e8Index, i);
	}

	const wave = currentWave ?? E8_TOTAL_WAVES;
	const e8Edges = getE8EdgesForWave(wave);
	const localEdges: [number, number][] = [];

	for (const [ei, ej] of e8Edges) {
		const li = e8ToLocal.get(ei);
		const lj = e8ToLocal.get(ej);
		if (li !== undefined && lj !== undefined) {
			localEdges.push([li, lj]);
		}
	}

	return localEdges;
}

// ─── NPC Targeting ──────────────────────────────────────────────────

/** Find the nearest unconnected puzzle node to a given position.
 *  Uses chord distance from the NPC's surface position to the surface
 *  projection of each node, which directly represents travel distance.
 *  @param excludeIds  Optional set of node IDs to deprioritize (already targeted by other NPCs).
 *  @param currentWave  Only consider nodes from this wave (skip past / future). */
export function findNearestPuzzleNode(
	position: THREE.Vector3,
	nodes: PuzzleNodeData[],
	excludeIds?: Set<string>,
	currentWave?: number
): PuzzleNodeData | null {
	if (nodes.length === 0) return null;

	const posLen = position.length();
	if (posLen < 0.001) return null;

	let bestUntargeted: PuzzleNodeData | null = null;
	let bestUntargetedDist = Infinity;
	let bestOverall: PuzzleNodeData | null = null;
	let bestOverallDist = Infinity;

	for (const node of nodes) {
		if (node.connected) continue;
		// Only consider nodes from the active wave
		if (currentWave !== undefined && node.wave !== currentWave) continue;

		const nodeLen = node.position.length();
		if (nodeLen < 0.001) continue;
		const scale = posLen / nodeLen;
		const projX = node.position.x * scale;
		const projY = node.position.y * scale;
		const projZ = node.position.z * scale;

		const dx = position.x - projX;
		const dy = position.y - projY;
		const dz = position.z - projZ;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

		if (dist < bestOverallDist) {
			bestOverallDist = dist;
			bestOverall = node;
		}

		const isTargeted = excludeIds && excludeIds.has(node.id);
		if (!isTargeted && dist < bestUntargetedDist) {
			bestUntargetedDist = dist;
			bestUntargeted = node;
		}
	}

	return bestUntargeted ?? bestOverall;
}

// ─── Hints ──────────────────────────────────────────────────────────

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
		return `E8 resonance suggests node should shift ${dir}...`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const dist = node.position.distanceTo(node.targetPosition);
		if (dist < 5) return 'Node alignment nearly complete — E8 vertex locking!';
		if (dist < 15) return 'Node approaching E8 lattice position...';
		return 'Node requires significant repositioning toward its E8 vertex...';
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const waveNodes = nodes.filter((n) => n.wave === node.wave);
		const connected = waveNodes.filter((n) => n.connected).length;
		return `${connected}/${waveNodes.length} nodes aligned in this shell. E8 structure emerging...`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const dist = node.position.distanceTo(node.targetPosition);
		const pct = Math.max(0, 100 - (dist / 0.8));
		return `Lattice alignment: ${pct.toFixed(0)}% — vector correction needed`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		return node.connected
			? 'This vertex is locked into the E8 lattice. Well done!'
			: 'Approaching node will nudge it toward E8 symmetry...';
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const targetDist = node.position.distanceTo(node.targetPosition);
		return `Distance to E8 vertex: ${targetDist.toFixed(1)} units`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		return `Detecting deepening symmetry... 240-vertex polytope resonance at wave ${node.wave}`;
	},
	(node: PuzzleNodeData, nodes: PuzzleNodeData[]) => {
		const nearbyNodes = nodes.filter(
			(n) =>
				n.id !== node.id &&
				node.targetPosition.distanceTo(n.targetPosition) < 30
		);
		return `This vertex connects to ${nearbyNodes.length} others in the {4,2,1} polytope`;
	}
];

export function generateHint(node: PuzzleNodeData, allNodes: PuzzleNodeData[]): string {
	const template = HINT_TEMPLATES[Math.floor(Math.random() * HINT_TEMPLATES.length)];
	return template(node, allNodes);
}

// ─── Hex Grid (unchanged) ───────────────────────────────────────────

/** Generate hex grid positions for the strategic area */
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