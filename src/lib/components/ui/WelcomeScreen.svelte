<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { resetWorld, world } from '$lib/game/world';
	import {
		generateAsteroids,
		generateNpcs,
		generatePuzzleNodes,
		generatePowerUps,
		resetIdCounter
	} from '$lib/game/procedural';
	import { connectToServer } from '$lib/stores/socketClient';
	import { onMount } from 'svelte';

	onMount(() => {
		// Load auth from storage
		authState.loadFromStorage();

		// Check for auth callback data in URL
		const params = new URLSearchParams(window.location.search);
		const authData = params.get('auth');
		if (authData) {
			try {
				const user = JSON.parse(decodeURIComponent(authData));
				authState.setUser(user);
				// Clean up URL
				window.history.replaceState({}, '', '/');
			} catch {
				console.error('Failed to parse auth data');
			}
		}
	});

	function loginWithDiscord(): void {
		window.location.href = '/api/auth/discord';
	}

	function logout(): void {
		authState.logout();
	}

	function startGame(): void {
		// Reset everything
		resetIdCounter();
		resetWorld();
		world.asteroids = generateAsteroids(50, world.bounds);
		world.npcs = generateNpcs(gameState.npcCount, world.bounds);
		world.puzzleNodes = generatePuzzleNodes(12);
		world.powerUps = generatePowerUps(8, world.bounds);

		gameState.reset();
		gameState.phase = 'playing';

		// Try multiplayer connection
		connectToServer();

		// Request fullscreen on mobile
		if (gameState.isMobile) {
			document.documentElement.requestFullscreen?.().catch(() => {});
		}
	}
</script>

{#if gameState.phase === 'welcome' || gameState.phase === 'gameover'}
	<div class="welcome-overlay">
		<div class="welcome-content">
			{#if gameState.phase === 'gameover'}
				<div class="gameover-badge">SIGNAL LOST</div>
				<div class="final-score">
					FINAL SCORE: <span class="score-value">{gameState.score.toLocaleString()}</span>
				</div>
			{/if}

			<h1 class="title">
				<span class="title-game">GAME</span>
			</h1>
			<div class="subtitle">BY AND FOR *SPACE DISCORD</div>

			{#if authState.isLoggedIn}
				<div class="user-info">
					{#if authState.avatarUrl}
						<img src={authState.avatarUrl} alt="avatar" class="avatar" />
					{/if}
					<span class="username">{authState.username}</span>
					<button class="logout-btn" onclick={logout}>Logout</button>
				</div>

				<button class="start-btn" onclick={startGame}>
					{gameState.phase === 'gameover' ? 'PLAY AGAIN' : 'LAUNCH'}
				</button>
			{:else}
				<p class="login-prompt">Login with Discord to play</p>
				<button class="discord-btn" onclick={loginWithDiscord}>
					<svg class="discord-icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
					</svg>
					Login with Discord
				</button>
			{/if}

			<p class="lore">
				Solo fight or collaborate to decode the stars.
				<br />
				The Kal-Toh awaits those who see beyond the chaos.
			</p>

			<div class="features">
				<div class="feature">
					<span class="feature-icon">&#9733;</span>
					<span>Destroy asteroids & NPCs</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9830;</span>
					<span>Solve the hidden Kal-Toh puzzle</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9824;</span>
					<span>Multiplayer collaboration</span>
				</div>
			</div>

			<div class="domain">*SPACE DISCORD</div>
		</div>
	</div>
{/if}

<style>
	.welcome-overlay {
		position: fixed;
		inset: 0;
		background: radial-gradient(ellipse at center, rgba(0, 10, 30, 0.92) 0%, rgba(0, 0, 10, 0.98) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 20px;
	}

	.welcome-content {
		text-align: center;
		max-width: 480px;
	}

	.gameover-badge {
		font-family: var(--hud-font, monospace);
		font-size: 0.8rem;
		color: #ff4444;
		letter-spacing: 4px;
		margin-bottom: 12px;
		text-shadow: 0 0 20px rgba(255, 68, 68, 0.5);
	}

	.final-score {
		font-family: var(--hud-font, monospace);
		font-size: 0.9rem;
		color: #8899aa;
		margin-bottom: 20px;
	}

	.score-value {
		color: #00ff88;
		font-size: 1.3rem;
		text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
	}

	.title {
		font-size: 3.5rem;
		font-weight: 900;
		margin: 0 0 4px 0;
		letter-spacing: 4px;
		line-height: 1;
	}

	.title-game {
		background: linear-gradient(135deg, #00ff88, #4488ff);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		text-shadow: none;
		filter: drop-shadow(0 0 30px rgba(0, 255, 136, 0.4));
	}

	.subtitle {
		font-family: var(--hud-font, monospace);
		font-size: 0.75rem;
		color: #6688aa;
		letter-spacing: 4px;
		margin-bottom: 24px;
	}

	.user-info {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin-bottom: 20px;
	}

	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 2px solid #4488ff;
	}

	.username {
		font-family: var(--hud-font, monospace);
		color: #00ff88;
		font-size: 0.9rem;
	}

	.logout-btn {
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		padding: 4px 10px;
		background: transparent;
		border: 1px solid #6688aa;
		color: #6688aa;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.logout-btn:hover {
		border-color: #ff4444;
		color: #ff4444;
	}

	.login-prompt {
		font-size: 0.85rem;
		color: #8899aa;
		margin-bottom: 16px;
	}

	.discord-btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 14px 32px;
		font-family: var(--hud-font, monospace);
		font-size: 1rem;
		letter-spacing: 2px;
		color: #fff;
		background: #5865F2;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 0 20px rgba(88, 101, 242, 0.3);
		margin-bottom: 24px;
	}

	.discord-btn:hover {
		transform: scale(1.05);
		box-shadow: 0 0 40px rgba(88, 101, 242, 0.5);
	}

	.discord-icon {
		width: 24px;
		height: 24px;
	}

	.lore {
		font-size: 0.85rem;
		color: #8899aa;
		line-height: 1.6;
		margin-bottom: 28px;
		font-style: italic;
	}

	.start-btn {
		display: inline-block;
		padding: 14px 48px;
		font-family: var(--hud-font, monospace);
		font-size: 1.1rem;
		letter-spacing: 4px;
		color: #000;
		background: linear-gradient(135deg, #00ff88, #44ffaa);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 0 30px rgba(0, 255, 136, 0.3);
		margin-bottom: 28px;
	}

	.start-btn:hover {
		transform: scale(1.05);
		box-shadow: 0 0 50px rgba(0, 255, 136, 0.5);
	}

	.start-btn:active {
		transform: scale(0.97);
	}

	.features {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 24px;
	}

	.feature {
		font-size: 0.75rem;
		color: #6688aa;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.feature-icon {
		color: #4488ff;
	}

	.domain {
		font-family: var(--hud-font, monospace);
		font-size: 0.6rem;
		color: #334455;
		letter-spacing: 3px;
	}

	@media (max-width: 480px) {
		.title {
			font-size: 2.4rem;
		}
		.subtitle {
			font-size: 0.7rem;
			letter-spacing: 5px;
		}
		.lore {
			font-size: 0.75rem;
		}
		.start-btn {
			padding: 12px 36px;
			font-size: 0.95rem;
		}
	}
</style>
