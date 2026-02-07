<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	interface Props {
		count?: number;
	}

	let { count = 2000 }: Props = $props();

	// Generate star positions (count is static — only set at mount time)
	// svelte-ignore state_referenced_locally
	const starCount: number = count;
	const positions = new Float32Array(starCount * 3);
	const colors = new Float32Array(starCount * 3);
	const sizes = new Float32Array(starCount);

	for (let i = 0; i < starCount; i++) {
		const i3 = i * 3;
		// Distribute on a large sphere
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		const r = 400 + Math.random() * 600;
		positions[i3] = r * Math.sin(phi) * Math.cos(theta);
		positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
		positions[i3 + 2] = r * Math.cos(phi);

		// Star colors: mostly white, some blue, some warm
		const temp = Math.random();
		if (temp < 0.7) {
			colors[i3] = 0.9 + Math.random() * 0.1;
			colors[i3 + 1] = 0.9 + Math.random() * 0.1;
			colors[i3 + 2] = 1.0;
		} else if (temp < 0.85) {
			colors[i3] = 0.6;
			colors[i3 + 1] = 0.7;
			colors[i3 + 2] = 1.0;
		} else {
			colors[i3] = 1.0;
			colors[i3 + 1] = 0.8;
			colors[i3 + 2] = 0.6;
		}

		sizes[i] = 0.5 + Math.random() * 2.0;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

	// Reference to the points object for following player
	let pointsRef: THREE.Points | undefined = $state();

	// The starfield follows the player with a parallax effect
	// This creates the illusion that stars are infinitely far away
	const PARALLAX_FACTOR = 0.95; // Stars move 95% as fast as player (appear very distant)

	useTask(() => {
		if (!pointsRef) return;
		// Position starfield centered on player with parallax offset
		// Stars follow the player but lag slightly, creating depth
		pointsRef.position.x = world.player.position.x * PARALLAX_FACTOR;
		pointsRef.position.y = world.player.position.y * PARALLAX_FACTOR;
		pointsRef.position.z = 0;
	});
</script>

<T.Points bind:ref={pointsRef}>
	<T is={geometry} />
	<T.PointsMaterial
		size={1.5}
		vertexColors
		transparent
		opacity={0.9}
		sizeAttenuation
	/>
</T.Points>
