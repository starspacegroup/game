<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getSphereOrientation } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();

	// Cache index for O(1) lookup instead of .find() every frame
	let cachedIndex = world.asteroids.findIndex((a) => a.id === id);

	// Gray color with slight variation
	const lit = 25 + Math.random() * 20;
	const grayColor = new THREE.Color(`hsl(0, 0%, ${lit}%)`);
	const grayEmissive = new THREE.Color('#222222');

	// Cached objects for per-frame spin (avoid allocations)
	const _spinQuat = new THREE.Quaternion();
	const _spinEuler = new THREE.Euler();

	useTask(() => {
		if (cachedIndex < 0) cachedIndex = world.asteroids.findIndex((a) => a.id === id);
		const data = world.asteroids[cachedIndex];
		if (!group || !data || data.destroyed) return;

		// Position on sphere surface and orient tangent to sphere
		group.position.copy(data.position);
		group.quaternion.copy(getSphereOrientation(data.position));
		// Add spin rotation on top of sphere orientation
		_spinEuler.set(data.rotation.x, data.rotation.y, 0);
		_spinQuat.setFromEuler(_spinEuler);
		group.quaternion.multiply(_spinQuat);
	});

	const data = world.asteroids[cachedIndex];
	const radius = data?.radius ?? 1;
</script>

<T.Group bind:ref={group}>
	<!-- Main solid mesh - non-interactable gray asteroid -->
	<T.Mesh>
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
</T.Group>
