<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { generateHexGrid } from '$lib/game/puzzle';

	// Kadis-Kot hex grid — smaller radius for fewer draw calls
	const center = new THREE.Vector3(0, 0, -5);
	const hexPositions = generateHexGrid(2, center);

	// Merge all hex tiles into a single geometry for 1 draw call
	const mergedGeometry = new THREE.BufferGeometry();
	const cylGeom = new THREE.CylinderGeometry(1.4, 1.4, 0.1, 6);
	const matrix = new THREE.Matrix4();
	const geometries: THREE.BufferGeometry[] = [];

	for (const pos of hexPositions) {
		const g = cylGeom.clone();
		matrix.makeRotationX(-Math.PI / 2);
		matrix.setPosition(pos.x, pos.y, pos.z);
		g.applyMatrix4(matrix);
		geometries.push(g);
	}

	const merged = THREE.BufferGeometryUtils
		? THREE.BufferGeometryUtils.mergeGeometries(geometries)
		: mergeSimple(geometries);

	function mergeSimple(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
		// Simple merge fallback
		let totalVerts = 0;
		let totalIdx = 0;
		for (const g of geoms) {
			totalVerts += g.attributes.position.count;
			totalIdx += g.index ? g.index.count : 0;
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

	const finalGeom = merged ?? mergedGeometry;
</script>

<T.Mesh>
	<T is={finalGeom} />
	<T.MeshBasicMaterial
		color="#112233"
		transparent
		opacity={0.25}
	/>
</T.Mesh>
