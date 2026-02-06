<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	let camera: THREE.PerspectiveCamera | undefined = $state();
	const offset = new THREE.Vector3(0, -5, 40);
	const smoothTarget = new THREE.Vector3(0, 0, 0);
	const lookTarget = new THREE.Vector3(0, 0, 0);

	useTask((delta) => {
		if (!camera) return;

		// Smoothly follow player
		smoothTarget.set(
			world.player.position.x,
			world.player.position.y,
			world.player.position.z
		);

		const desired = smoothTarget.clone().add(offset);
		camera.position.lerp(desired, Math.min(1, 4 * delta));

		lookTarget.lerp(smoothTarget, Math.min(1, 6 * delta));
		camera.lookAt(lookTarget);
	});
</script>

<T.PerspectiveCamera
	bind:ref={camera}
	makeDefault
	fov={70}
	near={0.1}
	far={2000}
	position={[0, -5, 40]}
/>
