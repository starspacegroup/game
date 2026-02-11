<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getSphereOrientation } from '$lib/game/world';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();
	let group: THREE.Group | undefined = $state();
	let glowPhase = Math.random() * Math.PI * 2;
	let glowIntensity = $state(0.6);
	let dataStreamPhase = $state(0);

	let cachedIndex = world.npcs.findIndex((n) => n.id === id);

	// Track conversion state for reactive visuals
	let isConverted = $state(false);
	let conversionProgress = $state(0);

	// Debug: line from converted NPC to target node
	let debugLineGeometry: THREE.BufferGeometry | undefined = $state();
	let hasTargetLine = $state(false);

	useTask((delta) => {
		if (cachedIndex < 0) cachedIndex = world.npcs.findIndex((n) => n.id === id);
		const data = world.npcs[cachedIndex];
		if (!group || !data || data.destroyed) return;

		// Position on sphere surface and orient tangent to sphere
		group.position.copy(data.position);
		group.quaternion.copy(getSphereOrientation(data.position));
		// Apply facing rotation in tangent plane
		const facingQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), data.rotation.z);
		group.quaternion.multiply(facingQ);

		// Update conversion state
		isConverted = data.converted;
		conversionProgress = data.conversionProgress;

		// Pulsing glow animation
		glowPhase += delta * (isConverted ? 2 : 3);
		
		if (isConverted) {
			// Friendly pulse - calm cyan/green glow
			glowIntensity = 0.4 + Math.sin(glowPhase) * 0.2;
			// Data stream animation
			dataStreamPhase += delta * 5;

			// Debug: draw line to target node
			const targetNode = data.targetNodeId ? world.puzzleNodes.find(n => n.id === data.targetNodeId) : null;
			if (targetNode) {
				// Point directly to the actual node position (inside the sphere)
				const positions = new Float32Array([
					data.position.x, data.position.y, data.position.z,
					targetNode.position.x, targetNode.position.y, targetNode.position.z
				]);
				if (!debugLineGeometry) {
					debugLineGeometry = new THREE.BufferGeometry();
				}
				debugLineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
				debugLineGeometry.attributes.position.needsUpdate = true;
				hasTargetLine = true;
			} else {
				hasTargetLine = false;
			}
		} else if (conversionProgress > 0) {
			// Converting - rapid flickering
			glowIntensity = 0.5 + Math.sin(glowPhase * 10) * 0.5;
		} else {
			// Hostile pulse - aggressive red glow
			glowIntensity = 0.6 + Math.sin(glowPhase) * 0.3;
		}
	});

	// Derive colors based on conversion state
	let bodyColor = $derived(isConverted ? '#00cc88' : (conversionProgress > 0 ? '#88aa44' : `hsl(${Math.random() * 30}, 80%, 45%)`));
	let emissiveColor = $derived(isConverted ? '#00ffaa' : (conversionProgress > 0 ? '#aaff00' : '#ff2200'));
	let wireframeColor = $derived(isConverted ? '#00ffcc' : (conversionProgress > 0 ? '#ccff00' : '#ff4422'));
</script>

<T.Group bind:ref={group}>
	<!-- Main body -->
	<T.Mesh rotation.x={Math.PI}>
		<T.ConeGeometry args={[0.5, 1.8, 4]} />
		<T.MeshStandardMaterial
			color={bodyColor}
			emissive={emissiveColor}
			emissiveIntensity={glowIntensity}
			metalness={0.6}
			roughness={0.4}
		/>
	</T.Mesh>
	<!-- Wireframe targeting/data indicator -->
	<T.LineSegments rotation.x={Math.PI}>
		<T.WireframeGeometry args={[new THREE.ConeGeometry(0.6, 2.0, 4)]} />
		<T.LineBasicMaterial color={wireframeColor} transparent opacity={isConverted ? 0.7 : 0.5} />
	</T.LineSegments>
	<!-- Wings/Solar panels -->
	<T.Mesh position={[-0.8, -0.2, 0]}>
		<T.BoxGeometry args={[0.8, 0.06, 0.4]} />
		<T.MeshStandardMaterial 
			color={isConverted ? '#006644' : '#442200'} 
			emissive={isConverted ? '#00ff88' : '#ff3311'} 
			emissiveIntensity={0.4} 
		/>
	</T.Mesh>
	<T.Mesh position={[0.8, -0.2, 0]}>
		<T.BoxGeometry args={[0.8, 0.06, 0.4]} />
		<T.MeshStandardMaterial 
			color={isConverted ? '#006644' : '#442200'} 
			emissive={isConverted ? '#00ff88' : '#ff3311'} 
			emissiveIntensity={0.4} 
		/>
	</T.Mesh>
	
	{#if isConverted}
		<!-- Data transmission ring - shows the NPC is transmitting hints -->
		<T.Mesh rotation.x={Math.PI / 2} position.y={-0.5}>
			<T.RingGeometry args={[0.8 + Math.sin(dataStreamPhase) * 0.2, 1.0 + Math.sin(dataStreamPhase) * 0.2, 16]} />
			<T.MeshBasicMaterial color="#00ffaa" transparent opacity={0.3 + Math.sin(dataStreamPhase * 2) * 0.2} side={2} />
		</T.Mesh>
		<!-- Inner data core glow -->
		<T.Mesh>
			<T.SphereGeometry args={[0.3, 8, 8]} />
			<T.MeshBasicMaterial color="#00ffcc" transparent opacity={0.5 + Math.sin(dataStreamPhase * 3) * 0.3} />
		</T.Mesh>
	{/if}
	
	{#if conversionProgress > 0 && !isConverted}
		<!-- Conversion effect - spinning data particles -->
		<T.Mesh rotation.z={dataStreamPhase * 2}>
			<T.RingGeometry args={[1.2, 1.5, 8]} />
			<T.MeshBasicMaterial color="#aaff00" transparent opacity={conversionProgress * 0.8} side={2} />
		</T.Mesh>
	{/if}
</T.Group>

{#if isConverted && hasTargetLine && debugLineGeometry}
	<T.Line>
		<T is={debugLineGeometry} />
		<T.LineBasicMaterial color="#00ffff" linewidth={2} transparent opacity={0.8} />
	</T.Line>
{/if}
