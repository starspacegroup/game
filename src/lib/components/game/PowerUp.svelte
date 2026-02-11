<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getSphereOrientation } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let iconSprite: THREE.Sprite | undefined = $state();

	let cachedIndex = world.powerUps.findIndex((p) => p.id === id);

	const typeConfig: Record<string, { color: string; glow: string; icon: string; label: string }> = {
		health:   { color: '#44ff44', glow: '#22cc22', icon: '✚',  label: 'REPAIR' },
		speed:    { color: '#ffdd00', glow: '#ccaa00', icon: '⚡', label: 'SPEED' },
		multishot:{ color: '#ff44ff', glow: '#cc22cc', icon: '✦',  label: 'MULTI' },
		shield:   { color: '#4488ff', glow: '#2266dd', icon: '🛡', label: 'SHIELD' }
	};

	const data = world.powerUps[cachedIndex];
	const config = typeConfig[data?.type ?? 'health'];

	// Create icon + label texture
	function createLabelTexture(icon: string, label: string, color: string): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		canvas.width = 256;
		canvas.height = 128;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Background pill
		ctx.fillStyle = `${color}22`;
		ctx.strokeStyle = `${color}88`;
		ctx.lineWidth = 2;
		const rx = 20, ry = 20, rw = 216, rh = 88;
		ctx.beginPath();
		ctx.roundRect(rx, ry, rw, rh, 16);
		ctx.fill();
		ctx.stroke();

		// Icon
		ctx.font = 'bold 40px Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.shadowColor = color;
		ctx.shadowBlur = 12;
		ctx.fillStyle = '#ffffff';
		ctx.fillText(icon, 80, 64);

		// Label text
		ctx.shadowBlur = 6;
		ctx.font = 'bold 22px "Courier New", monospace';
		ctx.fillStyle = color;
		ctx.fillText(label, 175, 64);

		const texture = new THREE.CanvasTexture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	const labelTexture = createLabelTexture(config.icon, config.label, config.color);

	// Different inner geometry per type
	const geometryMap: Record<string, { type: string; args: number[] }> = {
		health:    { type: 'octahedron', args: [0.6, 0] },
		speed:     { type: 'cone',       args: [0.5, 1.0, 4] },
		multishot: { type: 'icosahedron',args: [0.55, 0] },
		shield:    { type: 'dodecahedron', args: [0.55, 0] }
	};
	const geoType = data?.type ?? 'health';

	let pulsePhase = 0;
	let ringSpin = 0;

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.powerUps.findIndex((p) => p.id === id);
		const d = world.powerUps[cachedIndex];
		if (!group || !d || d.collected) return;

		// Position on sphere surface
		group.position.copy(d.position);
		group.quaternion.copy(getSphereOrientation(d.position));
		// Bob effect: offset along sphere normal
		const normal = d.position.clone().normalize();
		group.position.addScaledVector(normal, Math.sin(d.bobPhase) * 0.5 + 1.2);
		group.rotateZ(delta * 2);

		// Pulse glow
		pulsePhase += delta * 3;
		ringSpin += delta * 1.5;
	});
</script>

<T.Group bind:ref={group}>
	<!-- Inner shape (type-specific geometry) -->
	<T.Mesh>
		{#if geoType === 'health'}
			<T.OctahedronGeometry args={[0.6, 0]} />
		{:else if geoType === 'speed'}
			<T.ConeGeometry args={[0.5, 1.0, 4]} />
		{:else if geoType === 'multishot'}
			<T.IcosahedronGeometry args={[0.55, 0]} />
		{:else}
			<T.DodecahedronGeometry args={[0.55, 0]} />
		{/if}
		<T.MeshBasicMaterial
			color={config.color}
			transparent
			opacity={0.7}
		/>
	</T.Mesh>

	<!-- Outer ethereal halo -->
	<T.Mesh>
		<T.SphereGeometry args={[0.95, 8, 8]} />
		<T.MeshBasicMaterial
			color={config.color}
			transparent
			opacity={0.12}
		/>
	</T.Mesh>

	<!-- Rotating ring indicator -->
	<T.Mesh rotation.x={Math.PI / 2}>
		<T.TorusGeometry args={[1.2, 0.04, 8, 24]} />
		<T.MeshBasicMaterial
			color={config.color}
			transparent
			opacity={0.35}
		/>
	</T.Mesh>

	<!-- Second ring, tilted -->
	<T.Mesh rotation.x={Math.PI / 3} rotation.y={Math.PI / 4}>
		<T.TorusGeometry args={[1.1, 0.03, 8, 24]} />
		<T.MeshBasicMaterial
			color={config.glow}
			transparent
			opacity={0.2}
		/>
	</T.Mesh>

	<!-- Floating label sprite above -->
	<T.Sprite bind:ref={iconSprite} position.z={2.2} scale={[4.5, 2.2, 1]}>
		<T.SpriteMaterial
			map={labelTexture}
			transparent
			opacity={0.9}
			depthTest={false}
		/>
	</T.Sprite>

	<!-- Ground glow circle -->
	<T.Mesh rotation.x={-Math.PI / 2} position.z={-0.8}>
		<T.RingGeometry args={[1.0, 2.2, 24]} />
		<T.MeshBasicMaterial
			color={config.color}
			transparent
			opacity={0.08}
			side={2}
		/>
	</T.Mesh>
</T.Group>
