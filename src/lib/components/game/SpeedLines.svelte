<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getPlayerFrame } from '$lib/game/world';
	import { gameState } from '$lib/stores/gameState.svelte';

	// Speed lines configuration
	const LINE_COUNT = 8;
	const LINE_LENGTH_MIN = 1.2;
	const LINE_LENGTH_MAX = 3.0;
	const SPREAD = 1.2;  // how far lines spread laterally
	const OFFSET_BACK = -0.8; // start behind ship center
	const TRAIL_BACK = -2.5;  // how far back lines extend

	// Create line geometries for each speed line
	interface SpeedLine {
		offset: THREE.Vector3; // lateral offset from center
		length: number;
		phase: number; // animation phase offset
		mesh: THREE.Mesh | undefined;
	}

	const lines: SpeedLine[] = [];
	for (let i = 0; i < LINE_COUNT; i++) {
		const t = i / (LINE_COUNT - 1);
		// Distribute lines in a fan pattern behind the ship
		const lateralX = (t - 0.5) * 2 * SPREAD;
		const lateralY = (Math.random() - 0.5) * 0.3; // slight depth variation
		lines.push({
			offset: new THREE.Vector3(lateralX, OFFSET_BACK + (Math.random() - 0.5) * 0.5, lateralY),
			length: LINE_LENGTH_MIN + Math.random() * (LINE_LENGTH_MAX - LINE_LENGTH_MIN),
			phase: Math.random() * Math.PI * 2,
			mesh: undefined,
		});
	}

	let groupRef: THREE.Group | undefined = $state();
	let visible = $state(false);
	let fadeAlpha = $state(0);
	let time = 0;

	useTask((delta) => {
		const hasSpeed = gameState.hasSpeed;
		const speed = world.player.velocity.length();
		const isMoving = speed > 2;

		// Show speed lines only when speed buff is active AND moving
		const shouldShow = hasSpeed && isMoving;

		// Smooth fade in/out
		if (shouldShow) {
			fadeAlpha = Math.min(1, fadeAlpha + delta * 4);
		} else {
			fadeAlpha = Math.max(0, fadeAlpha - delta * 6);
		}
		visible = fadeAlpha > 0.01;

		if (!visible || !groupRef) return;

		// Compute movement direction angle in the tangent plane from velocity
		// Project velocity onto the local east/north frame to get the 2D angle
		const { east, north } = getPlayerFrame(world.player.position);
		const velEast = world.player.velocity.dot(east);
		const velNorth = world.player.velocity.dot(north);
		// atan2 gives angle from east axis; subtract PI/2 to convert to local Y-up coords
		const moveAngle = Math.atan2(velNorth, velEast) - Math.PI / 2;
		groupRef.rotation.z = moveAngle;

		time += delta;

		// Animate each line
		for (const line of lines) {
			if (!line.mesh) continue;
			const mat = line.mesh.material as THREE.MeshBasicMaterial;

			// Pulsing opacity based on phase
			const pulse = 0.4 + 0.6 * Math.abs(Math.sin(time * 6 + line.phase));
			mat.opacity = pulse * fadeAlpha * 0.7;

			// Oscillate line scale for streaming effect
			const scaleY = 0.8 + 0.4 * Math.sin(time * 8 + line.phase * 2);
			line.mesh.scale.y = scaleY;

			// Shift position slightly for dynamic feel
			const drift = Math.sin(time * 3 + line.phase) * 0.08;
			line.mesh.position.x = line.offset.x + drift;
		}
	});
</script>

{#if visible}
<T.Group bind:ref={groupRef}>
	{#each lines as line, i}
		<T.Mesh
			bind:ref={line.mesh}
			position.x={line.offset.x}
			position.y={line.offset.y - line.length / 2}
			position.z={line.offset.z}
		>
			<T.BoxGeometry args={[0.04, line.length, 0.02]} />
			<T.MeshBasicMaterial
				color="#ffdd00"
				transparent
				opacity={0.5}
				depthWrite={false}
				blending={THREE.AdditiveBlending}
			/>
		</T.Mesh>
	{/each}

	<!-- Center bright streak -->
	<T.Mesh position.y={OFFSET_BACK - 1.0} position.z={0}>
		<T.BoxGeometry args={[0.06, 2.5, 0.02]} />
		<T.MeshBasicMaterial
			color="#ffffaa"
			transparent
			opacity={fadeAlpha * 0.4}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>

	<!-- Outer glow streaks (wider, dimmer) -->
	<T.Mesh position.x={-0.6} position.y={OFFSET_BACK - 0.8} position.z={0}>
		<T.BoxGeometry args={[0.08, 1.8, 0.02]} />
		<T.MeshBasicMaterial
			color="#ffdd00"
			transparent
			opacity={fadeAlpha * 0.25}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>
	<T.Mesh position.x={0.6} position.y={OFFSET_BACK - 0.8} position.z={0}>
		<T.BoxGeometry args={[0.08, 1.8, 0.02]} />
		<T.MeshBasicMaterial
			color="#ffdd00"
			transparent
			opacity={fadeAlpha * 0.25}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>
</T.Group>
{/if}
