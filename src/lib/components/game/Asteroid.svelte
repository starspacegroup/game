<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let mainMesh: THREE.Mesh | undefined = $state();
	let glowPhase = Math.random() * Math.PI * 2;
	let canInteract = $state(false); // Start false, update in task

	// Cache index for O(1) lookup instead of .find() every frame
	let cachedIndex = world.asteroids.findIndex((a) => a.id === id);

	// Laser max range: speed 60 * life 2 = 120 units
	const INTERACTION_RANGE = 120;

	// Colors based on interaction state
	const hue = 20 + Math.random() * 30;
	const lit = 25 + Math.random() * 20;
	const baseColor = new THREE.Color(`hsl(${hue}, 25%, ${lit}%)`);
	const grayColor = new THREE.Color(`hsl(0, 0%, ${lit}%)`);
	const emissiveColor = new THREE.Color('#ff4400');
	const grayEmissive = new THREE.Color('#222222');

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.asteroids.findIndex((a) => a.id === id);
		const data = world.asteroids[cachedIndex];
		if (!group || !data || data.destroyed) return;

		group.position.copy(data.position);
		group.rotation.x = data.rotation.x;
		group.rotation.y = data.rotation.y;

		// Check if within interaction range
		const distance = world.player.position.distanceTo(data.position);
		const wasInteractable = canInteract;
		canInteract = distance <= INTERACTION_RANGE;

		// Update material colors based on distance
		if (mainMesh?.material && mainMesh.material instanceof THREE.MeshStandardMaterial) {
			const mat = mainMesh.material;
			if (canInteract) {
				glowPhase += delta * 2;
				mat.color.copy(baseColor);
				mat.emissive.copy(emissiveColor);
				mat.emissiveIntensity = 0.25 + Math.sin(glowPhase) * 0.15;
			} else {
				mat.color.copy(grayColor);
				mat.emissive.copy(grayEmissive);
				mat.emissiveIntensity = 0.05;
			}
			mat.needsUpdate = true;
		}
	});

	const data = world.asteroids[cachedIndex];
	const radius = data?.radius ?? 1;
</script>

<T.Group bind:ref={group}>
	<!-- Main solid mesh -->
	<T.Mesh bind:ref={mainMesh}>
		<T.IcosahedronGeometry args={[radius, 0]} />
		<T.MeshStandardMaterial
			color={grayColor}
			emissive={grayEmissive}
			emissiveIntensity={0.05}
			roughness={0.9}
			metalness={0.1}
			flatShading
		/>
	</T.Mesh>
	<!-- Wireframe outline to show it's targetable (only when interactable) -->
	{#if canInteract}
		<T.LineSegments>
			<T.WireframeGeometry args={[new THREE.IcosahedronGeometry(radius * 1.02, 0)]} />
			<T.LineBasicMaterial color="#ff6622" transparent opacity={0.4} />
		</T.LineSegments>
	{/if}
</T.Group>
