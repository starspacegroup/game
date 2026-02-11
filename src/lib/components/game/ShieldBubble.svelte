<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { gameState } from '$lib/stores/gameState.svelte';

	let shieldMesh: THREE.Mesh | undefined = $state();
	let shieldGlowMesh: THREE.Mesh | undefined = $state();

	// Shield visual parameters  
	const SHIELD_RADIUS = 2.2;
	const BASE_OPACITY = 0.18;
	const HIT_OPACITY = 0.6;
	const BASE_COLOR = new THREE.Color('#4488ff');
	const HIT_COLOR = new THREE.Color('#88ccff');
	const CRITICAL_COLOR = new THREE.Color('#ff6644');

	let pulsePhase = 0;
	let hexRotation = 0;

	// Create hex-grid pattern texture for the shield
	function createShieldTexture(): THREE.CanvasTexture {
		const size = 512;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;

		ctx.clearRect(0, 0, size, size);

		// Draw hexagonal grid pattern
		const hexR = 24;
		const hexH = hexR * Math.sqrt(3);
		ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
		ctx.lineWidth = 1.5;

		for (let row = -1; row < size / hexH + 1; row++) {
			for (let col = -1; col < size / (hexR * 1.5) + 1; col++) {
				const cx = col * hexR * 3 + (row % 2 === 0 ? 0 : hexR * 1.5);
				const cy = row * hexH * 0.5;
				drawHex(ctx, cx, cy, hexR);
			}
		}

		// Add a radial gradient for softer edges
		const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		grad.addColorStop(0, 'rgba(100, 180, 255, 0.0)');
		grad.addColorStop(0.5, 'rgba(100, 180, 255, 0.05)');
		grad.addColorStop(0.85, 'rgba(100, 180, 255, 0.3)');
		grad.addColorStop(1, 'rgba(100, 180, 255, 0.0)');
		ctx.globalCompositeOperation = 'source-atop';
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, size, size);

		const tex = new THREE.CanvasTexture(canvas);
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		return tex;
	}

	function drawHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const angle = (Math.PI / 3) * i - Math.PI / 6;
			const x = cx + r * Math.cos(angle);
			const y = cy + r * Math.sin(angle);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.stroke();
	}

	const shieldTexture = typeof document !== 'undefined' ? createShieldTexture() : null;

	useTask((delta) => {
		if (!shieldMesh || !shieldGlowMesh) return;

		const hasShield = gameState.hasShield;
		shieldMesh.visible = hasShield;
		shieldGlowMesh.visible = hasShield;
		if (!hasShield) return;

		const shieldPct = gameState.shieldPercent / 100;
		const hitFlash = gameState.shieldHitFlash;

		// Pulse animation
		pulsePhase += delta * 2;
		hexRotation += delta * 0.3;
		const pulse = Math.sin(pulsePhase) * 0.03;

		// Scale based on shield health — shrinks slightly as it weakens
		const healthScale = 0.9 + shieldPct * 0.1;
		const scale = SHIELD_RADIUS * healthScale + pulse;
		shieldMesh.scale.setScalar(scale);
		shieldGlowMesh.scale.setScalar(scale * 1.15);

		// Slow rotation for visual interest
		shieldMesh.rotation.y = hexRotation;
		shieldMesh.rotation.x = hexRotation * 0.3;

		// Color: blend from blue -> red as shield gets low
		const mat = shieldMesh.material as THREE.MeshBasicMaterial;
		const glowMat = shieldGlowMesh.material as THREE.MeshBasicMaterial;

		if (shieldPct < 0.25) {
			// Critical — flash red/orange
			const critFlash = Math.sin(pulsePhase * 6) * 0.5 + 0.5;
			mat.color.copy(CRITICAL_COLOR).lerp(BASE_COLOR, critFlash * 0.3);
		} else if (hitFlash > 0) {
			// Hit flash — bright white-blue
			mat.color.copy(BASE_COLOR).lerp(HIT_COLOR, hitFlash);
		} else {
			mat.color.copy(BASE_COLOR);
		}

		// Opacity: higher during hit, pulsing normally
		const basePulseOpacity = BASE_OPACITY + Math.sin(pulsePhase * 1.5) * 0.04;
		mat.opacity = basePulseOpacity + hitFlash * (HIT_OPACITY - BASE_OPACITY);
		glowMat.opacity = (basePulseOpacity * 0.4) + hitFlash * 0.3;
		glowMat.color.copy(mat.color);
	});
</script>

<!-- Inner shield sphere with hex pattern -->
<T.Mesh bind:ref={shieldMesh} visible={false}>
	<T.IcosahedronGeometry args={[1, 3]} />
	<T.MeshBasicMaterial
		color="#4488ff"
		transparent
		opacity={0.18}
		side={THREE.DoubleSide}
		depthWrite={false}
		blending={THREE.AdditiveBlending}
		map={shieldTexture}
	/>
</T.Mesh>

<!-- Outer glow sphere -->
<T.Mesh bind:ref={shieldGlowMesh} visible={false}>
	<T.IcosahedronGeometry args={[1, 2]} />
	<T.MeshBasicMaterial
		color="#4488ff"
		transparent
		opacity={0.07}
		side={THREE.BackSide}
		depthWrite={false}
		blending={THREE.AdditiveBlending}
	/>
</T.Mesh>
