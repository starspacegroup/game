<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { world, SPHERE_RADIUS, getTangentFrame, surfaceProximity, nodeInteractRange } from '$lib/game/world';
	import { toSpherical } from '$lib/game/chunk';
	import { gameState } from '$lib/stores/gameState.svelte';

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

			// Compute heading angle: angle between geographic north and playerUp
			// so the minimap rotates to match the player's orientation
			const frame = getTangentFrame(world.player.position);
			const eastDot = world.playerUp.dot(frame.east);
			const northDot = world.playerUp.dot(frame.north);
			const heading = Math.atan2(eastDot, northDot);
			const cosH = Math.cos(-heading);
			const sinH = Math.sin(-heading);

			// Helper: orthographic project + rotate by heading
			function project(eLat: number, eLon: number): { px: number; py: number; visible: boolean } {
				const ox = Math.cos(eLat) * Math.sin(eLon - lon);
				const oy = Math.sin(eLat) * Math.cos(lat) - Math.cos(eLat) * Math.sin(lat) * Math.cos(eLon - lon);
				const oz = Math.sin(eLat) * Math.sin(lat) + Math.cos(eLat) * Math.cos(lat) * Math.cos(eLon - lon);
				if (oz < 0) return { px: 0, py: 0, visible: false };
				// Rotate by heading so "up" matches player facing
				const rx = ox * cosH - oy * sinH;
				const ry = ox * sinH + oy * cosH;
				return { px: HALF + rx * GLOBE_R, py: HALF - ry * GLOBE_R, visible: true };
			}

			// Draw globe outline
			ctx.strokeStyle = 'rgba(68, 136, 255, 0.3)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(HALF, HALF, GLOBE_R, 0, Math.PI * 2);
			ctx.stroke();

			// Draw lat/lon grid on orthographic projection
			ctx.strokeStyle = 'rgba(68, 136, 255, 0.1)';
			ctx.lineWidth = 0.5;

			// Longitude lines
			for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
				const lonRad = (lonDeg * Math.PI) / 180;
				ctx.beginPath();
				let first = true;
				for (let latDeg = -90; latDeg <= 90; latDeg += 3) {
					const latRad = (latDeg * Math.PI) / 180;
					const p = project(latRad, lonRad);
					if (!p.visible) { first = true; continue; }
					if (first) { ctx.moveTo(p.px, p.py); first = false; }
					else ctx.lineTo(p.px, p.py);
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
					const p = project(latRad, lonRad);
					if (!p.visible) { first = true; continue; }
					if (first) { ctx.moveTo(p.px, p.py); first = false; }
					else ctx.lineTo(p.px, p.py);
				}
				ctx.stroke();
			}

			// Draw entities as dots on the globe
			// Asteroids (dim gray)
			ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
			for (const ast of world.asteroids) {
				if (ast.destroyed) continue;
				const { lat: aLat, lon: aLon } = toSpherical(ast.position);
				const p = project(aLat, aLon);
				if (!p.visible) continue;
				ctx.fillRect(p.px - 0.5, p.py - 0.5, 1, 1);
			}

			// NPCs (red/green dots)
			for (const npc of world.npcs) {
				if (npc.destroyed) continue;
				const { lat: nLat, lon: nLon } = toSpherical(npc.position);
				const p = project(nLat, nLon);
				if (!p.visible) continue;
				ctx.fillStyle = npc.converted ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 68, 68, 0.6)';
				ctx.beginPath();
				ctx.arc(p.px, p.py, 1.5, 0, Math.PI * 2);
				ctx.fill();
			}

			// Puzzle nodes. Three states have to be tellable apart at 2-3px:
			// locked in, reachable right now, and too far to act on. Previously
			// every unaligned node was the same dim amber dot, so the map gave
			// no reason to fly anywhere and no signal on arrival.
			const activeId = gameState.nodeInRange?.id;
			const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
			for (const node of world.puzzleNodes) {
				const { lat: pLat, lon: pLon } = toSpherical(node.position);
				const p = project(pLat, pLon);
				if (!p.visible) continue;

				const reachable = !node.connected &&
					surfaceProximity(world.player.position, node.position)
						<= nodeInteractRange(world.player.radius, node.radius);

				if (node.connected) {
					// Locked in — solid blue, with a ring so it reads as "done"
					ctx.fillStyle = 'rgba(68, 160, 255, 0.95)';
					ctx.beginPath();
					ctx.arc(p.px, p.py, 2.6, 0, Math.PI * 2);
					ctx.fill();
					ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.arc(p.px, p.py, 4.5, 0, Math.PI * 2);
					ctx.stroke();
				} else if (reachable) {
					// In range — pulsing cyan halo. This is the "you can act here"
					// signal the map never had.
					ctx.shadowColor = '#00ffcc';
					ctx.shadowBlur = 6 + pulse * 6;
					ctx.fillStyle = 'rgba(0, 255, 204, 0.95)';
					ctx.beginPath();
					ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
					ctx.fill();
					ctx.shadowBlur = 0;

					ctx.strokeStyle = `rgba(0, 255, 204, ${0.35 + pulse * 0.45})`;
					ctx.lineWidth = 1.2;
					ctx.beginPath();
					ctx.arc(p.px, p.py, 5.5 + pulse * 2.5, 0, Math.PI * 2);
					ctx.stroke();

					// Alignment progress as an arc around the node being worked on
					if (node.id === activeId && gameState.nodeInRange) {
						ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
						ctx.lineWidth = 1.6;
						ctx.beginPath();
						ctx.arc(p.px, p.py, 7.5, -Math.PI / 2,
							-Math.PI / 2 + Math.PI * 2 * gameState.nodeInRange.align);
						ctx.stroke();
					}
				} else {
					// Out of range — amber, dim, but still a target worth flying to
					ctx.fillStyle = 'rgba(255, 200, 68, 0.55)';
					ctx.beginPath();
					ctx.arc(p.px, p.py, 1.8, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			// Other players (white dots)
			ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
			for (const p of world.otherPlayers) {
				const { lat: pLat, lon: pLon } = toSpherical(p.position);
				const proj = project(pLat, pLon);
				if (!proj.visible) continue;
				ctx.beginPath();
				ctx.arc(proj.px, proj.py, 2, 0, Math.PI * 2);
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

			// Player heading indicator (small triangle pointing "up" = forward)
			ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
			ctx.beginPath();
			ctx.moveTo(HALF, HALF - 7);
			ctx.lineTo(HALF - 3, HALF - 3);
			ctx.lineTo(HALF + 3, HALF - 3);
			ctx.closePath();
			ctx.fill();

			// Shell progress — the map is where the player is already looking for
			// nodes, so the count of what they have locked in belongs here too.
			// Counted here rather than read from gameState so the map is correct
			// from the first frame, before any collision pass has run.
			let total = 0, done = 0;
			for (const n of world.puzzleNodes) {
				if (n.wave !== gameState.wave) continue;
				total++;
				if (n.connected) done++;
			}
			if (total > 0) {
				ctx.font = 'bold 9px monospace';
				ctx.textAlign = 'left';
				ctx.fillStyle = done > 0 ? 'rgba(68, 180, 255, 0.95)' : 'rgba(255, 200, 68, 0.8)';
				ctx.fillText(`${done}/${total}`, 3, 10);
				ctx.font = '7px monospace';
				ctx.fillStyle = 'rgba(120, 150, 190, 0.75)';
				ctx.fillText('NODES', 3, 18);
			}

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
</div>

<style>
	.minimap {
		position: fixed;
		/* Respects the notch like .hud does, and anchors the top-centre stack:
		   the HUD bar reserves a 140px .top-spacer for this, and .hint-display
		   is positioned to clear the bottom of it (safe-top + 138px). */
		top: calc(var(--safe-top, 0px) + 8px);
		left: 50%;
		transform: translateX(-50%);
		width: 120px;
		height: 130px;
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
</style>
