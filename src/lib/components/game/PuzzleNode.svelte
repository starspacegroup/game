<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, surfaceProximity } from '$lib/game/world';
	import { gameState } from '$lib/stores/gameState.svelte';

	interface Props {
		position: THREE.Vector3;
		targetPosition: THREE.Vector3;
		connected: boolean;
		color: string;
		nodeWave: number;
		currentWave: number;
	}

	let { position, connected, color, nodeWave, currentWave }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let innerMesh: THREE.Mesh | undefined = $state();
	let outerMesh: THREE.Mesh | undefined = $state();
	let pulsePhase = 0;
	let scale = $state(1);
	let canInteract = $state(true);

	// Interaction range — angular proximity from player on surface to node inside
	const INTERACTION_RANGE = 60;

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

		// Check angular proximity
		const distance = surfaceProximity(world.player.position, position);
		canInteract = isCurrentWave && !connected && distance <= INTERACTION_RANGE;

		if (isPastWave || connected) {
			// Locked node — steady glow, slightly larger
			scale = 1.1;
			pulsePhase += delta * 0.5;
		} else if (canInteract) {
			// Active node the player can reach — pulse faster
			pulsePhase += delta * 3;
			scale = 0.8 + Math.sin(pulsePhase) * 0.3;
		} else {
			// Current wave but out of range — dim and small
			scale = 0.5;
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
				mat.color.copy(canInteract ? baseColor : grayColor);
				mat.opacity = canInteract ? 0.5 : 0.2;
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
				mat.color.copy(canInteract ? baseColor : grayColor);
				mat.opacity = canInteract ? 0.12 : 0.03;
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
	<!-- Point light — brighter for connected / interactive nodes -->
	{#if connected || nodeWave < currentWave}
		<T.PointLight color="#44aaff" intensity={1.5} distance={25} />
	{:else if canInteract}
		<T.PointLight color={color} intensity={2} distance={40} />
	{:else}
		<T.PointLight color={color} intensity={0.3} distance={12} />
	{/if}
</T.Group>
