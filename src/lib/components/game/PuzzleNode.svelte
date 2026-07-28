<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, surfaceProximity, nodeInteractRange } from '$lib/game/world';
	import { gameState } from '$lib/stores/gameState.svelte';

	interface Props {
		position: THREE.Vector3;
		targetPosition: THREE.Vector3;
		connected: boolean;
		color: string;
		nodeWave: number;
		currentWave: number;
		radius?: number;
	}

	let { position, targetPosition, connected, color, nodeWave, currentWave, radius = 2 }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let innerMesh: THREE.Mesh | undefined = $state();
	let outerMesh: THREE.Mesh | undefined = $state();
	let pulsePhase = 0;
	let scale = $state(1);
	let canInteract = $state(true);

	/** How close the node has travelled to its target, 0..1 — drives the ring. */
	let alignFraction = $state(0);
	/** True only while the player is genuinely close enough to align this node. */
	let nearEnough = $state(false);

	// Color objects
	const baseColor = new THREE.Color();
	const grayColor = new THREE.Color();
	const lockedColor = new THREE.Color();
	const whiteColor = new THREE.Color('#ffffff');
	let colorsInitialized = false;
	let lastColorStr = '';

	useTask((delta) => {
		if (!group) return;

		const isPastWave = nodeWave < currentWave;
		const isCurrentWave = nodeWave === currentWave;

		// Position freely inside the sphere
		group.position.copy(position);

		// Initialize / update colors when the color prop changes
		if (!colorsInitialized || color !== lastColorStr) {
			baseColor.set(color);
			const gray = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
			grayColor.setRGB(gray, gray, gray);
			lockedColor.set(color).lerp(new THREE.Color('#44aaff'), 0.5);
			colorsInitialized = true;
			lastColorStr = color;
		}

		// Check angular proximity against the same range collision.ts gates on,
		// so a node only advertises itself as ready when it actually is.
		const distance = surfaceProximity(world.player.position, position);
		nearEnough = distance <= nodeInteractRange(world.player.radius, radius);
		canInteract = isCurrentWave && !connected && nearEnough;

		// How far this node has travelled toward its slot, for the progress ring.
		if (!connected && targetPosition) {
			const gap = position.distanceTo(targetPosition);
			alignFraction = Math.max(0, Math.min(1, 1 - (gap - 8) / 32));
		} else {
			alignFraction = 1;
		}

		if (isPastWave || connected) {
			// Locked node — steady glow, slightly larger
			scale = 1.1;
			pulsePhase += delta * 0.5;
		} else if (canInteract) {
			// Active node the player can reach — pulse faster
			pulsePhase += delta * 3;
			scale = 0.8 + Math.sin(pulsePhase) * 0.3;
		} else {
			// Current wave, out of range. Still has to be findable from across the
			// sphere: these sit inside the world at ~half its radius, seen through
			// the surface shell, and they are the only thing in the 3D view that
			// says the puzzle exists at all. Was 0.5, which combined with the
			// grayscale below and the shell's absorption to about 3% of a dot.
			scale = 0.85;
			pulsePhase += delta * 1;
		}

		// Solve sequence: override — all nodes pulse white and expand
		const solving = gameState.solveSequenceActive;
		if (solving) {
			pulsePhase += delta * 6;
			scale = 1.3 + Math.sin(pulsePhase) * 0.4;
		}

		// Slow rotation
		group.rotation.x += delta * 0.3;
		group.rotation.y += delta * 0.5;

		// Update inner material
		if (innerMesh?.material && innerMesh.material instanceof THREE.MeshBasicMaterial) {
			const mat = innerMesh.material;
			if (solving) {
				mat.color.copy(whiteColor);
				mat.opacity = 0.9;
			} else if (connected || isPastWave) {
				mat.color.copy(lockedColor);
				mat.opacity = 0.85;
			} else {
				// Keep the node's own colour out of range. Draining it to grey put
				// a dark dot on a near-black background behind a 15%-transmitting
				// shell, which is why the lattice was visible on the minimap and
				// nowhere else. Range is still legible from the ring, the pulse
				// and the brightness step.
				mat.color.copy(baseColor);
				mat.opacity = canInteract ? 0.95 : 0.62;
			}
		}

		// Update outer wireframe material
		if (outerMesh?.material && outerMesh.material instanceof THREE.MeshBasicMaterial) {
			const mat = outerMesh.material;
			if (solving) {
				mat.color.copy(whiteColor);
				mat.opacity = 0.5;
			} else if (connected || isPastWave) {
				mat.color.copy(lockedColor);
				mat.opacity = 0.2;
			} else {
				mat.color.copy(baseColor);
				mat.opacity = canInteract ? 0.35 : 0.2;
			}
		}
	});
</script>

<!-- Interior puzzle node — E8 lattice vertex -->
<T.Group bind:ref={group} scale.x={scale} scale.y={scale} scale.z={scale}>
	<!-- Core node -->
	<T.Mesh bind:ref={innerMesh}>
		<T.IcosahedronGeometry args={[2.0, 1]} />
		<T.MeshBasicMaterial transparent />
	</T.Mesh>
	<!-- Outer energy field -->
	<T.Mesh bind:ref={outerMesh}>
		<T.IcosahedronGeometry args={[3.5, 0]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			wireframe
		/>
	</T.Mesh>
	<!-- Alignment ring — only while this node is genuinely actionable. It closes
	     in on the node as the node closes in on its slot, so "something is
	     happening" is visible on the node itself, not just in the HUD.
	     Scaled rather than re-swept, so the geometry is never rebuilt. -->
	{#if canInteract}
		<T.Mesh
			scale.x={1.7 - alignFraction * 0.7}
			scale.y={1.7 - alignFraction * 0.7}
			scale.z={1.7 - alignFraction * 0.7}
		>
			<T.TorusGeometry args={[4.6, 0.22, 8, 32]} />
			<T.MeshBasicMaterial color="#00ffcc" transparent opacity={0.35 + alignFraction * 0.6} />
		</T.Mesh>
	{/if}

	<!-- Point light, but only for nodes the player is actually next to.
	     Every node used to carry one. That is 20 lights on wave 1 and 240 by
	     wave 6, all of them lighting the MeshStandardMaterial surface shell —
	     far past what a sane forward renderer handles, and the distant ones
	     contributed nothing visible anyway (intensity 0.3, distance 12, seen
	     through the shell). Node visibility now comes from the unlit materials
	     above, which cost nothing per-fragment. -->
	{#if canInteract}
		<T.PointLight color={color} intensity={2} distance={40} />
	{:else if (connected || nodeWave < currentWave) && nearEnough}
		<T.PointLight color="#44aaff" intensity={1.5} distance={25} />
	{/if}
</T.Group>
