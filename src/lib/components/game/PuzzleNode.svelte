<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getRelativeToPlayer, wrappedDistance } from '$lib/game/world';

	interface Props {
		position: THREE.Vector3;
		targetPosition: THREE.Vector3;
		connected: boolean;
		color: string;
	}

	let { position, connected, color }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let innerMesh: THREE.Mesh | undefined = $state();
	let pulsePhase = 0;
	let scale = $state(1);
	let canInteract = $state(true);

	// Interaction range for puzzle nodes (proximity-based)
	const INTERACTION_RANGE = 50;

	// Color objects for direct manipulation
	const baseColor = new THREE.Color();
	const grayColor = new THREE.Color();
	let colorsInitialized = false;

	useTask((delta) => {
		if (!group) return;
		// Render at wrapped position relative to player for seamless infinite world
		const renderPos = getRelativeToPlayer(position);
		group.position.copy(renderPos);

		// Initialize colors on first run (captures reactive color prop)
		if (!colorsInitialized) {
			baseColor.set(color);
			const gray = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
			grayColor.setRGB(gray, gray, gray);
			colorsInitialized = true;
		}

		// Check if within interaction range using wrapped distance
		const distance = wrappedDistance(world.player.position, position);
		canInteract = distance <= INTERACTION_RANGE;

		if (canInteract) {
			pulsePhase += delta * 3;
			scale = connected ? 1.0 : 0.6 + Math.sin(pulsePhase) * 0.2;
		} else {
			scale = connected ? 1.0 : 0.5;
		}

		// Update material color directly
		if (innerMesh?.material && innerMesh.material instanceof THREE.MeshBasicMaterial) {
			const mat = innerMesh.material;
			mat.color.copy(canInteract ? baseColor : grayColor);
			mat.opacity = connected ? 0.7 : (canInteract ? 0.35 : 0.15);
		}
	});
</script>

<!-- Ethereal appearance - not hittable, interacted by proximity -->
<T.Group bind:ref={group} scale.x={scale} scale.y={scale} scale.z={scale}>
	<T.Mesh bind:ref={innerMesh}>
		<T.SphereGeometry args={[1.2, 8, 8]} />
		<T.MeshBasicMaterial transparent />
	</T.Mesh>
	<!-- Soft outer glow (only when interactable) -->
	{#if canInteract}
		<T.Mesh>
			<T.SphereGeometry args={[1.8, 8, 8]} />
			<T.MeshBasicMaterial
				{color}
				transparent
				opacity={connected ? 0.15 : 0.08}
			/>
		</T.Mesh>
	{/if}
</T.Group>
