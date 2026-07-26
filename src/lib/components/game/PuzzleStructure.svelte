<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { getPuzzleConnections } from '$lib/game/puzzle';
	import PuzzleNode from './PuzzleNode.svelte';

	let lineGeometry: THREE.BufferGeometry | undefined = $state();
	let targetLineGeometry: THREE.BufferGeometry | undefined = $state();
	let connectedLineGeometry: THREE.BufferGeometry | undefined = $state();
	/** Node → its own slot, for the node the player can currently align. */
	let tetherGeometry: THREE.BufferGeometry | undefined = $state();
	let updateTimer = 0;

	/** The slot the actionable node is heading for, so it can be marked. */
	let slotMarker = $state<{ x: number; y: number; z: number; } | null>(null);

	// Cache connections (recomputed when wave changes)
	let connections: [number, number][] = [];
	let lastNodeCount = 0;
	let lastWave = 0;

	useTask((delta) => {
		const nodes = world.puzzleNodes;
		if (nodes.length === 0) return;

		// The tether tracks a moving node, so it updates every frame — it is two
		// points, unlike the edge rebuild below which is throttled.
		const activeId = gameState.nodeInRange?.id;
		const active = activeId ? nodes.find((n) => n.id === activeId) : undefined;
		if (active && !active.connected) {
			if (!tetherGeometry) tetherGeometry = new THREE.BufferGeometry();
			tetherGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
				active.position.x, active.position.y, active.position.z,
				active.targetPosition.x, active.targetPosition.y, active.targetPosition.z
			]), 3));
			tetherGeometry.attributes.position.needsUpdate = true;
			const t = active.targetPosition;
			if (!slotMarker || slotMarker.x !== t.x || slotMarker.y !== t.y || slotMarker.z !== t.z) {
				slotMarker = { x: t.x, y: t.y, z: t.z };
			}
		} else if (slotMarker) {
			slotMarker = null;
			if (tetherGeometry) {
				tetherGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([]), 3));
				tetherGeometry.attributes.position.needsUpdate = true;
			}
		}

		// Only update geometry 5 times per second
		updateTimer += delta;
		if (updateTimer < 0.2) return;
		updateTimer = 0;

		// Recompute connections if node count or wave changed
		if (connections.length === 0 || nodes.length !== lastNodeCount || gameState.wave !== lastWave) {
			connections = getPuzzleConnections(nodes, gameState.wave);
			lastNodeCount = nodes.length;
			lastWave = gameState.wave;
		}

		// Separate edges into connected (locked) and active (being aligned)
		const connectedPositions: number[] = [];
		const activePositions: number[] = [];
		const targetPositions: number[] = [];

		for (const [a, b] of connections) {
			if (a >= nodes.length || b >= nodes.length) continue;

			const posA = nodes[a].position;
			const posB = nodes[b].position;
			const targetA = nodes[a].targetPosition;
			const targetB = nodes[b].targetPosition;

			if (nodes[a].connected && nodes[b].connected) {
				// Both endpoints locked — bright connected edge
				connectedPositions.push(
					posA.x, posA.y, posA.z,
					posB.x, posB.y, posB.z
				);
			} else {
				// At least one active — show as dim active edge
				activePositions.push(
					posA.x, posA.y, posA.z,
					posB.x, posB.y, posB.z
				);
			}

			// Ghost target wireframe
			targetPositions.push(
				targetA.x, targetA.y, targetA.z,
				targetB.x, targetB.y, targetB.z
			);
		}

		// Active / in-progress edges
		if (!lineGeometry) lineGeometry = new THREE.BufferGeometry();
		lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(activePositions), 3));
		lineGeometry.attributes.position.needsUpdate = true;

		// Locked / completed edges
		if (!connectedLineGeometry) connectedLineGeometry = new THREE.BufferGeometry();
		connectedLineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(connectedPositions), 3));
		connectedLineGeometry.attributes.position.needsUpdate = true;

		// Target ghost wireframe
		if (!targetLineGeometry) targetLineGeometry = new THREE.BufferGeometry();
		targetLineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(targetPositions), 3));
		targetLineGeometry.attributes.position.needsUpdate = true;
	});
</script>

{#each world.puzzleNodes as node (node.id)}
	<PuzzleNode
		position={node.position}
		targetPosition={node.targetPosition}
		connected={node.connected}
		color={node.color}
		nodeWave={node.wave}
		currentWave={gameState.wave}
		radius={node.radius}
	/>
{/each}

<!-- Tether from the actionable node to the slot it is travelling to. Nothing
     previously showed an individual node's destination — the ghost wireframe
     draws slot-to-slot edges, which is the finished shape, not where this node
     is going. -->
{#if tetherGeometry}
	<T.LineSegments>
		<T is={tetherGeometry} />
		<T.LineBasicMaterial color="#00ffcc" transparent opacity={0.75} />
	</T.LineSegments>
{/if}

<!-- The slot itself, so the destination is a place and not just a line end. -->
{#if slotMarker}
	<T.Mesh position={[slotMarker.x, slotMarker.y, slotMarker.z]}>
		<T.IcosahedronGeometry args={[2.6, 0]} />
		<T.MeshBasicMaterial color="#00ffcc" transparent opacity={0.28} wireframe />
	</T.Mesh>
{/if}

<!-- Active edges (current wave, not yet locked) -->
{#if lineGeometry}
	<T.LineSegments>
		<T is={lineGeometry} />
		<T.LineBasicMaterial color={gameState.solveSequenceActive ? '#ffffff' : '#ffffff'} transparent opacity={gameState.solveSequenceActive ? 0.8 : 0.2} />
	</T.LineSegments>
{/if}

<!-- Connected edges (locked from solved waves) -->
{#if connectedLineGeometry}
	<T.LineSegments>
		<T is={connectedLineGeometry} />
		<T.LineBasicMaterial color={gameState.solveSequenceActive ? '#ffffff' : '#44aaff'} transparent opacity={gameState.solveSequenceActive ? 0.9 : 0.5} />
	</T.LineSegments>
{/if}

<!-- Ghost target wireframe (guides) -->
{#if targetLineGeometry}
	<T.LineSegments>
		<T is={targetLineGeometry} />
		<!-- Was 0.08, which is effectively invisible — the shape the player is
		     assembling should be faintly legible, since it is the goal. -->
		<T.LineBasicMaterial color="#4488ff" transparent opacity={gameState.solveSequenceActive ? 0.4 : 0.16} />
	</T.LineSegments>
{/if}
