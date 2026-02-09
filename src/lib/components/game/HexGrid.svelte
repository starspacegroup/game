<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { SPHERE_RADIUS } from '$lib/game/world';

	// Planet sphere — the world surface that players orbit
	// Slightly smaller than SPHERE_RADIUS so entities sit visually ON the surface
	const planetRadius = SPHERE_RADIUS - 0.5;

	// Slow spin — the massive planet rotates beneath the player
	let planetMesh: THREE.Mesh | undefined = $state();
	let atmosphereMesh: THREE.Mesh | undefined = $state();
	let innerGlowMesh: THREE.Mesh | undefined = $state();

	useTask((delta) => {
		// Slowly rotate the planet shell for that "spinning beneath you" feel
		const spinSpeed = 0.008; // very slow majestic rotation
		if (planetMesh) {
			planetMesh.rotation.y += spinSpeed * delta;
		}
		if (atmosphereMesh) {
			atmosphereMesh.rotation.y += spinSpeed * 0.7 * delta; // slightly different rate for depth
		}
		if (innerGlowMesh) {
			innerGlowMesh.rotation.y -= spinSpeed * 0.3 * delta; // counter-rotate for effect
		}
	});

	// Create a subtle grid texture for the planet surface
	function createPlanetTexture(): THREE.CanvasTexture {
		const size = 2048;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;

		// Dark base
		ctx.fillStyle = '#050510';
		ctx.fillRect(0, 0, size, size);

		// Large hex-style grid lines for a massive planet feel
		ctx.strokeStyle = 'rgba(30, 50, 90, 0.2)';
		ctx.lineWidth = 1;
		const gridSize = 32;
		for (let x = 0; x <= size; x += gridSize) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, size);
			ctx.stroke();
		}
		for (let y = 0; y <= size; y += gridSize) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(size, y);
			ctx.stroke();
		}

		// Larger tectonic-plate-like divisions
		ctx.strokeStyle = 'rgba(40, 70, 130, 0.15)';
		ctx.lineWidth = 2;
		const bigGrid = 128;
		for (let x = 0; x <= size; x += bigGrid) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, size);
			ctx.stroke();
		}
		for (let y = 0; y <= size; y += bigGrid) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(size, y);
			ctx.stroke();
		}

		// Surface variation — continental patches
		for (let i = 0; i < 400; i++) {
			const px = Math.random() * size;
			const py = Math.random() * size;
			const pr = 3 + Math.random() * 15;
			ctx.fillStyle = `rgba(${15 + Math.random() * 25}, ${25 + Math.random() * 35}, ${45 + Math.random() * 55}, 0.08)`;
			ctx.beginPath();
			ctx.arc(px, py, pr, 0, Math.PI * 2);
			ctx.fill();
		}

		const tex = new THREE.CanvasTexture(canvas);
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(12, 6);
		return tex;
	}

	const planetTexture = createPlanetTexture();
</script>

<!-- Planet sphere — semi-transparent shell so puzzle inside is visible -->
<T.Mesh bind:ref={planetMesh}>
	<T.SphereGeometry args={[planetRadius, 96, 96]} />
	<T.MeshStandardMaterial
		map={planetTexture}
		color="#0a0a1a"
		emissive="#040410"
		emissiveIntensity={0.5}
		roughness={0.9}
		metalness={0.1}
		transparent
		opacity={0.7}
		side={THREE.DoubleSide}
		depthWrite={false}
	/>
</T.Mesh>

<!-- Inner glow layer — makes puzzle geometry inside more mysterious -->
<T.Mesh bind:ref={innerGlowMesh}>
	<T.SphereGeometry args={[planetRadius * 0.95, 48, 48]} />
	<T.MeshBasicMaterial
		color="#0a1535"
		transparent
		opacity={0.15}
		side={THREE.BackSide}
	/>
</T.Mesh>

<!-- Atmosphere glow ring (outer rim lighting) -->
<T.Mesh bind:ref={atmosphereMesh}>
	<T.SphereGeometry args={[planetRadius + 3, 64, 64]} />
	<T.MeshBasicMaterial
		color="#2244aa"
		transparent
		opacity={0.03}
		side={THREE.BackSide}
	/>
</T.Mesh>

<!-- Thin bright edge highlight for sense of scale -->
<T.Mesh>
	<T.SphereGeometry args={[planetRadius + 0.5, 64, 64]} />
	<T.MeshBasicMaterial
		color="#3366cc"
		transparent
		opacity={0.02}
		side={THREE.BackSide}
	/>
</T.Mesh>
