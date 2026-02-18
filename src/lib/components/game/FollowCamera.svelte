<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, SPHERE_RADIUS } from '$lib/game/world';
	import { deathReplay } from '$lib/stores/deathReplay.svelte';

	let camera: THREE.PerspectiveCamera | undefined = $state();

	// Camera height above the sphere surface
	const CAMERA_HEIGHT = 25;

	// Captured death position/up for stable camera during death
	let deathPos: THREE.Vector3 | null = null;
	let deathUp: THREE.Vector3 | null = null;
	let wasDead = false;

	const _tempPos = new THREE.Vector3();
	const _tempUp = new THREE.Vector3();

	useTask(() => {
		if (!camera) return;

		// During death replay, lock camera on the death position (no swooping)
		if (deathReplay.active) {
			// Capture death position on first frame of death
			if (!wasDead) {
				deathPos = world.player.position.clone();
				deathUp = world.playerUp.clone();
				wasDead = true;
			}

			if (deathPos && deathUp) {
				_tempPos.copy(deathPos).normalize();
				camera.position.copy(deathPos).addScaledVector(_tempPos, CAMERA_HEIGHT);
				camera.up.copy(deathUp);
				camera.lookAt(deathPos);
			}
			return;
		}

		// Reset death state when no longer in replay
		if (wasDead) {
			wasDead = false;
			deathPos = null;
			deathUp = null;
		}

		_tempPos.copy(world.player.position).normalize();

		// SNAP camera position exactly above player
		camera.position.copy(world.player.position).addScaledVector(_tempPos, CAMERA_HEIGHT);

		// Use playerUp directly
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
