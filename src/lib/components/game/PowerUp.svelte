<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getSphereOrientation } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();

	let cachedIndex = world.powerUps.findIndex((p) => p.id === id);

	const typeColors: Record<string, string> = {
		health: '#44ff44',
		speed: '#ffff00',
		multishot: '#ff44ff',
		shield: '#4488ff'
	};

	const data = world.powerUps[cachedIndex];
	const color = typeColors[data?.type ?? 'health'];

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.powerUps.findIndex((p) => p.id === id);
		const d = world.powerUps[cachedIndex];
		if (!group || !d || d.collected) return;

		// Position on sphere surface
		group.position.copy(d.position);
		group.quaternion.copy(getSphereOrientation(d.position));
		// Bob effect: offset along sphere normal
		const normal = d.position.clone().normalize();
		group.position.addScaledVector(normal, Math.sin(d.bobPhase) * 0.5);
		group.rotateZ(delta * 2);
	});
</script>

<T.Group bind:ref={group}>
	<!-- Ethereal inner glow (not hittable, just collectible) -->
	<T.Mesh>
		<T.OctahedronGeometry args={[0.6, 0]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			opacity={0.5}
		/>
	</T.Mesh>
	<!-- Outer ethereal halo -->
	<T.Mesh>
		<T.SphereGeometry args={[0.9, 8, 8]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			opacity={0.15}
		/>
	</T.Mesh>
</T.Group>
