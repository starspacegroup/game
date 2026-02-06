<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let mesh: THREE.Mesh | undefined = $state();

	let cachedIndex = world.lasers.findIndex((l) => l.id === id);

	const data = world.lasers[cachedIndex];
	const isPlayer = data?.owner === 'player';
	const color = isPlayer ? '#00ff88' : '#ff4444';

	useTask((_delta) => {
		if (cachedIndex < 0) cachedIndex = world.lasers.findIndex((l) => l.id === id);
		const d = world.lasers[cachedIndex];
		if (!mesh || !d) return;
		mesh.position.copy(d.position);
		mesh.rotation.z = Math.atan2(d.direction.y, d.direction.x);
	});
</script>

<T.Mesh bind:ref={mesh}>
	<T.BoxGeometry args={[1.5, 0.12, 0.12]} />
	<T.MeshBasicMaterial {color} />
</T.Mesh>
