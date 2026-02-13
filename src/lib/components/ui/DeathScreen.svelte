<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { sendRespawnRequest, disconnect } from '$lib/stores/socketClient';

	let respawnCooldown = $state(3);
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;

	// Start a 3-second cooldown before allowing rejoin
	$effect(() => {
		if (gameState.multiplayerDead) {
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
		sendRespawnRequest();
	}

	function handleLeave(): void {
		gameState.multiplayerDead = false;
		gameState.roomStats = null;
		gameState.phase = 'gameover';
		disconnect();
	}

	const stats = $derived(gameState.roomStats);
	const canRejoin = $derived(stats?.canRejoin ?? false);
</script>

{#if gameState.multiplayerDead && gameState.phase === 'playing'}
	<div class="death-overlay">
		<div class="death-content">
			<!-- Death badge -->
			<div class="death-badge">SIGNAL LOST</div>
			<div class="death-subtitle">Your ship has been destroyed</div>

			<!-- Your score -->
			<div class="your-score">
				YOUR SCORE: <span class="score-value">{gameState.score.toLocaleString()}</span>
			</div>

			<!-- Real-time room stats -->
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

					<!-- Player list -->
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

				<!-- Action buttons -->
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
		</div>
	</div>
{/if}

<style>
	.death-overlay {
		position: fixed;
		inset: 0;
		background: radial-gradient(ellipse at center, rgba(20, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.95) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 90;
		padding: 16px;
		overflow-y: auto;
		animation: fadeIn 0.5s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.death-content {
		text-align: center;
		max-width: 420px;
		width: 100%;
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
</style>
