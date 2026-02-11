<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';
	import { getPuzzleConnections } from '$lib/game/puzzle';
	import PuzzleNode from './PuzzleNode.svelte';

	let lineGeometry: THREE.BufferGeometry | undefined = $state();
	let targetLineGeometry: THREE.BufferGeometry | undefined = $state();
	let updateTimer = 0;

	// Cache connections (they don't change)
	let connections: [number, number][] = [];

	// Track node count so we recompute connections if nodes change
	let lastNodeCount = 0;

	useTask((delta) => {
		const nodes = world.puzzleNodes;
		if (nodes.length === 0) return;

		// Only update geometry 5 times per second
		updateTimer += delta;
		if (updateTimer < 0.2) return;
		updateTimer = 0;

		// Recompute connections if node count changed (e.g. multiplayer sync)
		if (connections.length === 0 || nodes.length !== lastNodeCount) {
			connections = getPuzzleConnections(nodes);
			lastNodeCount = nodes.length;
		}

		const positions = new Float32Array(connections.length * 6);
		const targetPositions = new Float32Array(connections.length * 6);

		for (let i = 0; i < connections.length; i++) {
			const [a, b] = connections[i];
			if (a >= nodes.length || b >= nodes.length) continue;
			const i6 = i * 6;
			// Direct 3D positions on sphere surface
			const posA = nodes[a].position;
			const posB = nodes[b].position;
			positions[i6] = posA.x;
			positions[i6 + 1] = posA.y;
			positions[i6 + 2] = posA.z;
			positions[i6 + 3] = posB.x;
			positions[i6 + 4] = posB.y;
			positions[i6 + 5] = posB.z;

			const targetA = nodes[a].targetPosition;
			const targetB = nodes[b].targetPosition;
			targetPositions[i6] = targetA.x;
			targetPositions[i6 + 1] = targetA.y;
			targetPositions[i6 + 2] = targetA.z;
			targetPositions[i6 + 3] = targetB.x;
			targetPositions[i6 + 4] = targetB.y;
			targetPositions[i6 + 5] = targetB.z;
		}

		if (!lineGeometry) {
			lineGeometry = new THREE.BufferGeometry();
		}
		lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		lineGeometry.attributes.position.needsUpdate = true;

		if (!targetLineGeometry) {
			targetLineGeometry = new THREE.BufferGeometry();
		}
		targetLineGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(targetPositions, 3)
		);
	});
</script>

{#each world.puzzleNodes as node (node.id)}
	<PuzzleNode
		position={node.position}
		targetPosition={node.targetPosition}
		connected={node.connected}
		color={node.color}
	/>
{/each}

{#if lineGeometry}
	<T.LineSegments>
		<T is={lineGeometry} />
		<T.LineBasicMaterial color="#ffffff" transparent opacity={0.3} />
	</T.LineSegments>
{/if}

{#if targetLineGeometry}
	<T.LineSegments>
		<T is={targetLineGeometry} />
		<T.LineBasicMaterial color="#4488ff" transparent opacity={0.12} />
	</T.LineSegments>
{/if}
