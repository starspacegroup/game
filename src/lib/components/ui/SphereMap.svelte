<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { world, SPHERE_RADIUS } from '$lib/game/world';
	import { toSpherical } from '$lib/game/chunk';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let animFrame: number;

	const SIZE = 120;
	const HALF = SIZE / 2;
	const GLOBE_R = 42;

	onMount(() => {
		ctx = canvas.getContext('2d')!;
		function draw() {
			if (!ctx) return;
			ctx.clearRect(0, 0, SIZE, SIZE);

			const { lat, lon } = toSpherical(world.player.position);

			// Draw globe outline
			ctx.strokeStyle = 'rgba(68, 136, 255, 0.3)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(HALF, HALF, GLOBE_R, 0, Math.PI * 2);
			ctx.stroke();

			// Draw lat/lon grid on orthographic projection from player's perspective
			ctx.strokeStyle = 'rgba(68, 136, 255, 0.1)';
			ctx.lineWidth = 0.5;

			// Longitude lines
			for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
				const lonRad = (lonDeg * Math.PI) / 180;
				ctx.beginPath();
				let first = true;
				for (let latDeg = -90; latDeg <= 90; latDeg += 3) {
					const latRad = (latDeg * Math.PI) / 180;
					// Orthographic projection centered on player
					const x = Math.cos(latRad) * Math.sin(lonRad - lon);
					const y = Math.sin(latRad) * Math.cos(lat) - Math.cos(latRad) * Math.sin(lat) * Math.cos(lonRad - lon);
					const z = Math.sin(latRad) * Math.sin(lat) + Math.cos(latRad) * Math.cos(lat) * Math.cos(lonRad - lon);
					if (z < 0) { first = true; continue; }
					const px = HALF + x * GLOBE_R;
					const py = HALF - y * GLOBE_R;
					if (first) { ctx.moveTo(px, py); first = false; }
					else ctx.lineTo(px, py);
				}
				ctx.stroke();
			}

			// Latitude lines
			for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
				const latRad = (latDeg * Math.PI) / 180;
				ctx.beginPath();
				let first = true;
				for (let lonDeg = 0; lonDeg <= 360; lonDeg += 3) {
					const lonRad = (lonDeg * Math.PI) / 180;
					const x = Math.cos(latRad) * Math.sin(lonRad - lon);
					const y = Math.sin(latRad) * Math.cos(lat) - Math.cos(latRad) * Math.sin(lat) * Math.cos(lonRad - lon);
					const z = Math.sin(latRad) * Math.sin(lat) + Math.cos(latRad) * Math.cos(lat) * Math.cos(lonRad - lon);
					if (z < 0) { first = true; continue; }
					const px = HALF + x * GLOBE_R;
					const py = HALF - y * GLOBE_R;
					if (first) { ctx.moveTo(px, py); first = false; }
					else ctx.lineTo(px, py);
				}
				ctx.stroke();
			}

			// Draw entities as dots on the globe
			// Asteroids (dim gray)
			ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
			for (const ast of world.asteroids) {
				if (ast.destroyed) continue;
				const { lat: aLat, lon: aLon } = toSpherical(ast.position);
				const x = Math.cos(aLat) * Math.sin(aLon - lon);
				const y = Math.sin(aLat) * Math.cos(lat) - Math.cos(aLat) * Math.sin(lat) * Math.cos(aLon - lon);
				const z = Math.sin(aLat) * Math.sin(lat) + Math.cos(aLat) * Math.cos(lat) * Math.cos(aLon - lon);
				if (z < 0) continue;
				ctx.fillRect(HALF + x * GLOBE_R - 0.5, HALF - y * GLOBE_R - 0.5, 1, 1);
			}

			// NPCs (red/green dots)
			for (const npc of world.npcs) {
				if (npc.destroyed) continue;
				const { lat: nLat, lon: nLon } = toSpherical(npc.position);
				const x = Math.cos(nLat) * Math.sin(nLon - lon);
				const y = Math.sin(nLat) * Math.cos(lat) - Math.cos(nLat) * Math.sin(lat) * Math.cos(nLon - lon);
				const z = Math.sin(nLat) * Math.sin(lat) + Math.cos(nLat) * Math.cos(lat) * Math.cos(nLon - lon);
				if (z < 0) continue;
				ctx.fillStyle = npc.converted ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 68, 68, 0.6)';
				ctx.beginPath();
				ctx.arc(HALF + x * GLOBE_R, HALF - y * GLOBE_R, 1.5, 0, Math.PI * 2);
				ctx.fill();
			}

			// Puzzle nodes (colored dots)
			for (const node of world.puzzleNodes) {
				const { lat: pLat, lon: pLon } = toSpherical(node.position);
				const x = Math.cos(pLat) * Math.sin(pLon - lon);
				const y = Math.sin(pLat) * Math.cos(lat) - Math.cos(pLat) * Math.sin(lat) * Math.cos(pLon - lon);
				const z = Math.sin(pLat) * Math.sin(lat) + Math.cos(pLat) * Math.cos(lat) * Math.cos(pLon - lon);
				if (z < 0) continue;
				ctx.fillStyle = node.connected ? 'rgba(68, 136, 255, 0.9)' : 'rgba(255, 200, 68, 0.6)';
				ctx.beginPath();
				ctx.arc(HALF + x * GLOBE_R, HALF - y * GLOBE_R, node.connected ? 3 : 2, 0, Math.PI * 2);
				ctx.fill();
			}

			// Other players (white dots)
			ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
			for (const p of world.otherPlayers) {
				const { lat: pLat, lon: pLon } = toSpherical(p.position);
				const x = Math.cos(pLat) * Math.sin(pLon - lon);
				const y = Math.sin(pLat) * Math.cos(lat) - Math.cos(pLat) * Math.sin(lat) * Math.cos(pLon - lon);
				const z = Math.sin(pLat) * Math.sin(lat) + Math.cos(pLat) * Math.cos(lat) * Math.cos(pLon - lon);
				if (z < 0) continue;
				ctx.beginPath();
				ctx.arc(HALF + x * GLOBE_R, HALF - y * GLOBE_R, 2, 0, Math.PI * 2);
				ctx.fill();
			}

			// Player dot (center, always visible) — cyan with glow
			ctx.shadowColor = '#00ffff';
			ctx.shadowBlur = 6;
			ctx.fillStyle = '#00ffff';
			ctx.beginPath();
			ctx.arc(HALF, HALF, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.shadowBlur = 0;

			// Coordinates label
			const latDeg = ((lat * 180) / Math.PI).toFixed(1);
			const lonDeg = ((lon * 180) / Math.PI).toFixed(1);
			ctx.font = '9px monospace';
			ctx.fillStyle = 'rgba(100, 160, 220, 0.7)';
			ctx.textAlign = 'center';
			ctx.fillText(`${latDeg}° ${lonDeg}°`, HALF, SIZE - 4);

			animFrame = requestAnimationFrame(draw);
		}
		draw();
	});

	onDestroy(() => {
		if (animFrame) cancelAnimationFrame(animFrame);
	});
</script>

<div class="minimap">
	<canvas bind:this={canvas} width={SIZE} height={SIZE}></canvas>
	<span class="minimap-label">SPHERE MAP</span>
</div>

<style>
	.minimap {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: 120px;
		height: 140px;
		pointer-events: none;
		z-index: 15;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	canvas {
		border: 1px solid rgba(68, 136, 255, 0.2);
		border-radius: 50%;
		background: rgba(0, 8, 24, 0.7);
	}

	.minimap-label {
		font-family: 'Courier New', monospace;
		font-size: 0.55rem;
		color: rgba(100, 160, 220, 0.5);
		letter-spacing: 2px;
		margin-top: 4px;
	}
</style>
