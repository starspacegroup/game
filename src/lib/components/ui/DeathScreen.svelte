<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { deathReplay } from '$lib/stores/deathReplay.svelte';
	import { sendRespawnRequest, disconnect } from '$lib/stores/socketClient';
	import { world, randomSpherePosition, getTangentFrame, SPHERE_RADIUS } from '$lib/game/world';

	let respawnCooldown = $state(3);
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;

	// Start a 3-second cooldown before allowing rejoin (multiplayer only)
	$effect(() => {
		if (gameState.multiplayerDead && gameState.mode === 'multiplayer') {
			respawnCooldown = 3;
			cooldownInterval = setInterval(() => {
				respawnCooldown--;
				if (respawnCooldown <= 0 && cooldownInterval) {
					clearInterval(cooldownInterval);
					cooldownInterval = null;
				}
			}, 1000);
		}

		return () => {
			if (cooldownInterval) {
				clearInterval(cooldownInterval);
				cooldownInterval = null;
			}
		};
	});

	function handleRejoin(): void {
		deathReplay.reset();
		sendRespawnRequest();
	}

	function handleLeave(): void {
		deathReplay.reset();
		gameState.multiplayerDead = false;
		gameState.roomStats = null;
		gameState.roomEndData = null;
		gameState.phase = 'gameover';
		disconnect();
	}

	function handleSoloContinue(): void {
		deathReplay.reset();

		// Reset score on respawn
		gameState.score = 0;

		// Respawn player at a random position on the sphere
		const spawnPos = randomSpherePosition();
		world.player.position.copy(spawnPos);
		world.player.velocity.set(0, 0, 0);
		world.player.rotation.set(0, 0, 0);
		world.player.health = world.player.maxHealth;
		world.player.shootCooldown = 0;
		world.player.damageCooldownUntil = Date.now() + 3000; // 3s invincibility

		// Re-initialize playerUp from the tangent frame at the new spawn
		const { north } = getTangentFrame(spawnPos);
		world.playerUp.copy(north);

		// Restore UI health and clear death flag
		gameState.health = world.player.maxHealth;
		gameState.shieldHealth = 0;
		gameState.multiplayerDead = false;
	}

	function handleSoloLeave(): void {
		deathReplay.reset();
		gameState.multiplayerDead = false;
		// Clear active buffs/effects before returning to menu
		gameState.activeBuffs = [];
		gameState.shieldHealth = 0;
		gameState.pickupNotifications = [];
		gameState.phase = 'gameover';
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return m > 0 ? `${m}m ${s}s` : `${s}s`;
	}

	function formatEventTime(timestamp: number, startTime: number): string {
		const elapsed = Math.max(0, Math.round((timestamp - startTime) / 1000));
		const m = Math.floor(elapsed / 60);
		const s = elapsed % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	const EVENT_ICONS: Record<string, string> = {
		'player-joined': '▸',
		'player-left': '◂',
		'player-died': '✕',
		'npc-converted': '◈',
		'power-up': '◆',
		'puzzle-progress': '⬡',
		'wave-advance': '⚑',
		'all-eliminated': '☠',
		'room-ended': '■'
	};

	const EVENT_COLORS: Record<string, string> = {
		'player-joined': '#00ff88',
		'player-left': '#886644',
		'player-died': '#ff4444',
		'npc-converted': '#44ccff',
		'power-up': '#ffdd00',
		'puzzle-progress': '#aa88ff',
		'wave-advance': '#ff8800',
		'all-eliminated': '#ff2222',
		'room-ended': '#666688'
	};

	const stats = $derived(gameState.roomStats);
	const endData = $derived(gameState.roomEndData);
	const canRejoin = $derived(stats?.canRejoin ?? false);
	const isSolo = $derived(gameState.mode === 'solo');
	const isRoomEnded = $derived(!!endData);
	// Use replay-driven opacity: starts at 0 during replay, fades to 1
	const overlayOpacity = $derived(deathReplay.active ? deathReplay.overlayOpacity : 1);
	// Show content only after the overlay is mostly visible
	const contentVisible = $derived(overlayOpacity > 0.6);
	// Compute event log start time for relative timestamps
	const logStartTime = $derived(
		endData?.eventLog?.length ? endData.eventLog[0].time : 0
	);
</script>

{#if gameState.multiplayerDead && gameState.phase === 'playing'}
	<div class="death-overlay" style="opacity: {overlayOpacity}; pointer-events: {contentVisible ? 'auto' : 'none'};">
		{#if contentVisible}
			<div class="death-content" class:fade-in={contentVisible}>

				{#if isRoomEnded && endData}
					<!-- ============================================ -->
					<!-- ROOM ENDED: spectacular all-crew-down display -->
					<!-- ============================================ -->
					<div class="end-badge">MISSION FAILED</div>
					<div class="end-subtitle">ALL CREW ELIMINATED</div>

					<!-- Summary stats -->
					<div class="end-summary">
						<div class="end-stat">
							<span class="end-stat-label">DURATION</span>
							<span class="end-stat-value">{formatDuration(endData.duration)}</span>
						</div>
						<div class="end-stat">
							<span class="end-stat-label">FINAL WAVE</span>
							<span class="end-stat-value">{endData.finalWave}</span>
						</div>
						<div class="end-stat">
							<span class="end-stat-label">PUZZLE</span>
							<span class="end-stat-value">{Math.round(endData.finalPuzzleProgress)}%</span>
						</div>
					</div>

					<!-- Player final scores -->
					<div class="end-scoreboard">
						<div class="end-section-title">FINAL SCORES</div>
						{#each endData.players.sort((a, b) => b.score - a.score) as player, i (player.id)}
							<div class="end-player-row">
								<span class="end-rank">#{i + 1}</span>
								<span class="end-player-name">{player.username}</span>
								<span class="end-player-score">{player.score.toLocaleString()}</span>
							</div>
						{/each}
					</div>

					<!-- Event Log -->
					{#if endData.eventLog.length > 0}
						<div class="event-log-panel">
							<div class="end-section-title">MISSION LOG</div>
							<div class="event-log-scroll">
								{#each endData.eventLog as event, i}
									<div class="event-row" style="animation-delay: {i * 40}ms;">
										<span class="event-time">{formatEventTime(event.time, logStartTime)}</span>
										<span class="event-icon" style="color: {EVENT_COLORS[event.event] || '#556677'}">
											{EVENT_ICONS[event.event] || '·'}
										</span>
										<span class="event-detail">
											{#if event.actor}
												<span class="event-actor">{event.actor}</span>
											{/if}
											{event.detail || event.event}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Leave button -->
					<div class="actions">
						<button class="action-btn leave-btn end-leave-btn" onclick={handleLeave}>
							LEAVE ROOM
						</button>
					</div>

				{:else}
					<!-- ======================================== -->
					<!-- Individual death: still alive teammates   -->
					<!-- ======================================== -->
					<div class="death-badge">SIGNAL LOST</div>
					<div class="death-subtitle">Your ship has been destroyed</div>

					<div class="your-score">
						YOUR SCORE: <span class="score-value">{gameState.score.toLocaleString()}</span>
					</div>

					{#if isSolo}
						<div class="death-penalty">Score penalty: −50%</div>
						<div class="actions">
							<button class="action-btn rejoin-btn" onclick={handleSoloContinue}>
							RESTART
							</button>
							<button class="action-btn leave-btn" onclick={handleSoloLeave}>
								QUIT TO MENU
							</button>
						</div>
					{:else}
						{#if stats}
							<div class="stats-panel">
								<div class="stats-header">ROOM STATUS</div>

								<div class="stats-grid">
									<div class="stat-box">
										<span class="stat-label">ALIVE</span>
										<span class="stat-value alive">{stats.aliveCount} / {stats.playerCount}</span>
									</div>
									<div class="stat-box">
										<span class="stat-label">WAVE</span>
										<span class="stat-value">{stats.wave}</span>
									</div>
									<div class="stat-box">
										<span class="stat-label">PUZZLE</span>
										<span class="stat-value">{Math.round(stats.puzzleProgress * 100)}%</span>
									</div>
								</div>

								<div class="player-list">
									<div class="player-list-header">CREW</div>
									{#each stats.players as player (player.id)}
										<div class="player-row" class:dead={player.health <= 0}>
											<span class="player-status">{player.health > 0 ? '●' : '✕'}</span>
											<span class="player-name">{player.username}</span>
											<span class="player-score">{player.score.toLocaleString()}</span>
											{#if player.health > 0}
												<span class="player-hp">{player.health}/{player.maxHealth} HP</span>
											{:else}
												<span class="player-hp dead-text">DOWN</span>
											{/if}
										</div>
									{/each}
								</div>
							</div>

							<div class="actions">
								{#if stats?.roomClosed}
									<div class="no-rejoin">Room closed — all crew eliminated</div>
								{:else if canRejoin}
									<button
										class="action-btn rejoin-btn"
										onclick={handleRejoin}
										disabled={respawnCooldown > 0}
									>
										{#if respawnCooldown > 0}
											REJOIN IN {respawnCooldown}...
										{:else}
											REJOIN GAME
										{/if}
									</button>
								{:else}
									<div class="no-rejoin">No surviving crew — room closing...</div>
								{/if}

								<button class="action-btn leave-btn" onclick={handleLeave}>
									LEAVE ROOM
								</button>
							</div>
						{:else}
							<div class="loading-stats">Loading room status...</div>
							<div class="actions">
								<button class="action-btn leave-btn" onclick={handleLeave}>
									LEAVE ROOM
								</button>
							</div>
						{/if}
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.death-overlay {
		position: fixed;
		inset: 0;
		background: radial-gradient(ellipse at center, rgba(20, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.95) 100%);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		z-index: 90;
		padding: 16px;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
		/* pointer-events controlled via inline style based on contentVisible */
	}

	.death-content {
		text-align: center;
		max-width: 420px;
		width: 100%;
		opacity: 0;
		transform: translateY(8px);
		margin: auto 0;
	}

	.death-content.fade-in {
		animation: contentFadeIn 0.8s ease-out forwards;
	}

	@keyframes contentFadeIn {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.death-badge {
		font-family: var(--hud-font, monospace);
		font-size: 1.6rem;
		color: #ff4444;
		letter-spacing: 6px;
		margin-bottom: 6px;
		text-shadow: 0 0 30px rgba(255, 68, 68, 0.6), 0 0 60px rgba(255, 0, 0, 0.3);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}

	.death-subtitle {
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		color: #776666;
		letter-spacing: 2px;
		margin-bottom: 20px;
	}

	.your-score {
		font-family: var(--hud-font, monospace);
		font-size: 0.85rem;
		color: #8899aa;
		margin-bottom: 20px;
	}

	.score-value {
		color: #00ff88;
		font-size: 1.1rem;
		text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
	}

	.death-penalty {
		font-family: var(--hud-font, monospace);
		font-size: 0.65rem;
		color: #ff8844;
		letter-spacing: 1px;
		margin-bottom: 16px;
		opacity: 0.8;
	}

	/* Stats panel */
	.stats-panel {
		background: rgba(0, 20, 40, 0.6);
		border: 1px solid rgba(0, 180, 255, 0.15);
		border-radius: 8px;
		padding: 16px;
		margin-bottom: 20px;
	}

	.stats-header {
		font-family: var(--hud-font, monospace);
		font-size: 0.65rem;
		color: #0088cc;
		letter-spacing: 3px;
		margin-bottom: 12px;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-bottom: 14px;
	}

	.stat-box {
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		padding: 8px 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-label {
		font-family: var(--hud-font, monospace);
		font-size: 0.55rem;
		color: #556677;
		letter-spacing: 1px;
	}

	.stat-value {
		font-family: var(--hud-font, monospace);
		font-size: 0.9rem;
		color: #ddeeff;
	}

	.stat-value.alive {
		color: #00ff88;
	}

	/* Player list */
	.player-list {
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		padding-top: 10px;
	}

	.player-list-header {
		font-family: var(--hud-font, monospace);
		font-size: 0.55rem;
		color: #556677;
		letter-spacing: 2px;
		margin-bottom: 8px;
		text-align: left;
	}

	.player-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 3px;
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		transition: opacity 0.3s;
	}

	.player-row.dead {
		opacity: 0.45;
	}

	.player-status {
		font-size: 0.6rem;
		width: 14px;
		text-align: center;
	}

	.player-row:not(.dead) .player-status {
		color: #00ff88;
	}

	.player-row.dead .player-status {
		color: #ff4444;
	}

	.player-name {
		color: #aabbcc;
		flex: 1;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.player-score {
		color: #00ff88;
		min-width: 50px;
		text-align: right;
	}

	.player-hp {
		color: #88aacc;
		min-width: 60px;
		text-align: right;
		font-size: 0.6rem;
	}

	.dead-text {
		color: #ff4444;
	}

	/* Loading */
	.loading-stats {
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		color: #556677;
		margin-bottom: 20px;
		animation: pulse 1.5s ease-in-out infinite;
	}

	/* Actions */
	.actions {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
	}

	.action-btn {
		font-family: var(--hud-font, monospace);
		font-size: 0.8rem;
		letter-spacing: 2px;
		padding: 12px 32px;
		border: 1px solid;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		width: 100%;
		max-width: 280px;
	}

	.rejoin-btn {
		background: rgba(0, 255, 136, 0.1);
		border-color: rgba(0, 255, 136, 0.4);
		color: #00ff88;
	}

	.rejoin-btn:hover:not(:disabled) {
		background: rgba(0, 255, 136, 0.2);
		box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
	}

	.rejoin-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.leave-btn {
		background: rgba(255, 68, 68, 0.05);
		border-color: rgba(255, 68, 68, 0.2);
		color: #aa5555;
		font-size: 0.65rem;
	}

	.leave-btn:hover {
		background: rgba(255, 68, 68, 0.12);
		color: #ff4444;
	}

	.no-rejoin {
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		color: #ff6644;
		letter-spacing: 1px;
		margin-bottom: 6px;
		animation: pulse 1.5s ease-in-out infinite;
	}

	/* ============================================ */
	/* Room-ended spectacle styles                  */
	/* ============================================ */

	.end-badge {
		font-family: var(--hud-font, monospace);
		font-size: 2rem;
		color: #ff2222;
		letter-spacing: 8px;
		margin-bottom: 4px;
		text-shadow: 0 0 40px rgba(255, 34, 34, 0.8), 0 0 80px rgba(255, 0, 0, 0.4), 0 0 120px rgba(255, 0, 0, 0.2);
		animation: endBadgePulse 3s ease-in-out infinite;
	}

	@keyframes endBadgePulse {
		0%, 100% { opacity: 1; text-shadow: 0 0 40px rgba(255, 34, 34, 0.8), 0 0 80px rgba(255, 0, 0, 0.4); }
		50% { opacity: 0.8; text-shadow: 0 0 20px rgba(255, 34, 34, 0.5), 0 0 40px rgba(255, 0, 0, 0.2); }
	}

	.end-subtitle {
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		color: #993333;
		letter-spacing: 4px;
		margin-bottom: 24px;
	}

	.end-summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		margin-bottom: 20px;
	}

	.end-stat {
		background: rgba(255, 0, 0, 0.05);
		border: 1px solid rgba(255, 68, 68, 0.12);
		border-radius: 6px;
		padding: 10px 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.end-stat-label {
		font-family: var(--hud-font, monospace);
		font-size: 0.5rem;
		color: #776655;
		letter-spacing: 2px;
	}

	.end-stat-value {
		font-family: var(--hud-font, monospace);
		font-size: 1.1rem;
		color: #ffaa88;
		text-shadow: 0 0 8px rgba(255, 170, 136, 0.3);
	}

	.end-section-title {
		font-family: var(--hud-font, monospace);
		font-size: 0.55rem;
		color: #665544;
		letter-spacing: 3px;
		margin-bottom: 10px;
		text-align: left;
	}

	/* Scoreboard */
	.end-scoreboard {
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 14px;
		margin-bottom: 16px;
	}

	.end-player-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 5px 4px;
		font-family: var(--hud-font, monospace);
		font-size: 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	.end-player-row:last-child {
		border-bottom: none;
	}

	.end-rank {
		color: #776655;
		min-width: 24px;
		font-size: 0.65rem;
	}

	.end-player-name {
		color: #bbaa99;
		flex: 1;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.end-player-score {
		color: #ffaa44;
		text-shadow: 0 0 8px rgba(255, 170, 68, 0.3);
		min-width: 60px;
		text-align: right;
	}

	/* Event log */
	.event-log-panel {
		background: rgba(0, 10, 20, 0.5);
		border: 1px solid rgba(0, 180, 255, 0.08);
		border-radius: 8px;
		padding: 14px;
		margin-bottom: 20px;
	}

	.event-log-scroll {
		max-height: 200px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
	}

	.event-log-scroll::-webkit-scrollbar {
		width: 4px;
	}

	.event-log-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.event-log-scroll::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
	}

	.event-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 3px 0;
		font-family: var(--hud-font, monospace);
		font-size: 0.6rem;
		opacity: 0;
		animation: eventFadeIn 0.3s ease-out forwards;
	}

	@keyframes eventFadeIn {
		from { opacity: 0; transform: translateX(-8px); }
		to { opacity: 1; transform: translateX(0); }
	}

	.event-time {
		color: #445566;
		min-width: 36px;
		text-align: right;
		flex-shrink: 0;
	}

	.event-icon {
		flex-shrink: 0;
		width: 12px;
		text-align: center;
	}

	.event-detail {
		color: #7788aa;
		text-align: left;
		line-height: 1.4;
	}

	.event-actor {
		color: #aabbcc;
		font-weight: 600;
		margin-right: 4px;
	}

	.end-leave-btn {
		margin-top: 4px;
		background: rgba(255, 255, 255, 0.04);
		border-color: rgba(255, 255, 255, 0.15);
		color: #8899aa;
		font-size: 0.75rem;
	}

	.end-leave-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #bbccdd;
	}
</style>
