<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getRelativeToPlayer } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	let rootGroup: THREE.Group | undefined = $state();
	let shipMesh: THREE.Mesh | undefined = $state();
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
		
		// Draw text
		ctx.font = 'bold 28px Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 3;
		ctx.strokeText(username, canvas.width / 2, canvas.height / 2);
		ctx.fillText(username, canvas.width / 2, canvas.height / 2);
		
		const texture = new THREE.CanvasTexture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	useTask(() => {
		const player = world.otherPlayers.find((p) => p.id === id);
		if (!player) return;

		// Position at wrapped position relative to local player for seamless infinite world
		if (rootGroup) {
			const renderPos = getRelativeToPlayer(player.position);
			rootGroup.position.copy(renderPos);
		}

		// Rotate only the ship mesh
		if (shipMesh) {
			shipMesh.rotation.z = player.rotation.z;
		}

		// Name sprite stays at fixed offset (no rotation)
		if (nameSprite) {
			nameSprite.position.set(0, 2.5, 1);
			
			if (!nameTextureInitialized) {
				currentUsername = player.username;
				(nameSprite.material as THREE.SpriteMaterial).map = createNameTexture(player.username);
				nameTextureInitialized = true;
			} else if (player.username !== currentUsername) {
				currentUsername = player.username;
				const newTexture = createNameTexture(player.username);
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

	<!-- Engine glow: static behind ship -->
	<T.Mesh position.z={-0.5} scale={[0.4, 0.4, 1]}>
		<T.SphereGeometry args={[0.5, 6, 6]} />
		<T.MeshBasicMaterial color="#ff8844" transparent opacity={0.4} />
	</T.Mesh>

	<!-- Username label: fixed relative position, does NOT rotate -->
	<T.Sprite 
		scale={[4, 1, 1]}
		bind:ref={nameSprite}
	>
		<T.SpriteMaterial transparent depthTest={false} />
	</T.Sprite>
</T.Group>
