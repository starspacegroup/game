<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { world } from '$lib/game/world';

	let showQuitConfirm = $state(false);

	function handleQuit(): void {
		showQuitConfirm = false;
		// Self destruct: set health to 0 on both UI state and world object
		// so checkGameOver captures the score on the next game loop frame
		gameState.health = 0;
		world.player.health = 0;
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
			{#if gameState.fragmentCount > 0}
				<span class="fragment-count">◈ {gameState.fragmentCount}/12</span>
			{/if}
		</div>
	{/if}

	<!-- Latest hint display -->
	{#if gameState.latestHint}
		<div class="hint-display">
			<span class="hint-tag">⟁ DATA</span>
			<span class="hint-text">{gameState.latestHint}</span>
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

	.fragment-count {
		font-size: var(--font-xs, 0.6rem);
		color: #4488ff;
		letter-spacing: 1px;
		text-shadow: 0 0 6px rgba(68, 136, 255, 0.4);
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
		width: 40px;
		height: 40px;
		background: rgba(0, 8, 24, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		color: #8899aa;
		font-size: 1rem;
		cursor: pointer;
		pointer-events: all;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
		flex-shrink: 0;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
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
		padding: 10px 28px;
		border-radius: 6px;
		font-family: 'Courier New', monospace;
		font-size: 0.85rem;
		letter-spacing: 1px;
		cursor: pointer;
		border: 1px solid;
		transition: all 0.15s ease;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
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

	/* Hint display — compact top banner, mobile-first */
	.hint-display {
		position: fixed;
		top: calc(var(--safe-top, 0px) + 44px);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 16, 32, 0.75);
		border: 1px solid rgba(0, 255, 204, 0.3);
		border-radius: 6px;
		padding: 3px 10px;
		max-width: min(88vw, 360px);
		width: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		animation: hint-slide-in 0.25s ease-out;
		backdrop-filter: blur(4px);
		white-space: nowrap;
		overflow: hidden;
		pointer-events: none;
		opacity: 0.85;
	}

	@keyframes hint-slide-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-8px);
		}
		to {
			opacity: 0.85;
			transform: translateX(-50%) translateY(0);
		}
	}

	.hint-tag {
		color: #00ffcc;
		font-size: 0.5rem;
		letter-spacing: 1px;
		flex-shrink: 0;
		animation: pulse-hint 1.5s ease-in-out infinite;
	}

	@keyframes pulse-hint {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.hint-text {
		color: #aaddff;
		font-size: 0.55rem;
		line-height: 1.2;
		text-shadow: 0 0 4px rgba(170, 221, 255, 0.3);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (min-width: 768px) {
		.hint-display {
			top: calc(var(--safe-top, 0px) + 52px);
			max-width: 420px;
			padding: 4px 14px;
			opacity: 0.9;
		}

		.hint-tag {
			font-size: 0.55rem;
		}

		.hint-text {
			font-size: 0.65rem;
		}
	}

</style>
