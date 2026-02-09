<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';

	interface Props {
		count?: number;
	}

	let { count = 2000 }: Props = $props();

	// Generate star positions on a large sphere centered at origin
	// Stars are fixed in space — as the player orbits the planet, different stars appear
	const starCount: number = count;
	const positions = new Float32Array(starCount * 3);
	const colors = new Float32Array(starCount * 3);

	for (let i = 0; i < starCount; i++) {
		const i3 = i * 3;
		// Stars on a very large sphere (well outside planet radius of 500)
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		const r = 1200 + Math.random() * 800;
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
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
</script>

<!-- Stars fixed at origin — they naturally surround the planet -->
<T.Points>
	<T is={geometry} />
	<T.PointsMaterial
		size={1.5}
		vertexColors
		transparent
		opacity={0.9}
		sizeAttenuation
	/>
</T.Points>
