<script lang="ts">
	import { gameState, type ActiveBuff } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { world, SPHERE_RADIUS } from '$lib/game/world';
	import { toSpherical } from '$lib/game/chunk';

	// Tick buff timers for countdown display
	let buffDisplays = $state<{ type: string; icon: string; label: string; color: string; remaining: number; seconds: number }[]>([]);

	function updateBuffDisplays() {
		const now = Date.now();
		buffDisplays = gameState.activeBuffs
			.filter(b => now < b.expiresAt)
			.map(b => {
				const totalDuration = b.expiresAt - b.startedAt;
				const elapsed = now - b.startedAt;
				const remaining = Math.max(0, 1 - elapsed / totalDuration);
				const seconds = Math.max(0, Math.ceil((b.expiresAt - now) / 1000));
				return { type: b.type, icon: b.icon, label: b.label, color: b.color, remaining, seconds };
			});
		requestAnimationFrame(updateBuffDisplays);
	}
	if (typeof window !== 'undefined') requestAnimationFrame(updateBuffDisplays);

	// Reactive position info for sphere coordinates
	let latDisplay = $state('0.0');
	let lonDisplay = $state('0.0');
	let altDisplay = $state('0');
	let hemisphere = $state('N');

	// Update coordinates periodically (every ~200ms via rAF)
	let coordTimer = 0;
	function updateCoords() {
		coordTimer++;
		if (coordTimer % 12 === 0) { // Every ~12 frames
			const { lat, lon } = toSpherical(world.player.position);
			const latDeg = (lat * 180) / Math.PI;
			const lonDeg = (lon * 180) / Math.PI;
			latDisplay = Math.abs(latDeg).toFixed(1);
			lonDisplay = Math.abs(lonDeg).toFixed(1);
			hemisphere = latDeg >= 0 ? 'N' : 'S';
			altDisplay = (world.player.position.length() - SPHERE_RADIUS).toFixed(0);
		}
		requestAnimationFrame(updateCoords);
	}
	if (typeof window !== 'undefined') requestAnimationFrame(updateCoords);
</script>

