<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getPlayerFrame, projectToSphere, SPHERE_RADIUS } from '$lib/game/world';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';

	const PIECE_COUNT = 9;
	const EXPLOSION_SPEED = 8;       // outward velocity
	const SPIN_SPEED = 6;            // radians/sec spin
	const FADE_START = 1.5;          // seconds before fade begins
	const FADE_DURATION = 2.5;       // seconds to fully fade out
	const TOTAL_LIFE = FADE_START + FADE_DURATION;

	interface DebrisPiece {
		mesh: THREE.Mesh | undefined;
		// Local tangent-plane velocity (east, north components)
		velE: number;
		velN: number;
		// Position offset from explosion origin (tangent plane)
		offE: number;
		offN: number;
		// Size and spin
		size: number;
		spinRate: number;
		spinAngle: number;
		// Is this the avatar piece?
		isAvatar: boolean;
	}

	// Shared textures
	const textureLoader = new THREE.TextureLoader();
	const shipTexture = textureLoader.load('/ship-64.png');
	shipTexture.colorSpace = THREE.SRGBColorSpace;

	let avatarTexture: THREE.Texture | undefined;
	function ensureAvatarTexture(): void {
		if (avatarTexture) return;
		const url = authState.avatarUrl;
		if (!url) return;

		const CANVAS_SIZE = 128;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = CANVAS_SIZE;
			canvas.height = CANVAS_SIZE;
			const ctx = canvas.getContext('2d')!;
			ctx.beginPath();
			ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 2, 0, Math.PI * 2);
			ctx.closePath();
			ctx.clip();
			ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
			avatarTexture = new THREE.CanvasTexture(canvas);
			(avatarTexture as THREE.CanvasTexture).colorSpace = THREE.SRGBColorSpace;
			(avatarTexture as THREE.CanvasTexture).needsUpdate = true;
		};
		img.src = url;
	}

	// State
	let active = $state(false);
	let elapsed = 0;
	let explosionOrigin = new THREE.Vector3();
	let explosionQuat = new THREE.Quaternion();
	let explosionRotZ = 0;

	const pieces: DebrisPiece[] = [];

	function spawnDebris(): void {
		pieces.length = 0;

		// Pick which piece index is the avatar
		const avatarIndex = Math.floor(Math.random() * PIECE_COUNT);

		for (let i = 0; i < PIECE_COUNT; i++) {
			// Random direction in tangent plane (radial spread from center)
			const angle = (i / PIECE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
			const speed = EXPLOSION_SPEED * (0.5 + Math.random() * 0.8);

			pieces.push({
				mesh: undefined,
				velE: Math.cos(angle) * speed,
				velN: Math.sin(angle) * speed,
				offE: 0,
				offN: 0,
				size: 0.4 + Math.random() * 1.0, // Random size between 0.4 and 1.4
				spinRate: (Math.random() - 0.5) * SPIN_SPEED * 2,
				spinAngle: Math.random() * Math.PI * 2,
				isAvatar: i === avatarIndex,
			});
		}
	}

	let groupRef: THREE.Group | undefined = $state();

	// Watch for death
	let wasDead = false;

	useTask((delta) => {
		const isDead = gameState.multiplayerDead;

		// Trigger explosion on transition to dead
		if (isDead && !wasDead) {
			explosionOrigin.copy(world.player.position);
			// Capture the orientation at time of death
			const { normal, east, north } = getPlayerFrame(world.player.position);
			const m = new THREE.Matrix4();
			m.makeBasis(east, north, normal);
			explosionQuat.setFromRotationMatrix(m);
			explosionRotZ = world.player.rotation.z;
			elapsed = 0;
			active = true;
			ensureAvatarTexture();
			spawnDebris();
		}
		wasDead = isDead;

		// Reset when no longer dead
		if (!isDead && active) {
			active = false;
			pieces.length = 0;
		}

		if (!active || !groupRef) return;

		elapsed += delta;

		// Fade out after FADE_START
		const fadeT = Math.max(0, elapsed - FADE_START) / FADE_DURATION;
		const alpha = Math.max(0, 1 - fadeT);

		if (alpha <= 0) {
			active = false;
			pieces.length = 0;
			return;
		}

		// Position the group at explosion origin with sphere-tangent orientation
		groupRef.position.copy(explosionOrigin);
		groupRef.quaternion.copy(explosionQuat);

		// Update each debris piece
		for (const piece of pieces) {
			// Move in tangent plane
			piece.offE += piece.velE * delta;
			piece.offN += piece.velN * delta;
			// Slow down over time
			piece.velE *= (1 - delta * 0.8);
			piece.velN *= (1 - delta * 0.8);
			// Spin
			piece.spinAngle += piece.spinRate * delta;

			if (!piece.mesh) continue;

			// Position in local tangent space (east = X, north = Y in group-local)
			piece.mesh.position.set(piece.offE, piece.offN, 0);
			piece.mesh.rotation.z = piece.spinAngle;

			const mat = piece.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = alpha;

			// Assign correct texture
			if (piece.isAvatar && avatarTexture) {
				if (mat.map !== avatarTexture) {
					mat.map = avatarTexture;
					mat.needsUpdate = true;
				}
			} else {
				if (mat.map !== shipTexture) {
					mat.map = shipTexture;
					mat.needsUpdate = true;
				}
			}
		}
	});
</script>

{#if active}
<T.Group bind:ref={groupRef}>
	{#each pieces as piece, i}
		<T.Mesh bind:ref={piece.mesh}>
			<T.PlaneGeometry args={[piece.size, piece.size]} />
			<T.MeshBasicMaterial
				map={shipTexture}
				transparent
				opacity={1}
				side={THREE.DoubleSide}
				depthTest={true}
				depthWrite={false}
			/>
		</T.Mesh>
	{/each}
</T.Group>
{/if}
