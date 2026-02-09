<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getRelativeToPlayer } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let pulsePhase = $state(Math.random() * Math.PI * 2);

	// Determine if this is a player laser for coloring (check once at creation)
	const initialData = world.lasers.find((l) => l.id === id);
	const isPlayer = initialData?.owner === 'player';
	// Player shoots cyan "data beam", enemies shoot red
	const coreColor = isPlayer ? '#00ffcc' : '#ff4444';
	const glowColor = isPlayer ? '#00ff88' : '#ff2222';

	useTask((delta) => {
		// Always find by ID to avoid stale index after array modifications
		const d = world.lasers.find((l) => l.id === id);
		if (!group || !d) return;
		// Render at wrapped position relative to player
		const renderPos = getRelativeToPlayer(d.position);
		group.position.copy(renderPos);
		group.rotation.z = Math.atan2(d.direction.y, d.direction.x);
		
		// Pulse animation for data stream effect
		pulsePhase += delta * 20;
	});
</script>

<T.Group bind:ref={group}>
	{#if isPlayer}
		<!-- Player data beam - segmented "data packet" look -->
		<!-- Core beam -->
		<T.Mesh>
			<T.BoxGeometry args={[1.8, 0.15, 0.15]} />
			<T.MeshBasicMaterial color={coreColor} />
		</T.Mesh>
		<!-- Data segments - gives it a digital/code appearance -->
		<T.Mesh position.x={-0.5}>
			<T.BoxGeometry args={[0.3, 0.25, 0.08]} />
			<T.MeshBasicMaterial color={glowColor} transparent opacity={0.8 + Math.sin(pulsePhase) * 0.2} />
		</T.Mesh>
		<T.Mesh position.x={0.1}>
			<T.BoxGeometry args={[0.2, 0.22, 0.08]} />
			<T.MeshBasicMaterial color={glowColor} transparent opacity={0.7 + Math.sin(pulsePhase + 1) * 0.3} />
		</T.Mesh>
		<T.Mesh position.x={0.5}>
			<T.BoxGeometry args={[0.35, 0.28, 0.08]} />
			<T.MeshBasicMaterial color={glowColor} transparent opacity={0.9 + Math.sin(pulsePhase + 2) * 0.1} />
		</T.Mesh>
		<!-- Outer glow -->
		<T.Mesh>
			<T.BoxGeometry args={[2.0, 0.35, 0.05]} />
			<T.MeshBasicMaterial color={glowColor} transparent opacity={0.2} />
		</T.Mesh>
	{:else}
		<!-- Enemy laser - simple red beam -->
		<T.Mesh>
			<T.BoxGeometry args={[1.2, 0.1, 0.1]} />
			<T.MeshBasicMaterial color={coreColor} />
		</T.Mesh>
	{/if}
</T.Group>
