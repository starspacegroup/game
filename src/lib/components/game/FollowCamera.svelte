<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, SPHERE_RADIUS } from '$lib/game/world';

	let camera: THREE.PerspectiveCamera | undefined = $state();

	// Camera height above the sphere surface
	const CAMERA_HEIGHT = 25;

	useTask(() => {
		if (!camera) return;

		const normal = world.player.position.clone().normalize();

		// SNAP camera position exactly above player
		camera.position.copy(world.player.position).addScaledVector(normal, CAMERA_HEIGHT);

		// Use playerUp directly — it must match the control frame exactly,
		// otherwise "right" on screen ≠ "right" in physics → uncontrollable.
		camera.up.copy(world.playerUp);

		// Look at the player on the sphere surface
		camera.lookAt(world.player.position);
	});
</script>

<T.PerspectiveCamera
	bind:ref={camera}
	makeDefault
	fov={60}
	near={0.1}
	far={2000}
	position={[0, 0, SPHERE_RADIUS + CAMERA_HEIGHT]}
/>
