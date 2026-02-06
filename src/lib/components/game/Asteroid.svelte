<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let glowPhase = Math.random() * Math.PI * 2;
	let glowIntensity = $state(0.3);

	// Cache index for O(1) lookup instead of .find() every frame
	let cachedIndex = world.asteroids.findIndex((a) => a.id === id);

	const hue = 20 + Math.random() * 30;
	const sat = 20 + Math.random() * 30;
	const lit = 25 + Math.random() * 20;
	const color = `hsl(${hue}, ${sat}%, ${lit}%)`;

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.asteroids.findIndex((a) => a.id === id);
		const data = world.asteroids[cachedIndex];
		if (!group || !data || data.destroyed) return;

		group.position.copy(data.position);
		group.rotation.x = data.rotation.x;
		group.rotation.y = data.rotation.y;

		// Subtle pulsing glow to indicate hittable
		glowPhase += delta * 2;
		glowIntensity = 0.25 + Math.sin(glowPhase) * 0.15;
	});

	const data = world.asteroids[cachedIndex];
	const radius = data?.radius ?? 1;
</script>

<T.Group bind:ref={group}>
	<!-- Main solid mesh -->
	<T.Mesh>
		<T.IcosahedronGeometry args={[radius, 0]} />
		<T.MeshStandardMaterial
			{color}
			roughness={0.9}
			metalness={0.1}
			flatShading
			emissive="#ff4400"
			emissiveIntensity={glowIntensity}
		/>
	</T.Mesh>
	<!-- Wireframe outline to show it's targetable -->
	<T.LineSegments>
		<T.WireframeGeometry args={[new THREE.IcosahedronGeometry(radius * 1.02, 0)]} />
		<T.LineBasicMaterial color="#ff6622" transparent opacity={0.4} />
	</T.LineSegments>
</T.Group>
