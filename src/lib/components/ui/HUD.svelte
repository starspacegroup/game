<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { deathReplay } from '$lib/stores/deathReplay.svelte';

	let showQuitConfirm = $state(false);

	function handleQuit(): void {
		showQuitConfirm = false;
		// Self destruct: kill the player and trigger death sequence
		gameState.health = 0;
		deathReplay.startReplay();
		gameState.multiplayerDead = true;
	}
</script>

<div class="hud">
	<!-- Top bar -->
	<div class="hud-top">
		<div class="top-left">
			<div class="score">
				<span class="label">SCORE</span>
				<span class="value">{gameState.score.toLocaleString()}</span>
			</div>
			<div class="mode-badge" class:multiplayer={gameState.mode === 'multiplayer'}>
				{#if gameState.mode === 'multiplayer'}
					<span class="mode-label">ONLINE</span>
					<span class="player-count">{gameState.playerCount}</span>
				{:else}
					SOLO
				{/if}
			</div>
		</div>

		<!-- center gap for minimap -->
		<div class="top-spacer"></div>

		<div class="top-right">
			<div class="wave">
				<span class="label">WAVE</span>
				<span class="value">{gameState.wave}</span>
			</div>
			<div class="quit-wrapper">
				<button class="quit-btn" onclick={() => showQuitConfirm = true} aria-label="Quit game">
					✕
				</button>
				{#if showQuitConfirm}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="quit-backdrop" onclick={() => showQuitConfirm = false} onkeydown={() => {}}></div>
					<div class="quit-popover">
						<p>self destruct?</p>
						<div class="quit-actions">
							<button class="quit-confirm" onclick={handleQuit}>YES</button>
							<button class="quit-cancel" onclick={() => showQuitConfirm = false}>NO</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>



	<!-- Puzzle progress (only show when some progress exists) -->
	{#if gameState.puzzleProgress > 0.01}
		<div class="puzzle-progress">
			<span class="label">PUZZLE</span>
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
		align-items: flex-start;
		padding: var(--spacing-xs, 4px) 0;
		gap: var(--spacing-xs, 4px);
	}

	.top-left,
	.top-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm, 8px);
	}

	.top-spacer {
		width: 140px;
		flex-shrink: 0;
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
		padding: 2px 6px;
		border: 1px solid #335;
		border-radius: 4px;
		font-size: var(--font-xs, 0.55rem);
		color: #8899aa;
		letter-spacing: 1px;
		white-space: nowrap;
	}

	.mode-badge.multiplayer {
		border-color: #4488ff;
		color: #4488ff;
		background: rgba(68, 136, 255, 0.1);
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
	}

	.mode-label {
		font-weight: bold;
		letter-spacing: 1px;
		font-size: var(--font-xs, 0.55rem);
	}

	.player-count {
		font-size: 0.5rem;
		color: #66aaff;
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

		.controls-hint {
			bottom: 12px;
		}
	}

	/* Quit button */
	.quit-wrapper {
		position: relative;
	}

	.quit-btn {
		width: 28px;
		height: 28px;
		background: rgba(0, 8, 24, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		color: #8899aa;
		font-size: 0.85rem;
		cursor: pointer;
		pointer-events: all;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.quit-btn:hover {
		background: rgba(255, 50, 50, 0.2);
		border-color: rgba(255, 50, 50, 0.5);
		color: #ff5555;
	}

	.quit-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
		pointer-events: all;
	}

	.quit-popover {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 6px;
		background: rgba(0, 12, 30, 0.95);
		border: 1px solid rgba(255, 50, 50, 0.4);
		border-radius: 8px;
		padding: 12px 16px;
		text-align: center;
		font-family: 'Courier New', monospace;
		z-index: 100;
		pointer-events: all;
		white-space: nowrap;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
		animation: popover-in 0.15s ease-out;
	}

	@keyframes popover-in {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.quit-popover p {
		color: #ff6666;
		font-size: 0.8rem;
		margin: 0 0 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
	}

	.quit-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.quit-confirm,
	.quit-cancel {
		padding: 8px 24px;
		border-radius: 6px;
		font-family: 'Courier New', monospace;
		font-size: 0.8rem;
		letter-spacing: 1px;
		cursor: pointer;
		border: 1px solid;
		transition: all 0.15s ease;
	}

	.quit-confirm {
		background: rgba(255, 50, 50, 0.15);
		border-color: rgba(255, 50, 50, 0.5);
		color: #ff5555;
	}

	.quit-confirm:hover {
		background: rgba(255, 50, 50, 0.3);
	}

	.quit-cancel {
		background: rgba(68, 136, 255, 0.1);
		border-color: rgba(68, 136, 255, 0.3);
		color: #6699cc;
	}

	.quit-cancel:hover {
		background: rgba(68, 136, 255, 0.2);
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
	}

</style>
