<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';

	interface Props {
		position: THREE.Vector3;
		targetPosition: THREE.Vector3;
		connected: boolean;
		color: string;
	}

	let { position, connected, color }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let pulsePhase = 0;
	let scale = $state(1);

	useTask((delta) => {
		if (!group) return;
		group.position.copy(position);
		pulsePhase += delta * 3;
		scale = connected ? 1.0 : 0.6 + Math.sin(pulsePhase) * 0.2;
	});
</script>

<!-- Ethereal appearance - not hittable, interacted by proximity -->
<T.Group bind:ref={group} scale.x={scale} scale.y={scale} scale.z={scale}>
	<T.Mesh>
		<T.SphereGeometry args={[1.2, 8, 8]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			opacity={connected ? 0.7 : 0.35}
		/>
	</T.Mesh>
	<!-- Soft outer glow -->
	<T.Mesh>
		<T.SphereGeometry args={[1.8, 8, 8]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			opacity={connected ? 0.15 : 0.08}
		/>
	</T.Mesh>
</T.Group>
