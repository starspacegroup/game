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

	/** Edge pairs for the current wave; recomputed when the wave changes. */
	let connections = $state<[number, number][]>([]);

	/**
	 * Everything here is drawn *inside* the sphere and viewed through the surface
	 * shell, which passes about 28% (SphereSurface's solid shell is opacity 0.72).
	 * So an opacity set by eye against a black background lands at roughly a
	 * quarter of itself in game. These were 0.16 / 0.2 / 0.5 — about 4%, 6% and
	 * 14% once transmitted, which is why the lattice the player is assembling was
	 * not legible even after the nodes themselves became visible.
	 *
	 * The ghost is the *goal*: the finished shape, drawn at every node's target.
	 * It should be the thing you notice first and the reason the puzzle reads as
	 * a puzzle rather than as scattered glowing objects.
	 */
	const GHOST_OPACITY = 0.5;
	const ACTIVE_EDGE_OPACITY = 0.42;
	const LOCKED_EDGE_BASE = 0.72;

	/**
	 * A flat opacity cannot work here: the 4_21 polytope's edge count explodes as
	 * waves reveal it — 55 edges on wave 1, then 326 / 896 / 2088 / 3891 / 6720.
	 * Alpha accumulates wherever lines overlap, so a value that reads as a clean
	 * lattice on wave 1 is a solid mass by wave 6.
	 *
	 * Scale by 1/sqrt(count) against the wave-1 count to hold perceived density
	 * roughly flat, with floors so the structure never disappears entirely. Early
	 * waves get a bright, readable goal shape — which is when the player is still
	 * working out what the puzzle is — and later waves settle into a scaffold.
	 */
	const EDGE_REFERENCE = 55;
	const densityScale = $derived(
		Math.min(1, Math.sqrt(EDGE_REFERENCE / Math.max(1, connections.length)))
	);

	const ghostOpacity = $derived(Math.max(0.1, GHOST_OPACITY * densityScale));
	const activeEdgeOpacity = $derived(Math.max(0.12, ACTIVE_EDGE_OPACITY * densityScale));

	/**
	 * Locked edges brighten as the wave fills in, so completing it looks like the
	 * structure resolving rather than a counter incrementing. Floored higher than
	 * the others — these are the payoff, and the ones worth seeing.
	 */
	const lockedEdgeOpacity = $derived(
		Math.min(1, Math.max(0.3, LOCKED_EDGE_BASE * densityScale) + gameState.puzzleProgress * 0.25)
	);

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
		<T.LineBasicMaterial color="#ffffff" transparent opacity={gameState.solveSequenceActive ? 0.9 : activeEdgeOpacity} />
	</T.LineSegments>
{/if}

<!-- Connected edges (locked from solved waves) -->
{#if connectedLineGeometry}
	<T.LineSegments>
		<T is={connectedLineGeometry} />
		<T.LineBasicMaterial color={gameState.solveSequenceActive ? '#ffffff' : '#44aaff'} transparent opacity={gameState.solveSequenceActive ? 1 : lockedEdgeOpacity} />
	</T.LineSegments>
{/if}

<!-- Ghost target wireframe (guides) -->
{#if targetLineGeometry}
	<T.LineSegments>
		<T is={targetLineGeometry} />
		<!-- The goal shape. Was 0.08, then 0.16 — both effectively invisible once
		     the surface shell takes its ~72%. This is the only thing on screen
		     that says what the player is assembling, so it is drawn to be seen. -->
		<T.LineBasicMaterial color="#4488ff" transparent opacity={gameState.solveSequenceActive ? 0.7 : ghostOpacity} />
	</T.LineSegments>
{/if}
