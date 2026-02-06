<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	let group: THREE.Group | undefined = $state();
	let engineGlow = 0.5;
	let engineMat: THREE.MeshBasicMaterial | undefined;

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
	<!-- Ship body -->
	<T.Mesh rotation.x={Math.PI}>
		<T.ConeGeometry args={[0.6, 2.2, 6]} />
		<T.MeshStandardMaterial
			color="#00ff88"
			emissive="#005533"
			emissiveIntensity={0.6}
			metalness={0.7}
			roughness={0.3}
		/>
	</T.Mesh>

	<!-- Cockpit -->
	<T.Mesh position.y={0.3}>
		<T.SphereGeometry args={[0.35, 6, 6]} />
		<T.MeshBasicMaterial color="#88ddff" transparent opacity={0.7} />
	</T.Mesh>

	<!-- Wings -->
	<T.Mesh position={[-1.0, -0.4, 0]} rotation.z={0.2}>
		<T.BoxGeometry args={[1.2, 0.08, 0.5]} />
		<T.MeshStandardMaterial color="#00cc66" emissive="#003311" emissiveIntensity={0.3} />
	</T.Mesh>
	<T.Mesh position={[1.0, -0.4, 0]} rotation.z={-0.2}>
		<T.BoxGeometry args={[1.2, 0.08, 0.5]} />
		<T.MeshStandardMaterial color="#00cc66" emissive="#003311" emissiveIntensity={0.3} />
	</T.Mesh>

	<!-- Engine glow (no PointLight — just emissive mesh) -->
	<T.Mesh position.y={-1.2} scale={[0.4, 1, 0.4]} bind:ref={captureEngineMat}>
		<T.SphereGeometry args={[0.5, 6, 6]} />
		<T.MeshBasicMaterial color="#44ffaa" transparent opacity={0.5} />
	</T.Mesh>
</T.Group>
