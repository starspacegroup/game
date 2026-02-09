<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, surfaceProximity } from '$lib/game/world';

	interface Props {
		position: THREE.Vector3;
		targetPosition: THREE.Vector3;
		connected: boolean;
		color: string;
	}

	let { position, connected, color }: Props = $props();
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
	let colorsInitialized = false;

	useTask((delta) => {
		if (!group) return;
		// Position freely inside the sphere — no sphere orientation needed
		group.position.copy(position);

		// Initialize colors
		if (!colorsInitialized) {
			baseColor.set(color);
			const gray = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
			grayColor.setRGB(gray, gray, gray);
			colorsInitialized = true;
		}

		// Check angular proximity — project this node to surface, measure from player
		const distance = surfaceProximity(world.player.position, position);
		canInteract = distance <= INTERACTION_RANGE;

		if (canInteract) {
			pulsePhase += delta * 3;
			scale = connected ? 1.2 : 0.8 + Math.sin(pulsePhase) * 0.3;
		} else {
			scale = connected ? 1.2 : 0.6;
		}

		// Slow rotation for visual interest
		group.rotation.x += delta * 0.3;
		group.rotation.y += delta * 0.5;

		// Update material
		if (innerMesh?.material && innerMesh.material instanceof THREE.MeshBasicMaterial) {
			const mat = innerMesh.material;
			mat.color.copy(canInteract ? baseColor : grayColor);
			mat.opacity = connected ? 0.9 : (canInteract ? 0.5 : 0.25);
		}
		if (outerMesh?.material && outerMesh.material instanceof THREE.MeshBasicMaterial) {
			const mat = outerMesh.material;
			mat.color.copy(canInteract ? baseColor : grayColor);
			mat.opacity = connected ? 0.25 : (canInteract ? 0.12 : 0.04);
		}
	});
</script>

<!-- Interior puzzle node — larger and brighter for visibility inside sphere -->
<T.Group bind:ref={group} scale.x={scale} scale.y={scale} scale.z={scale}>
	<!-- Core node -->
	<T.Mesh bind:ref={innerMesh}>
		<T.IcosahedronGeometry args={[2.5, 1]} />
		<T.MeshBasicMaterial transparent />
	</T.Mesh>
	<!-- Outer energy field -->
	<T.Mesh bind:ref={outerMesh}>
		<T.IcosahedronGeometry args={[4, 0]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			wireframe
		/>
	</T.Mesh>
	<!-- Point light so nodes glow inside the sphere -->
	{#if canInteract}
		<T.PointLight color={color} intensity={2} distance={40} />
	{:else}
		<T.PointLight color={color} intensity={0.5} distance={20} />
	{/if}
</T.Group>
