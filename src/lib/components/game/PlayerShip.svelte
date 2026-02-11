<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getPlayerOrientation } from '$lib/game/world';
	import { authState } from '$lib/stores/authState.svelte';

	let rootGroup: THREE.Group | undefined = $state();
	let shipMesh: THREE.Mesh | undefined = $state();
	let engineGlow = 0.5;
	let engineMesh: THREE.Mesh | undefined = $state();
	let nameSprite: THREE.Sprite | undefined = $state();
	let currentUsername = $state('');
	let nameTextureInitialized = false;

	// Load the ship texture
	const textureLoader = new THREE.TextureLoader();
	const shipTexture = textureLoader.load('/ship-64.png');
	shipTexture.colorSpace = THREE.SRGBColorSpace;

	// Create a canvas texture for username
	function createNameTexture(username: string): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		
		canvas.width = 256;
		canvas.height = 64;
		
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		
		// Draw background with transparency
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.roundRect(0, 8, canvas.width, 48, 8);
		ctx.fill();
		
		// Draw text - cyan color for local player
		ctx.font = 'bold 28px Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#00ffff';
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 3;
		ctx.strokeText(username, canvas.width / 2, canvas.height / 2);
		ctx.fillText(username, canvas.width / 2, canvas.height / 2);
		
		const texture = new THREE.CanvasTexture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	useTask((delta) => {
		if (!rootGroup) return;

		// Position on sphere surface and orient tangent to sphere
		rootGroup.position.copy(world.player.position);
		rootGroup.quaternion.copy(getPlayerOrientation());

		// Blink during invincibility
		const isInvincible = Date.now() < world.player.damageCooldownUntil;
		if (isInvincible) {
			// Blink at ~8Hz
			rootGroup.visible = Math.floor(Date.now() / 125) % 2 === 0;
		} else {
			rootGroup.visible = true;
		}

		// Rotate only the ship mesh within the tangent plane
		if (shipMesh) {
			shipMesh.rotation.z = world.player.rotation.z;
		}

		// Engine effect
		const speed = world.player.velocity.length();
		const targetGlow = 0.3 + Math.min(speed / 20, 1) * 0.7;
		engineGlow += (targetGlow - engineGlow) * 5 * delta;

		if (engineMesh) {
			(engineMesh.material as THREE.MeshBasicMaterial).opacity = engineGlow;
		}

		// Initialize or update username texture
		const username = authState.username || 'Player';
		if (nameSprite) {
			if (!nameTextureInitialized) {
				currentUsername = username;
				(nameSprite.material as THREE.SpriteMaterial).map = createNameTexture(username);
				nameTextureInitialized = true;
			} else if (username !== currentUsername) {
				currentUsername = username;
				const newTexture = createNameTexture(username);
				(nameSprite.material as THREE.SpriteMaterial).map = newTexture;
				(nameSprite.material as THREE.SpriteMaterial).needsUpdate = true;
			}
		}
	});
</script>

<!-- Root group: positioned at player, NO rotation -->
<T.Group bind:ref={rootGroup}>
	<!-- Ship plane: rotates with player direction -->
	<T.Mesh bind:ref={shipMesh}>
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
	<T.Mesh position.z={-0.5} scale={[0.4, 0.4, 1]} bind:ref={engineMesh}>
		<T.SphereGeometry args={[0.5, 6, 6]} />
		<T.MeshBasicMaterial color="#44ffaa" transparent opacity={0.5} />
	</T.Mesh>

	<!-- Username label: ALWAYS above ship, does NOT rotate -->
	<T.Sprite 
		position.y={2.5} 
		position.z={0.5}
		scale={[4, 1, 1]}
		bind:ref={nameSprite}
	>
		<T.SpriteMaterial transparent depthTest={false} />
	</T.Sprite>
</T.Group>
