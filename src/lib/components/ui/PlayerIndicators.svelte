<script lang="ts">
	import { world } from '$lib/game/world';

	interface IndicatorData {
		id: string;
		username: string;
		angle: number;
		distance: number;
		x: number;
		y: number;
	}

	let indicators = $state<IndicatorData[]>([]);
	let screenWidth = $state(window.innerWidth);
	let screenHeight = $state(window.innerHeight);

	// Camera parameters (matching FollowCamera.svelte)
	const CAMERA_Z = 40;
	const CAMERA_FOV = 70;

	// Calculate shortest distance considering world wrap-around
	function getWrappedDelta(playerPos: number, otherPos: number, bound: number): number {
		let delta = otherPos - playerPos;
		const worldSize = bound * 2;
		
		// Check if wrapping gives a shorter path
		if (delta > bound) {
			delta -= worldSize;
		} else if (delta < -bound) {
			delta += worldSize;
		}
		return delta;
	}

	// Calculate visible area in world units at z=0 plane
	function getVisibleBounds(): { halfWidth: number; halfHeight: number } {
		const aspect = screenWidth / screenHeight;
		const halfHeight = CAMERA_Z * Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));
		const halfWidth = halfHeight * aspect;
		return { halfWidth, halfHeight };
	}

	function updateIndicators(): void {
		const { halfWidth, halfHeight } = getVisibleBounds();
		const newIndicators: IndicatorData[] = [];

		// Edge padding from screen border
		const padding = 50;

		for (const other of world.otherPlayers) {
			// Position relative to local player (with wrap-around handling)
			const dx = getWrappedDelta(world.player.position.x, other.position.x, world.bounds.x);
			const dy = getWrappedDelta(world.player.position.y, other.position.y, world.bounds.y);
			const distance = Math.sqrt(dx * dx + dy * dy);

			// Check if player is on screen (within visible bounds with some margin)
			const margin = 3; // Units margin before showing indicator
			const isOnScreen =
				Math.abs(dx) < halfWidth - margin && Math.abs(dy) < halfHeight - margin;

			if (!isOnScreen && distance > 5) {
				// Calculate angle from player to other player
				const angle = Math.atan2(dy, dx);

				// Calculate where to place the indicator on screen edge
				// Project onto screen space
				const screenCenterX = screenWidth / 2;
				const screenCenterY = screenHeight / 2;

				// Direction vector
				const dirX = Math.cos(angle);
				const dirY = Math.sin(angle);

				// Find intersection with screen edge
				// We need to scale the direction to hit the screen boundary
				const maxX = screenWidth / 2 - padding;
				const maxY = screenHeight / 2 - padding;

				let scale = Infinity;
				if (Math.abs(dirX) > 0.001) {
					scale = Math.min(scale, maxX / Math.abs(dirX));
				}
				if (Math.abs(dirY) > 0.001) {
					scale = Math.min(scale, maxY / Math.abs(dirY));
				}

				// Screen position for indicator (note: Y is inverted in screen coords)
				const indicatorX = screenCenterX + dirX * scale;
				const indicatorY = screenCenterY - dirY * scale; // Invert Y for screen coords

				newIndicators.push({
					id: other.id,
					username: other.username || 'Player',
					angle: angle * (180 / Math.PI), // Convert to degrees for CSS
					distance: Math.round(distance),
					x: indicatorX,
					y: indicatorY
				});
			}
		}

		indicators = newIndicators;
	}

	// Update indicators periodically
	let animationFrame: number;
	$effect(() => {
		function loop(): void {
			updateIndicators();
			animationFrame = requestAnimationFrame(loop);
		}
		loop();

		return () => {
			cancelAnimationFrame(animationFrame);
		};
	});

	// Handle window resize
	$effect(() => {
		function handleResize(): void {
			screenWidth = window.innerWidth;
			screenHeight = window.innerHeight;
		}
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

<div class="player-indicators">
	{#each indicators as indicator (indicator.id)}
		<div
			class="indicator"
			style="left: {indicator.x}px; top: {indicator.y}px;"
		>
			<div
				class="arrow"
				style="transform: rotate({-indicator.angle + 90}deg);"
			>
				▲
			</div>
			<div class="info">
				<span class="username">{indicator.username}</span>
				<span class="distance">{indicator.distance}m</span>
			</div>
		</div>
	{/each}
</div>

<style>
	.player-indicators {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 15;
	}

	.indicator {
		position: absolute;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		animation: pulse 1.5s ease-in-out infinite;
	}

	.arrow {
		font-size: 24px;
		color: #00ffff;
		text-shadow:
			0 0 8px #00ffff,
			0 0 16px #00ffff,
			0 0 24px #0088aa;
		line-height: 1;
	}

	.info {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(0, 20, 40, 0.8);
		border: 1px solid rgba(0, 255, 255, 0.4);
		border-radius: 4px;
		padding: 4px 8px;
		font-family: 'Courier New', monospace;
	}

	.username {
		color: #00ffff;
		font-size: 11px;
		font-weight: bold;
		text-transform: uppercase;
		white-space: nowrap;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.distance {
		color: #88ccff;
		font-size: 10px;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.arrow {
			font-size: 20px;
		}

		.info {
			padding: 2px 6px;
		}

		.username {
			font-size: 10px;
			max-width: 60px;
		}

		.distance {
			font-size: 9px;
		}
	}
</style>
