<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let glowPhase = Math.random() * Math.PI * 2;
	let glowIntensity = $state(0.6);

	let cachedIndex = world.npcs.findIndex((n) => n.id === id);

	const hueShift = Math.random() * 30;
	const bodyColor = `hsl(${hueShift}, 80%, 45%)`;

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.npcs.findIndex((n) => n.id === id);
		const data = world.npcs[cachedIndex];
		if (!group || !data || data.destroyed) return;

		group.position.copy(data.position);
		group.rotation.copy(data.rotation);

		// Pulsing glow to indicate hittable enemy
		glowPhase += delta * 3;
		glowIntensity = 0.6 + Math.sin(glowPhase) * 0.3;
	});
</script>

<T.Group bind:ref={group}>
	<!-- Main body -->
	<T.Mesh rotation.x={Math.PI}>
		<T.ConeGeometry args={[0.5, 1.8, 4]} />
		<T.MeshStandardMaterial
			color={bodyColor}
			emissive="#ff2200"
			emissiveIntensity={glowIntensity}
			metalness={0.6}
			roughness={0.4}
		/>
	</T.Mesh>
	<!-- Wireframe targeting indicator -->
	<T.LineSegments rotation.x={Math.PI}>
		<T.WireframeGeometry args={[new THREE.ConeGeometry(0.6, 2.0, 4)]} />
		<T.LineBasicMaterial color="#ff4422" transparent opacity={0.5} />
	</T.LineSegments>
	<T.Mesh position={[-0.8, -0.2, 0]}>
		<T.BoxGeometry args={[0.8, 0.06, 0.4]} />
		<T.MeshStandardMaterial color="#442200" emissive="#ff3311" emissiveIntensity={0.4} />
	</T.Mesh>
	<T.Mesh position={[0.8, -0.2, 0]}>
		<T.BoxGeometry args={[0.8, 0.06, 0.4]} />
		<T.MeshStandardMaterial color="#442200" emissive="#ff3311" emissiveIntensity={0.4} />
	</T.Mesh>
</T.Group>
