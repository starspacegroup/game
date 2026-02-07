<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getRelativeToPlayer } from '$lib/game/world';
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
			// Use wrapped positions for seamless infinite world
			const posA = getRelativeToPlayer(nodes[a].position);
			const posB = getRelativeToPlayer(nodes[b].position);
			positions[i6] = posA.x;
			positions[i6 + 1] = posA.y;
			positions[i6 + 2] = posA.z;
			positions[i6 + 3] = posB.x;
			positions[i6 + 4] = posB.y;
			positions[i6 + 5] = posB.z;

			const targetA = getRelativeToPlayer(nodes[a].targetPosition);
			const targetB = getRelativeToPlayer(nodes[b].targetPosition);
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
		<T.LineBasicMaterial color="#ffffff" transparent opacity={0.15} />
	</T.LineSegments>
{/if}

{#if targetLineGeometry}
	<T.LineSegments>
		<T is={targetLineGeometry} />
		<T.LineBasicMaterial color="#4488ff" transparent opacity={0.06} />
	</T.LineSegments>
{/if}
