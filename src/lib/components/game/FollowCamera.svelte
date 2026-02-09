<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getTangentFrame, SPHERE_RADIUS } from '$lib/game/world';

	let camera: THREE.PerspectiveCamera | undefined = $state();

	// Camera height above the sphere surface — higher gives better orbiting feel
	const CAMERA_HEIGHT = 60;

	useTask((delta) => {
		if (!camera) return;

		// Camera sits above the player along the sphere normal
		const normal = world.player.position.clone().normalize();
		const { north } = getTangentFrame(world.player.position);
		const desired = world.player.position.clone().addScaledVector(normal, CAMERA_HEIGHT);

		// Smooth follow
		camera.position.lerp(desired, Math.min(1, 6 * delta));

		// Look at the player on the sphere surface
		camera.up.copy(north);
		camera.lookAt(world.player.position);
	});
</script>

<T.PerspectiveCamera
	bind:ref={camera}
	makeDefault
	fov={65}
	near={0.1}
	far={3000}
	position={[0, 0, SPHERE_RADIUS + CAMERA_HEIGHT]}
/>
