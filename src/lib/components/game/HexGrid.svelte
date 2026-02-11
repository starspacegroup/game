<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { SPHERE_RADIUS } from '$lib/game/world';

	// Visual node sphere — a geodesic network of nodes the player orbits
	const NODE_SPHERE_RADIUS = SPHERE_RADIUS - 1;
	const NODE_COUNT = 400;
	const CONNECTIONS_PER_NODE = 3;
	const PHI = (1 + Math.sqrt(5)) / 2;

	// Generate evenly-distributed nodes using jittered Fibonacci spiral
	function generateNodes(): { positions: Float32Array; colors: Float32Array } {
		const positions = new Float32Array(NODE_COUNT * 3);
		const colors = new Float32Array(NODE_COUNT * 3);

		for (let i = 0; i < NODE_COUNT; i++) {
			const i3 = i * 3;
			// Fibonacci sphere with slight jitter for organic feel
			const theta = 2 * Math.PI * i / PHI + (Math.random() - 0.5) * 0.08;
			const phi = Math.acos(1 - 2 * (i + 0.5) / NODE_COUNT) + (Math.random() - 0.5) * 0.03;

			positions[i3] = NODE_SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta);
			positions[i3 + 1] = NODE_SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta);
			positions[i3 + 2] = NODE_SPHERE_RADIUS * Math.cos(phi);

			// Color: mostly blue-cyan, occasional warm accents
			const brightness = 0.4 + Math.random() * 0.6;
			const rand = Math.random();
			if (rand < 0.08) {
				// Warm accent
				colors[i3] = brightness;
				colors[i3 + 1] = brightness * 0.85;
				colors[i3 + 2] = brightness * 0.3;
			} else if (rand < 0.25) {
				// Bright cyan
				colors[i3] = brightness * 0.2;
				colors[i3 + 1] = brightness;
				colors[i3 + 2] = brightness;
			} else {
				// Standard blue
				colors[i3] = brightness * 0.2;
				colors[i3 + 1] = brightness * 0.5;
				colors[i3 + 2] = brightness;
			}
		}

		return { positions, colors };
	}

	// Build connections between k-nearest neighbors
	function generateConnections(positions: Float32Array): Float32Array {
		const lines: number[] = [];
		const connected = new Set<string>();

		for (let i = 0; i < NODE_COUNT; i++) {
			const x1 = positions[i * 3];
			const y1 = positions[i * 3 + 1];
			const z1 = positions[i * 3 + 2];

			const distances: { idx: number; dist: number }[] = [];
			for (let j = 0; j < NODE_COUNT; j++) {
				if (i === j) continue;
				const dx = positions[j * 3] - x1;
				const dy = positions[j * 3 + 1] - y1;
				const dz = positions[j * 3 + 2] - z1;
				distances.push({ idx: j, dist: dx * dx + dy * dy + dz * dz });
			}
			distances.sort((a, b) => a.dist - b.dist);

			for (let k = 0; k < CONNECTIONS_PER_NODE; k++) {
				const j = distances[k].idx;
				const key = i < j ? `${i}-${j}` : `${j}-${i}`;
				if (connected.has(key)) continue;
				connected.add(key);
				lines.push(x1, y1, z1);
				lines.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
			}
		}

		return new Float32Array(lines);
	}

	const { positions: nodePositions, colors: nodeColors } = generateNodes();
	const linePositions = generateConnections(nodePositions);

	// Core node geometry (bright, small)
	const coreGeometry = new THREE.BufferGeometry();
	coreGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
	coreGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3));

	// Glow node geometry (dim, larger halo) — same positions, dimmer colors
	const glowColors = new Float32Array(nodeColors.length);
	for (let i = 0; i < glowColors.length; i++) {
		glowColors[i] = nodeColors[i] * 0.4;
	}
	const glowGeometry = new THREE.BufferGeometry();
	glowGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
	glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));

	// Connection line geometry
	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

	// Slow rotation for a living feel
	let meshGroup: THREE.Group | undefined = $state();

	useTask((delta) => {
		// Static — sphere surface doesn't rotate
	});
</script>

<T.Group bind:ref={meshGroup}>
	<!-- Core nodes: bright, small -->
	<T.Points>
		<T is={coreGeometry} />
		<T.PointsMaterial
			size={2.5}
			vertexColors
			transparent
			opacity={0.9}
			sizeAttenuation
			depthWrite={false}
		/>
	</T.Points>

	<!-- Glow nodes: dim, larger halo -->
	<T.Points>
		<T is={glowGeometry} />
		<T.PointsMaterial
			size={6}
			vertexColors
			transparent
			opacity={0.25}
			sizeAttenuation
			depthWrite={false}
		/>
	</T.Points>

	<!-- Connection lines -->
	<T.LineSegments>
		<T is={lineGeometry} />
		<T.LineBasicMaterial
			color="#1a3366"
			transparent
			opacity={0.12}
		/>
	</T.LineSegments>

	<!-- Subtle inner glow for depth -->
	<T.Mesh>
		<T.SphereGeometry args={[NODE_SPHERE_RADIUS * 0.95, 48, 48]} />
		<T.MeshBasicMaterial
			color="#080818"
			transparent
			opacity={0.1}
			side={THREE.BackSide}
		/>
	</T.Mesh>

	<!-- Subtle atmosphere rim -->
	<T.Mesh>
		<T.SphereGeometry args={[NODE_SPHERE_RADIUS + 2, 48, 48]} />
		<T.MeshBasicMaterial
			color="#2244aa"
			transparent
			opacity={0.02}
			side={THREE.BackSide}
		/>
	</T.Mesh>
</T.Group>
