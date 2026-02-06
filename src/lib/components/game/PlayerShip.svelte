<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	let group: THREE.Group | undefined = $state();
	let engineGlow = 0.5;
	let engineMat: THREE.MeshBasicMaterial | undefined;

	// Load the ship texture
	const textureLoader = new THREE.TextureLoader();
	const shipTexture = textureLoader.load('/ship-64.png');
	shipTexture.colorSpace = THREE.SRGBColorSpace;

	useTask((delta) => {
		if (!group) return;

		group.position.copy(world.player.position);
		group.rotation.copy(world.player.rotation);

		// Engine effect
		const speed = world.player.velocity.length();
		const targetGlow = 0.3 + Math.min(speed / 20, 1) * 0.7;
		engineGlow += (targetGlow - engineGlow) * 5 * delta;

		if (engineMat) {
			engineMat.opacity = engineGlow;
		}
	});

	function captureEngineMat(mesh: THREE.Mesh | undefined) {
		if (mesh) engineMat = mesh.material as THREE.MeshBasicMaterial;
	}
</script>

<T.Group bind:ref={group}>
	<!-- Ship plane using logo image -->
	<T.Mesh>
		<T.PlaneGeometry args={[2.5, 2.5]} />
		<T.MeshBasicMaterial 
			map={shipTexture} 
			transparent={true}
			side={THREE.DoubleSide}
			depthTest={true}
			depthWrite={false}
		/>
	</T.Mesh>

	<!-- Engine glow behind ship -->
	<T.Mesh position.z={-0.5} scale={[0.4, 0.4, 1]} bind:ref={captureEngineMat}>
		<T.SphereGeometry args={[0.5, 6, 6]} />
		<T.MeshBasicMaterial color="#44ffaa" transparent opacity={0.5} />
	</T.Mesh>
</T.Group>
