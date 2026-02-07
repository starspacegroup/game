<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { getRelativeToPlayer } from '$lib/game/world';

	interface Props {
		x: number;
		y: number;
		z: number;
		points: number;
		onComplete: () => void;
	}

	let { x, y, z, points, onComplete }: Props = $props();

	let group: THREE.Group | undefined = $state();
	let offsetY = $state(0);
	let opacity = $state(1);
	let scale = $state(0.5);
	let lifetime = 0;

	// Store original position for wrapped calculation
	const originalPos = new THREE.Vector3(x, y, z);

	const DURATION = 1.2;
	const RISE_SPEED = 8;

	// Create canvas texture for the text
	function createTextTexture(text: string): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		canvas.width = 128;
		canvas.height = 64;

		ctx.fillStyle = 'transparent';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.font = 'bold 48px Arial';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		// Glow effect
		ctx.shadowColor = '#00ff88';
		ctx.shadowBlur = 8;
		ctx.fillStyle = '#00ff88';
		ctx.fillText(text, canvas.width / 2, canvas.height / 2);

		// Main text
		ctx.shadowBlur = 0;
		ctx.fillStyle = '#ffffff';
		ctx.fillText(text, canvas.width / 2, canvas.height / 2);

		const texture = new THREE.CanvasTexture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	// Create texture once on mount (points won't change for this popup instance)
	const texture = $derived(createTextTexture(`+${points}`));

	useTask((delta) => {
		lifetime += delta;

		if (lifetime >= DURATION) {
			onComplete();
			return;
		}

		// Rise up
		offsetY += RISE_SPEED * delta;

		// Scale pop animation
		if (lifetime < 0.15) {
			scale = 0.5 + (lifetime / 0.15) * 1.5;
		} else {
			scale = 2;
		}

		// Fade out in the last 40% of lifetime
		const fadeStart = DURATION * 0.6;
		if (lifetime > fadeStart) {
			opacity = 1 - (lifetime - fadeStart) / (DURATION - fadeStart);
		}

		if (group) {
			// Use wrapped position relative to player
			const relPos = getRelativeToPlayer(originalPos);
			group.position.set(relPos.x, relPos.y + offsetY, relPos.z);
		}
	});
</script>

<T.Group bind:ref={group}>
	<T.Sprite scale={[scale * 4, scale * 2, 1]}>
		<T.SpriteMaterial map={texture} transparent={true} opacity={opacity} depthTest={false} />
	</T.Sprite>
</T.Group>
