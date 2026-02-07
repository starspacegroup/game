<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world } from '$lib/game/world';

	// Infinite tiling hex grid that follows the player
	// Creates seamless visual floor across the infinite world
	
	// Grid tile size (world units per tile)
	const TILE_SIZE = 80;
	const HEX_RADIUS = 1.4;
	const HEX_SPACING = 3.6; // Space between hex centers

	// Create a single hex tile geometry (reused for instancing)
	const cylGeom = new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, 0.1, 6);
	cylGeom.rotateX(-Math.PI / 2);

	// Create merged geometry for one grid tile
	function createTileGeometry(): THREE.BufferGeometry {
		const geometries: THREE.BufferGeometry[] = [];
		const matrix = new THREE.Matrix4();
		
		// Number of hexes per tile side
		const hexesPerSide = Math.ceil(TILE_SIZE / HEX_SPACING);
		const halfTile = TILE_SIZE / 2;
		
		for (let row = -hexesPerSide; row <= hexesPerSide; row++) {
			for (let col = -hexesPerSide; col <= hexesPerSide; col++) {
				const x = col * HEX_SPACING + (row % 2) * (HEX_SPACING / 2);
				const y = row * HEX_SPACING * 0.866; // sqrt(3)/2 for hex packing
				
				// Only include hexes within tile bounds
				if (Math.abs(x) <= halfTile && Math.abs(y) <= halfTile) {
					const g = cylGeom.clone();
					matrix.identity();
					matrix.setPosition(x, y, 0);
					g.applyMatrix4(matrix);
					geometries.push(g);
				}
			}
		}
		
		// Merge all hexes into single geometry
		return mergeGeometries(geometries);
	}

	function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
		// Simple merge implementation
		let totalVerts = 0;
		for (const g of geoms) {
			totalVerts += g.attributes.position.count;
		}
		const pos = new Float32Array(totalVerts * 3);
		const norm = new Float32Array(totalVerts * 3);
		let offset = 0;
		for (const g of geoms) {
			const p = g.attributes.position;
			const n = g.attributes.normal;
			for (let i = 0; i < p.count; i++) {
				pos[(offset + i) * 3] = p.getX(i);
				pos[(offset + i) * 3 + 1] = p.getY(i);
				pos[(offset + i) * 3 + 2] = p.getZ(i);
				if (n) {
					norm[(offset + i) * 3] = n.getX(i);
					norm[(offset + i) * 3 + 1] = n.getY(i);
					norm[(offset + i) * 3 + 2] = n.getZ(i);
				}
			}
			offset += p.count;
		}
		const bg = new THREE.BufferGeometry();
		bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		bg.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
		return bg;
	}

	const tileGeometry = createTileGeometry();

	// Track tile mesh references for positioning
	let centerTile: THREE.Mesh | undefined = $state();
	let surroundingTiles: (THREE.Mesh | undefined)[] = $state(Array(8).fill(undefined));

	// Tile offset grid: center + 8 surrounding tiles for seamless tiling
	const tileOffsets = [
		{ x: 0, y: 0 },           // Center
		{ x: -1, y: 0 },          // Left
		{ x: 1, y: 0 },           // Right
		{ x: 0, y: -1 },          // Bottom
		{ x: 0, y: 1 },           // Top
		{ x: -1, y: -1 },         // Bottom-left
		{ x: 1, y: -1 },          // Bottom-right
		{ x: -1, y: 1 },          // Top-left
		{ x: 1, y: 1 },           // Top-right
	];

	const GRID_Z = -5; // Z position below play area

	useTask(() => {
		// Calculate which tile the player is on
		const playerTileX = Math.floor(world.player.position.x / TILE_SIZE);
		const playerTileY = Math.floor(world.player.position.y / TILE_SIZE);
		
		// Position center tile
		if (centerTile) {
			centerTile.position.x = playerTileX * TILE_SIZE + TILE_SIZE / 2;
			centerTile.position.y = playerTileY * TILE_SIZE + TILE_SIZE / 2;
			centerTile.position.z = GRID_Z;
		}
		
		// Position surrounding tiles
		for (let i = 0; i < 8; i++) {
			const tile = surroundingTiles[i];
			if (tile) {
				const offset = tileOffsets[i + 1]; // +1 because center is at index 0
				tile.position.x = (playerTileX + offset.x) * TILE_SIZE + TILE_SIZE / 2;
				tile.position.y = (playerTileY + offset.y) * TILE_SIZE + TILE_SIZE / 2;
				tile.position.z = GRID_Z;
			}
		}
	});
</script>

<!-- Center tile -->
<T.Mesh bind:ref={centerTile}>
	<T is={tileGeometry} />
	<T.MeshBasicMaterial
		color="#112233"
		transparent
		opacity={0.2}
	/>
</T.Mesh>

<!-- 8 surrounding tiles for seamless infinite coverage -->
{#each Array(8) as _, i}
	<T.Mesh bind:ref={surroundingTiles[i]}>
		<T is={tileGeometry} />
		<T.MeshBasicMaterial
			color="#112233"
			transparent
			opacity={0.2}
		/>
	</T.Mesh>
{/each}
