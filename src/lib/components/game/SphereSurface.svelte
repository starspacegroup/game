<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { SPHERE_RADIUS } from '$lib/game/world';

	/**
	 * SphereSurface — renders a visible planetary surface that players fly over.
	 * Uses a layered approach:
	 * 1. A wireframe geodesic grid showing the sphere curvature
	 * 2. A subtle solid surface with transparency
	 * 3. An atmosphere glow around the edges
	 * 4. Latitude/longitude grid lines for navigation reference
	 */

	const SURFACE_RADIUS = SPHERE_RADIUS - 0.5;
	const GRID_SEGMENTS = 64;

	// === Lat/Lon grid lines ===
	function generateLatLonGrid(): Float32Array {
		const lines: number[] = [];
		const R = SURFACE_RADIUS + 0.2;

		// Latitude lines every 15 degrees
		for (let latDeg = -75; latDeg <= 75; latDeg += 15) {
			const lat = (latDeg * Math.PI) / 180;
			const cosLat = Math.cos(lat);
			const sinLat = Math.sin(lat);
			const segments = 72;
			for (let i = 0; i < segments; i++) {
				const lon1 = (i / segments) * Math.PI * 2;
				const lon2 = ((i + 1) / segments) * Math.PI * 2;
				lines.push(
					R * cosLat * Math.sin(lon1), R * sinLat, R * cosLat * Math.cos(lon1),
					R * cosLat * Math.sin(lon2), R * sinLat, R * cosLat * Math.cos(lon2)
				);
			}
		}

		// Longitude lines every 15 degrees
		for (let lonDeg = 0; lonDeg < 360; lonDeg += 15) {
			const lon = (lonDeg * Math.PI) / 180;
			const cosLon = Math.cos(lon);
			const sinLon = Math.sin(lon);
			const segments = 72;
			for (let i = 0; i < segments; i++) {
				const lat1 = ((i / segments) * Math.PI) - Math.PI / 2;
				const lat2 = (((i + 1) / segments) * Math.PI) - Math.PI / 2;
				lines.push(
					R * Math.cos(lat1) * sinLon, R * Math.sin(lat1), R * Math.cos(lat1) * cosLon,
					R * Math.cos(lat2) * sinLon, R * Math.sin(lat2), R * Math.cos(lat2) * cosLon
				);
			}
		}

		return new Float32Array(lines);
	}

	// === Fine hex-like surface pattern near the player ===
	function generateSurfaceDetail(): { positions: Float32Array; colors: Float32Array } {
		// Scatter small dots on surface for texture
		const count = 3000;
		const positions = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		const R = SURFACE_RADIUS + 0.1;

		for (let i = 0; i < count; i++) {
			const u = Math.random() * 2 - 1;
			const theta = Math.random() * Math.PI * 2;
			const r = Math.sqrt(1 - u * u);
			const i3 = i * 3;
			positions[i3] = r * Math.cos(theta) * R;
			positions[i3 + 1] = u * R;
			positions[i3 + 2] = r * Math.sin(theta) * R;

			// Soft blue-green tones
			const bright = 0.15 + Math.random() * 0.15;
			colors[i3] = bright * 0.3;
			colors[i3 + 1] = bright * 0.7;
			colors[i3 + 2] = bright;
		}
		return { positions, colors };
	}

	const latLonLines = generateLatLonGrid();
	const { positions: detailPositions, colors: detailColors } = generateSurfaceDetail();

	const latLonGeom = new THREE.BufferGeometry();
	latLonGeom.setAttribute('position', new THREE.BufferAttribute(latLonLines, 3));

	const detailGeom = new THREE.BufferGeometry();
	detailGeom.setAttribute('position', new THREE.BufferAttribute(detailPositions, 3));
	detailGeom.setAttribute('color', new THREE.BufferAttribute(detailColors, 3));

	let surfaceGroup: THREE.Group | undefined = $state();
</script>

<T.Group bind:ref={surfaceGroup}>
	<!-- Solid surface shell — very subtle, shows curvature -->
	<T.Mesh>
		<T.SphereGeometry args={[SURFACE_RADIUS - 1, GRID_SEGMENTS, GRID_SEGMENTS]} />
		<T.MeshStandardMaterial
			color="#0a1628"
			emissive="#050d1a"
			emissiveIntensity={0.3}
			transparent
			opacity={0.85}
			side={THREE.FrontSide}
			roughness={0.9}
			metalness={0.1}
		/>
	</T.Mesh>

	<!-- Wireframe geodesic — low-poly surface grid shows curvature clearly -->
	<T.LineSegments>
		<T.WireframeGeometry args={[new THREE.IcosahedronGeometry(SURFACE_RADIUS, 5)]} />
		<T.LineBasicMaterial color="#1a3355" transparent opacity={0.08} />
	</T.LineSegments>

	<!-- Lat/Lon navigation grid -->
	<T.LineSegments>
		<T is={latLonGeom} />
		<T.LineBasicMaterial color="#1a4488" transparent opacity={0.12} />
	</T.LineSegments>

	<!-- Surface detail particles -->
	<T.Points>
		<T is={detailGeom} />
		<T.PointsMaterial
			size={1.2}
			vertexColors
			transparent
			opacity={0.6}
			sizeAttenuation
			depthWrite={false}
		/>
	</T.Points>

	<!-- Atmosphere shell — visible from above, glows at horizon edges -->
	<T.Mesh>
		<T.SphereGeometry args={[SPHERE_RADIUS + 8, 48, 48]} />
		<T.MeshBasicMaterial
			color="#2244aa"
			transparent
			opacity={0.04}
			side={THREE.BackSide}
			depthWrite={false}
		/>
	</T.Mesh>

	<!-- Outer atmosphere halo -->
	<T.Mesh>
		<T.SphereGeometry args={[SPHERE_RADIUS + 25, 32, 32]} />
		<T.MeshBasicMaterial
			color="#1133cc"
			transparent
			opacity={0.015}
			side={THREE.BackSide}
			depthWrite={false}
		/>
	</T.Mesh>
</T.Group>