<div class="hud">
	<!-- User indicator -->
	{#if authState.isLoggedIn}
		<div class="user-indicator">
			{#if authState.avatarUrl}
				<img src={authState.avatarUrl} alt="Avatar" class="user-avatar" />
			{:else}
				<div class="user-avatar-placeholder">
					{authState.username?.charAt(0).toUpperCase() || '?'}
				</div>
			{/if}
			<div class="user-info">
				<span class="user-name">{authState.username}</span>
				<span class="user-status">
					<span class="status-dot"></span>
					ONLINE
				</span>
			</div>
		</div>
	{/if}

	<!-- Top bar -->
	<div class="hud-top">
		<div class="score">
			<span class="label">SCORE</span>
			<span class="value">{gameState.score.toLocaleString()}</span>
		</div>

		<div class="mode-badge" class:multiplayer={gameState.mode === 'multiplayer'}>
			{#if gameState.mode === 'multiplayer'}
				<span class="mode-label">MULTIPLAYER</span>
				<span class="player-count">{gameState.playerCount} online</span>
			{:else}
				SOLO
			{/if}
		</div>

		<div class="wave">
			<span class="label">WAVE</span>
			<span class="value">{gameState.wave}</span>
		</div>
	</div>

	<!-- Health bar -->
	<div class="health-container" class:health-flash={gameState.healthFlash}>
		<div class="health-bar">
			<div
				class="health-fill"
				class:danger={gameState.healthPercent < 25}
				class:warning={gameState.healthPercent >= 25 && gameState.healthPercent < 50}
				class:healing={gameState.healthFlash}
				style="width: {gameState.healthPercent}%"
			></div>
			{#if gameState.healthFlash}
				<div class="health-heal-glow"></div>
			{/if}
		</div>
		<span class="health-text">{Math.ceil(gameState.health)}/{gameState.maxHealth}</span>
	</div>

	<!-- Active buffs bar -->
	{#if buffDisplays.length > 0}
		<div class="buffs-container">
			{#each buffDisplays as buff (buff.type)}
				<div class="buff-item" style="--buff-color: {buff.color}; --buff-remaining: {buff.remaining}">
					<div class="buff-icon-wrap">
						<span class="buff-icon">{buff.icon}</span>
						<svg class="buff-timer-ring" viewBox="0 0 36 36">
							<circle
								cx="18" cy="18" r="15.5"
								fill="none"
								stroke="{buff.color}22"
								stroke-width="2"
							/>
							<circle
								cx="18" cy="18" r="15.5"
								fill="none"
								stroke="{buff.color}"
								stroke-width="2.5"
								stroke-dasharray="{buff.remaining * 97.4} 97.4"
								stroke-linecap="round"
								transform="rotate(-90 18 18)"
							/>
						</svg>
					</div>
					<div class="buff-info">
						<span class="buff-label">{buff.label}</span>
						<span class="buff-time" class:buff-expiring={buff.seconds <= 3}>{buff.seconds}s</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Puzzle progress (only show when some progress exists) -->
	{#if gameState.puzzleProgress > 0.01}
		<div class="puzzle-progress">
			<span class="label">KAL-TOH</span>
			<div class="puzzle-bar">
				<div
					class="puzzle-fill"
					style="width: {gameState.puzzleProgress * 100}%"
				></div>
			</div>
			{#if gameState.puzzleSolved}
				<span class="puzzle-complete">SOLVED</span>
			{/if}
		</div>
	{/if}

	<!-- Converted satellites counter -->
	{#if gameState.convertedNpcCount > 0}
		<div class="converted-counter">
			<span class="converted-icon">◈</span>
			<span class="converted-value">{gameState.convertedNpcCount}</span>
			<span class="converted-label">SATELLITES CONVERTED</span>
			<span class="data-collected">+{gameState.dataCollected} DATA</span>
		</div>
	{/if}

	<!-- Latest hint display -->
	{#if gameState.latestHint}
		<div class="hint-display">
			<div class="hint-header">
				<span class="hint-icon">⟁</span>
				<span>INCOMING DATA</span>
			</div>
			<div class="hint-text">{gameState.latestHint}</div>
		</div>
	{/if}

	<!-- Controls hint -->
	{#if !gameState.isMobile}
		<div class="controls-hint">
			WASD move &bull; Mouse aim &bull; Click shoot &bull; E interact &bull; Shift boost
		</div>
	{/if}

	<!-- Sphere coordinates -->
	<div class="sphere-coords">
		<span class="coord-label">LAT</span> <span class="coord-val">{latDisplay}°{hemisphere}</span>
		<span class="coord-sep">&bull;</span>
		<span class="coord-label">LON</span> <span class="coord-val">{lonDisplay}°</span>
	</div>
</div>

<style>
	/* ===== MOBILE-FIRST HUD STYLES ===== */
	.hud {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		pointer-events: none;
		z-index: 10;
		font-family: var(--hud-font, 'Courier New', monospace);
		padding: calc(var(--safe-top, 0px) + var(--spacing-sm, 8px)) var(--spacing-sm, 8px) 0 var(--spacing-sm, 8px);
	}

	.hud-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs, 4px) 0;
		gap: var(--spacing-xs, 4px);
	}

	.score,
	.wave {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 60px;
	}

	.label {
		font-size: var(--font-xs, 0.6rem);
		color: #6688aa;
		letter-spacing: 1px;
	}

	.value {
		font-size: var(--font-lg, 1rem);
		color: #00ff88;
		font-weight: bold;
		text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
	}

	.mode-badge {
		padding: 3px 8px;
		border: 1px solid #335;
		border-radius: 4px;
		font-size: var(--font-xs, 0.6rem);
		color: #8899aa;
		letter-spacing: 1px;
		white-space: nowrap;
	}

	.mode-badge.multiplayer {
		border-color: #4488ff;
		color: #4488ff;
		background: rgba(68, 136, 255, 0.1);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 10px;
	}

	.mode-label {
		font-weight: bold;
		letter-spacing: 1px;
	}

	.player-count {
		font-size: 0.5rem;
		color: #66aaff;
		letter-spacing: 0;
	}

	.health-container {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm, 8px);
		margin-top: var(--spacing-xs, 4px);
		transition: all 0.3s ease;
	}

	.health-container.health-flash {
		animation: health-flash-glow 0.6s ease-out;
	}

	@keyframes health-flash-glow {
		0% { filter: brightness(1); }
		30% { filter: brightness(1.8) drop-shadow(0 0 12px #44ff44); }
		100% { filter: brightness(1); }
	}

	.health-bar {
		flex: 1;
		height: 6px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
		overflow: hidden;
		position: relative;
	}

	.health-fill {
		height: 100%;
		background: #00ff88;
		border-radius: 3px;
		transition: width 0.4s ease;
		box-shadow: 0 0 6px rgba(0, 255, 136, 0.4);
	}

	.health-fill.healing {
		transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 14px rgba(68, 255, 68, 0.8);
	}

	.health-heal-glow {
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(68, 255, 68, 0.6), transparent);
		animation: heal-sweep 0.6s ease-out forwards;
		border-radius: 3px;
	}

	@keyframes heal-sweep {
		0% { transform: translateX(-100%); opacity: 1; }
		100% { transform: translateX(100%); opacity: 0; }
	}

	.health-fill.warning {
		background: #ffaa00;
		box-shadow: 0 0 6px rgba(255, 170, 0, 0.4);
	}

	.health-fill.danger {
		background: #ff4444;
		box-shadow: 0 0 8px rgba(255, 68, 68, 0.6);
		animation: pulse 0.5s ease-in-out infinite alternate;
	}

	@keyframes pulse {
		from {
			opacity: 0.7;
		}
		to {
			opacity: 1;
		}
	}

	.health-text {
		font-size: var(--font-xs, 0.6rem);
		color: #8899aa;
		min-width: 50px;
		text-align: right;
	}

	.puzzle-progress {
		margin-top: var(--spacing-sm, 8px);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm, 8px);
	}

	.puzzle-bar {
		flex: 1;
		height: 4px;
		background: rgba(68, 136, 255, 0.15);
		border-radius: 2px;
		overflow: hidden;
	}

	.puzzle-fill {
		height: 100%;
		background: linear-gradient(90deg, #4488ff, #88aaff);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.puzzle-complete {
		font-size: var(--font-sm, 0.7rem);
		color: #ffdd00;
		font-weight: bold;
		text-shadow: 0 0 8px rgba(255, 221, 0, 0.6);
		animation: glow 1s ease-in-out infinite alternate;
	}

	@keyframes glow {
		from {
			text-shadow: 0 0 8px rgba(255, 221, 0, 0.4);
		}
		to {
			text-shadow: 0 0 16px rgba(255, 221, 0, 0.8);
		}
	}

	.controls-hint {
		position: fixed;
		bottom: var(--spacing-sm, 8px);
		left: 50%;
		transform: translateX(-50%);
		font-size: var(--font-xs, 0.6rem);
		color: #445566;
		letter-spacing: 1px;
		white-space: nowrap;
		padding-bottom: var(--safe-bottom, 0px);
	}

	/* User indicator - positioned top right, compact on mobile */
	.user-indicator {
		position: fixed;
		top: calc(var(--safe-top, 0px) + var(--spacing-sm, 8px));
		right: calc(var(--safe-right, 0px) + var(--spacing-sm, 8px));
		display: flex;
		align-items: center;
		gap: var(--spacing-sm, 8px);
		background: rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(68, 136, 255, 0.4);
		border-radius: 8px;
		padding: 4px 8px 4px 4px;
		pointer-events: auto;
		backdrop-filter: blur(4px);
		max-width: 140px;
	}

	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid #4488ff;
		box-shadow: 0 0 8px rgba(68, 136, 255, 0.5);
		flex-shrink: 0;
	}

	.user-avatar-placeholder {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid #4488ff;
		background: linear-gradient(135deg, #4488ff, #6644ff);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: bold;
		color: white;
		flex-shrink: 0;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow: hidden;
	}

	.user-name {
		font-size: var(--font-xs, 0.6rem);
		color: #ffffff;
		font-weight: 600;
		letter-spacing: 0.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-status {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 0.5rem;
		color: #00ff88;
		letter-spacing: 1px;
	}

	.status-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #00ff88;
		box-shadow: 0 0 6px rgba(0, 255, 136, 0.8);
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.6;
			transform: scale(0.9);
		}
	}

	/* ===== TABLET AND UP (768px+) ===== */
	@media (min-width: 768px) {
		.hud {
			padding: calc(var(--safe-top, 0px) + 12px) 16px 0 16px;
		}

		.hud-top {
			padding: 8px 0;
		}

		.score,
		.wave {
			min-width: 80px;
		}

		.label {
			font-size: 0.65rem;
			letter-spacing: 2px;
		}

		.value {
			font-size: 1.4rem;
		}

		.mode-badge {
			padding: 3px 10px;
			font-size: 0.7rem;
		}

		.health-text {
			font-size: 0.65rem;
			min-width: 55px;
		}

		.user-indicator {
			top: 12px;
			right: 12px;
			gap: 10px;
			padding: 6px 12px 6px 6px;
			max-width: 180px;
		}

		.user-avatar,
		.user-avatar-placeholder {
			width: 32px;
			height: 32px;
		}

		.user-avatar-placeholder {
			font-size: 0.9rem;
		}

		.user-name {
			font-size: 0.75rem;
			max-width: 120px;
		}

		.user-status {
			font-size: 0.6rem;
			gap: 4px;
		}

		.status-dot {
			width: 6px;
			height: 6px;
		}

		.controls-hint {
			bottom: 12px;
		}
	}

	/* Converted satellites counter */
	.converted-counter {
		margin-top: var(--spacing-sm, 8px);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs, 4px);
		padding: 4px 8px;
		background: rgba(0, 255, 170, 0.1);
		border: 1px solid rgba(0, 255, 170, 0.3);
		border-radius: 4px;
	}

	.converted-icon {
		color: #00ffaa;
		font-size: var(--font-sm, 0.8rem);
		animation: orbit 2s linear infinite;
	}

	@keyframes orbit {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.converted-value {
		color: #00ffaa;
		font-size: var(--font-md, 0.9rem);
		font-weight: bold;
		text-shadow: 0 0 8px rgba(0, 255, 170, 0.6);
	}

	.converted-label {
		color: #6699aa;
		font-size: var(--font-xs, 0.6rem);
		letter-spacing: 0.5px;
	}

	.data-collected {
		color: #00ffcc;
		font-size: var(--font-xs, 0.6rem);
		padding: 1px 4px;
		background: rgba(0, 255, 204, 0.15);
		border-radius: 2px;
		margin-left: auto;
	}

	/* Hint display */
	.hint-display {
		position: fixed;
		bottom: calc(var(--safe-bottom, 0px) + 50px);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 20, 40, 0.9);
		border: 1px solid rgba(0, 255, 204, 0.5);
		border-radius: 8px;
		padding: 8px 16px;
		max-width: 90%;
		width: auto;
		min-width: 200px;
		animation: hint-appear 0.3s ease-out;
		backdrop-filter: blur(4px);
	}

	@keyframes hint-appear {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	.hint-header {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #00ffcc;
		font-size: var(--font-xs, 0.6rem);
		letter-spacing: 2px;
		margin-bottom: 4px;
	}

	.hint-icon {
		font-size: var(--font-sm, 0.8rem);
		animation: pulse-hint 1s ease-in-out infinite;
	}

	@keyframes pulse-hint {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.hint-text {
		color: #aaddff;
		font-size: var(--font-sm, 0.75rem);
		line-height: 1.4;
		text-shadow: 0 0 4px rgba(170, 221, 255, 0.3);
	}

	@media (min-width: 768px) {
		.hint-display {
			bottom: 60px;
			max-width: 400px;
			padding: 10px 20px;
		}

		.hint-header {
			font-size: 0.65rem;
		}

		.hint-text {
			font-size: 0.85rem;
		}

		.converted-counter {
			padding: 5px 12px;
			gap: 8px;
		}
	}

	.sphere-coords {
		position: fixed;
		bottom: 16px;
		left: 16px;
		font-family: 'Courier New', monospace;
		font-size: 0.65rem;
		color: rgba(100, 160, 220, 0.6);
		letter-spacing: 1px;
		pointer-events: none;
	}

	.coord-label {
		color: rgba(100, 160, 220, 0.4);
		font-size: 0.55rem;
	}

	.coord-val {
		color: rgba(0, 255, 200, 0.7);
		font-weight: bold;
	}

	.coord-sep {
		margin: 0 4px;
		opacity: 0.3;
	}

	/* ===== ACTIVE BUFFS BAR ===== */
	.buffs-container {
		display: flex;
		gap: 8px;
		margin-top: var(--spacing-sm, 8px);
		flex-wrap: wrap;
	}

	.buff-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px 4px 4px;
		background: rgba(0, 8, 20, 0.7);
		border: 1px solid var(--buff-color, #888);
		border-radius: 8px;
		animation: buff-appear 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
		backdrop-filter: blur(4px);
	}

	@keyframes buff-appear {
		0% { opacity: 0; transform: scale(0.5) translateY(8px); }
		100% { opacity: 1; transform: scale(1) translateY(0); }
	}

	.buff-icon-wrap {
		position: relative;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.buff-icon {
		font-size: 1rem;
		z-index: 1;
		filter: drop-shadow(0 0 4px var(--buff-color));
	}

	.buff-timer-ring {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.buff-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.buff-label {
		font-family: 'Courier New', monospace;
		font-size: 0.55rem;
		color: var(--buff-color);
		letter-spacing: 1px;
		font-weight: bold;
	}

	.buff-time {
		font-family: 'Courier New', monospace;
		font-size: 0.6rem;
		color: rgba(200, 220, 240, 0.7);
	}

	.buff-time.buff-expiring {
		color: #ff6644;
		animation: buff-blink 0.5s ease-in-out infinite alternate;
	}

	@keyframes buff-blink {
		0% { opacity: 0.5; }
		100% { opacity: 1; }
	}

	@media (min-width: 768px) {
		.buff-item {
			gap: 8px;
			padding: 5px 14px 5px 5px;
		}

		.buff-icon-wrap {
			width: 36px;
			height: 36px;
		}

		.buff-icon {
			font-size: 1.15rem;
		}

		.buff-label {
			font-size: 0.6rem;
		}

		.buff-time {
			font-size: 0.65rem;
		}
	}
</style>
