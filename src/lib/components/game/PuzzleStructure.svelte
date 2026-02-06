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

	useTask((delta) => {
		const nodes = world.puzzleNodes;
		if (nodes.length === 0) return;

		// Only update geometry 5 times per second
		updateTimer += delta;
		if (updateTimer < 0.2) return;
		updateTimer = 0;

		if (connections.length === 0) {
			connections = getPuzzleConnections(nodes);
		}

		const positions = new Float32Array(connections.length * 6);
		const targetPositions = new Float32Array(connections.length * 6);

		for (let i = 0; i < connections.length; i++) {
			const [a, b] = connections[i];
			const i6 = i * 6;
			positions[i6] = nodes[a].position.x;
			positions[i6 + 1] = nodes[a].position.y;
			positions[i6 + 2] = nodes[a].position.z;
			positions[i6 + 3] = nodes[b].position.x;
			positions[i6 + 4] = nodes[b].position.y;
			positions[i6 + 5] = nodes[b].position.z;

			targetPositions[i6] = nodes[a].targetPosition.x;
			targetPositions[i6 + 1] = nodes[a].targetPosition.y;
			targetPositions[i6 + 2] = nodes[a].targetPosition.z;
			targetPositions[i6 + 3] = nodes[b].targetPosition.x;
			targetPositions[i6 + 4] = nodes[b].targetPosition.y;
			targetPositions[i6 + 5] = nodes[b].targetPosition.z;
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
		<T.LineBasicMaterial color="#ffffff" transparent opacity={0.15} />
	</T.LineSegments>
{/if}

{#if targetLineGeometry}
	<T.LineSegments>
		<T is={targetLineGeometry} />
		<T.LineBasicMaterial color="#4488ff" transparent opacity={0.06} />
	</T.LineSegments>
{/if}
