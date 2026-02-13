<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { resetWorld, world } from '$lib/game/world';
	import { deathReplay } from '$lib/stores/deathReplay.svelte';
	import {
		generateAsteroids,
		generateNpcs,
		generatePuzzleNodes,
		generatePowerUps,
		resetIdCounter
	} from '$lib/game/procedural';
	import { connectToServer, disconnect } from '$lib/stores/socketClient';
	import { connectLobby, disconnectLobby, lobbyState, type LobbyRoomInfo } from '$lib/stores/lobbyClient.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let creatingRoom = $state(false);


	let deletingRoomId = $state<string | null>(null);

	onMount(async () => {
		// Check for auth callback data in URL (fresh login)
		const params = new URLSearchParams(window.location.search);
		const authData = params.get('auth');
		if (authData) {
			try {
				const user = JSON.parse(decodeURIComponent(authData));
				authState.setUser(user);
				window.history.replaceState({}, '', '/');
			} catch {
				console.error('Failed to parse auth data');
			}
		}

		// If not logged in yet, try server session (from layout data)
		if (!authState.isLoggedIn) {
			const serverUser = $page.data.user;
			if (serverUser) {
				authState.setUser({
					id: serverUser.id,
					username: serverUser.username,
					avatar: serverUser.avatar,
					accessToken: '' // token stays server-side in cookie
				});
			}
		}

		// If still not logged in, try localStorage
		if (!authState.isLoggedIn) {
			authState.loadFromStorage();
		}

		// Final fallback: ask the server directly (covers edge cases
		// where cookie exists but layout data wasn't hydrated)
		if (!authState.isLoggedIn) {
			try {
				const res = await fetch('/api/auth/me');
				const data = await res.json() as { user?: { id: string; username: string; avatar: string | null } | null };
				if (data.user) {
					authState.setUser({
						id: data.user.id,
						username: data.user.username,
						avatar: data.user.avatar,
						accessToken: ''
					});
				}
			} catch {
				// Server unreachable — stay logged out
			}
		}

		// Fetch available multiplayer rooms
		connectLobby();
	});

	// Connect/disconnect lobby WebSocket based on screen visibility
	$effect(() => {
		const phase = gameState.phase;
		if (phase === 'welcome' || phase === 'gameover') {
			connectLobby();
		} else {
			disconnectLobby();
		}
	});

	async function createMultiplayerRoom(): Promise<void> {
		creatingRoom = true;
		try {
			const response = await fetch('/api/game/rooms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: `${authState.username}'s Game`,
					createdBy: authState.username || 'Anonymous'
				})
			});
			const data = await response.json() as { success?: boolean; room?: LobbyRoomInfo };
			if (data.success && data.room) {
				startGame('multiplayer', data.room.id);
			}
		} catch {
			console.error('Failed to create room');
		} finally {
			creatingRoom = false;
		}
	}

	function loginWithDiscord(): void {
		window.location.href = '/api/auth/discord';
	}

	async function logout(): Promise<void> {
		authState.logout();
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} catch {
			// Cookie clear is best-effort
		}
	}

	function startGame(mode: 'solo' | 'multiplayer' = 'solo', roomId?: string): void {
		// Disconnect any existing multiplayer connection before resetting
		disconnect();

		// Reset everything
		resetIdCounter();
		resetWorld();
		deathReplay.fullReset();

		// Only generate world locally for solo mode
		// For multiplayer, server will send full world state
				if (mode === 'solo') {
			// Spawn enough entities to feel populated across the sphere
			world.asteroids = generateAsteroids(400);
			world.npcs = generateNpcs(gameState.npcCount);
			world.puzzleNodes = generatePuzzleNodes(12);
			world.powerUps = generatePowerUps(80);
			gameState.mode = 'solo';
		}

		gameState.reset();
		gameState.phase = 'playing';

		// Connect to multiplayer if requested
		if (mode === 'multiplayer') {
			connectToServer(roomId || 'default');
		}

		// Request fullscreen on mobile
		if (gameState.isMobile) {
			document.documentElement.requestFullscreen?.().catch(() => {});
		}
	}

	async function deleteRoom(roomId: string): Promise<void> {
		if (!confirm('Delete this room? All players will be disconnected.')) return;

		deletingRoomId = roomId;
		try {
			const response = await fetch('/api/game/rooms', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roomId,
					userId: authState.userId
				})
			});
			const data = await response.json() as { success?: boolean; error?: string };
			if (!data.success) {
				console.error('Failed to delete room:', data.error);
			}
		} catch {
			console.error('Failed to delete room');
		} finally {
			deletingRoomId = null;
		}
	}

	function joinRoom(roomId: string): void {
		startGame('multiplayer', roomId);
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

			<div class="org-line">
				<img src="/logo.png" alt="*Space logo" class="org-logo" />
				<span class="org-name">*SPACE</span>
			</div>
			<h1 class="title">
				<span class="title-game">GAME</span>
			</h1>

			{#if authState.isLoggedIn}
				<div class="user-info">
					{#if authState.avatarUrl}
						<img src={authState.avatarUrl} alt="avatar" class="avatar" />
					{/if}
					<span class="username">{authState.username}</span>
					<button class="logout-btn" onclick={logout}>Logout</button>
				</div>

				<div class="game-modes">
					<button class="start-btn solo-btn" onclick={() => startGame('solo')}>
						{gameState.phase === 'gameover' ? 'SOLO AGAIN' : 'SOLO GAME'}
					</button>

					<button class="start-btn multiplayer-btn" onclick={createMultiplayerRoom} disabled={creatingRoom}>
						{creatingRoom ? 'CREATING...' : 'CREATE MULTIPLAYER'}
					</button>
				</div>



				<div class="rooms-section">
						<h3 class="rooms-header"><span class="live-dot" class:connected={lobbyState.connected}></span> ACTIVE GAMES</h3>
						{#if lobbyState.rooms.length > 0}
							<div class="rooms-list">
								{#each lobbyState.rooms as room (room.id)}
									<div class="room-row">
										<button class="room-btn" onclick={() => joinRoom(room.id)}>
											<span class="room-name">{room.name}</span>
											<span class="room-info">
												<span class="room-players">{room.playerCount} player{room.playerCount !== 1 ? 's' : ''}</span>
												{#if room.wave && room.wave > 1}
													<span class="room-wave">Wave {room.wave}</span>
												{/if}
											</span>
										</button>
										{#if authState.isSuperAdmin}
											<button
												class="room-delete-btn"
												onclick={() => deleteRoom(room.id)}
												disabled={deletingRoomId === room.id}
												title="Delete room (admin)"
											>
												{deletingRoomId === room.id ? '...' : 'X'}
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{:else if !lobbyState.connected}
							<div class="rooms-loading">Connecting...</div>
						{:else}
							<div class="rooms-empty">No active games — create one!</div>
						{/if}
					</div>
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
				Navigate the sphere. Convert the hostile. Decode the hidden pattern.
				<br />
				Alone or together — the puzzle awaits.
			</p>

			<div class="features">
				<div class="feature">
					<span class="feature-icon">&#9733;</span>
					<span>Convert hostile ships into allied satellites</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9830;</span>
					<span>Solve the hidden puzzle — align nodes into a perfect structure</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9824;</span>
					<span>Collect power-ups: shields, speed boost, multi-shot</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9679;</span>
					<span>Explore a seamless sphere world</span>
				</div>
				<div class="feature">
					<span class="feature-icon">&#9672;</span>
					<span>Collaborate in real-time multiplayer</span>
				</div>
			</div>

			<div class="footer">
				<a href="https://starspace.group" target="_blank" rel="noopener noreferrer" class="footer-link">starspace.group</a>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ===== MOBILE-FIRST WELCOME SCREEN STYLES ===== */
	.welcome-overlay {
		position: fixed;
		inset: 0;
		background: radial-gradient(ellipse at center, rgba(0, 10, 30, 0.92) 0%, rgba(0, 0, 10, 0.98) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		/* Mobile-first padding with safe areas */
		padding: calc(var(--safe-top, 0px) + 16px) calc(var(--safe-right, 0px) + 16px) calc(var(--safe-bottom, 0px) + 16px) calc(var(--safe-left, 0px) + 16px);
		overflow-y: auto;
	}

	.welcome-content {
		text-align: center;
		max-width: 100%;
		width: 100%;
		/* Ensure content doesn't touch edges on small screens */
		padding: 0 var(--spacing-sm, 8px);
	}

	.gameover-badge {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-sm, 0.7rem);
		color: #ff4444;
		letter-spacing: 3px;
		margin-bottom: var(--spacing-sm, 8px);
		text-shadow: 0 0 20px rgba(255, 68, 68, 0.5);
	}

	.final-score {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-md, 0.85rem);
		color: #8899aa;
		margin-bottom: var(--spacing-md, 12px);
	}

	.score-value {
		color: #00ff88;
		font-size: var(--font-lg, 1rem);
		text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
	}

	/* Mobile-first title sizing */
	.title {
		font-size: var(--font-2xl, 1.6rem);
		font-weight: 900;
		margin: 0 0 var(--spacing-lg, 16px) 0;
		letter-spacing: 3px;
		line-height: 1;
	}

	.title-game {
		background: linear-gradient(135deg, #00ff88, #4488ff);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		text-shadow: none;
		filter: drop-shadow(0 0 20px rgba(0, 255, 136, 0.4));
	}

	.org-line {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-bottom: 4px;
	}

	.org-logo {
		width: 20px;
		height: 20px;
		object-fit: contain;
		filter: drop-shadow(0 0 6px rgba(68, 136, 255, 0.4));
	}

	.org-name {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		color: #6688aa;
		letter-spacing: 3px;
	}

	.user-info {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm, 8px);
		margin-bottom: var(--spacing-md, 12px);
		flex-wrap: wrap;
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid #4488ff;
	}

	.username {
		font-family: var(--hud-font, monospace);
		color: #00ff88;
		font-size: var(--font-md, 0.85rem);
	}

	.logout-btn {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		/* Ensure minimum touch target */
		min-height: var(--touch-target-min, 44px);
		min-width: var(--touch-target-min, 44px);
		padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
		background: transparent;
		border: 1px solid #6688aa;
		color: #6688aa;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		-webkit-tap-highlight-color: transparent;
	}

	.logout-btn:hover,
	.logout-btn:active {
		border-color: #ff4444;
		color: #ff4444;
	}

	.login-prompt {
		font-size: var(--font-md, 0.85rem);
		color: #8899aa;
		margin-bottom: var(--spacing-md, 12px);
	}

	/* Discord button - touch-friendly */
	.discord-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm, 8px);
		/* Touch-friendly sizing */
		min-height: var(--touch-target-comfortable, 48px);
		padding: var(--spacing-sm, 8px) var(--spacing-lg, 16px);
		font-family: var(--hud-font, monospace);
		font-size: var(--font-md, 0.85rem);
		letter-spacing: 1px;
		color: #fff;
		background: #5865F2;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 0 20px rgba(88, 101, 242, 0.3);
		margin-bottom: var(--spacing-lg, 16px);
		-webkit-tap-highlight-color: transparent;
		width: 100%;
		max-width: 280px;
	}

	.discord-btn:hover,
	.discord-btn:active {
		transform: scale(1.02);
		box-shadow: 0 0 30px rgba(88, 101, 242, 0.5);
	}

	.discord-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.lore {
		font-size: var(--font-sm, 0.7rem);
		color: #8899aa;
		line-height: 1.5;
		margin-bottom: var(--spacing-lg, 16px);
		font-style: italic;
		padding: 0 var(--spacing-sm, 8px);
	}

	/* Start button - touch-friendly */
	.start-btn {
		display: inline-block;
		min-height: var(--touch-target-comfortable, 48px);
		padding: var(--spacing-sm, 8px) var(--spacing-xl, 24px);
		font-family: var(--hud-font, monospace);
		font-size: var(--font-lg, 1rem);
		letter-spacing: 3px;
		color: #000;
		background: linear-gradient(135deg, #00ff88, #44ffaa);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 0 25px rgba(0, 255, 136, 0.3);
		margin-bottom: var(--spacing-sm, 8px);
		-webkit-tap-highlight-color: transparent;
		width: 100%;
		max-width: 280px;
	}

	.start-btn:hover,
	.start-btn:active {
		transform: scale(1.02);
		box-shadow: 0 0 40px rgba(0, 255, 136, 0.5);
	}

	.start-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	/* Game modes container */
	.game-modes {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm, 8px);
		margin-bottom: var(--spacing-md, 12px);
	}

	.solo-btn {
		background: linear-gradient(135deg, #00ff88, #44ffaa);
	}

	.multiplayer-btn {
		background: linear-gradient(135deg, #4488ff, #66aaff);
		box-shadow: 0 0 25px rgba(68, 136, 255, 0.3);
	}

	.multiplayer-btn:hover,
	.multiplayer-btn:active {
		box-shadow: 0 0 40px rgba(68, 136, 255, 0.5);
	}



	/* Rooms section */
	.rooms-section {
		width: 100%;
		max-width: 320px;
		margin: 0 auto var(--spacing-lg, 16px);
	}

	.rooms-header {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		color: #6688aa;
		letter-spacing: 2px;
		margin: 0 0 var(--spacing-sm, 8px) 0;
		text-align: center;
	}

	.rooms-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs, 4px);
	}

	.room-row {
		display: flex;
		gap: var(--spacing-xs, 4px);
		align-items: stretch;
	}

	.room-row .room-btn {
		flex: 1;
	}

	.room-delete-btn {
		min-width: var(--touch-target-min, 44px);
		min-height: var(--touch-target-min, 44px);
		padding: var(--spacing-sm, 8px);
		font-family: var(--hud-font, monospace);
		font-size: var(--font-sm, 0.7rem);
		font-weight: bold;
		color: #ff4444;
		background: rgba(255, 68, 68, 0.1);
		border: 1px solid rgba(255, 68, 68, 0.3);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		-webkit-tap-highlight-color: transparent;
	}

	.room-delete-btn:hover:not(:disabled) {
		background: rgba(255, 68, 68, 0.25);
		border-color: rgba(255, 68, 68, 0.6);
	}

	.room-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.room-btn {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: var(--touch-target-min, 44px);
		padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
		font-family: var(--hud-font, monospace);
		font-size: var(--font-sm, 0.7rem);
		background: rgba(68, 136, 255, 0.1);
		border: 1px solid rgba(68, 136, 255, 0.3);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		-webkit-tap-highlight-color: transparent;
		text-align: left;
	}

	.room-btn:hover,
	.room-btn:active {
		background: rgba(68, 136, 255, 0.2);
		border-color: rgba(68, 136, 255, 0.6);
		transform: scale(1.01);
	}

	.room-name {
		color: #00ff88;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.room-info {
		display: flex;
		gap: var(--spacing-sm, 8px);
		color: #6688aa;
		font-size: var(--font-xs, 0.6rem);
	}

	.room-players {
		color: #4488ff;
	}

	.room-wave {
		color: #ff8844;
	}

	.rooms-loading,
	.rooms-empty {
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		color: #6688aa;
		text-align: center;
		padding: var(--spacing-sm, 8px) 0;
	}

	.live-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		background: #666;
		border-radius: 50%;
		margin-right: 4px;
		vertical-align: middle;
		transition: background 0.3s, box-shadow 0.3s;
	}

	.live-dot.connected {
		background: #00ff88;
		box-shadow: 0 0 6px rgba(0, 255, 136, 0.6);
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.features {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm, 8px);
		margin-bottom: var(--spacing-lg, 16px);
	}

	.feature {
		font-size: var(--font-xs, 0.6rem);
		color: #6688aa;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm, 8px);
	}

	.feature-icon {
		color: #4488ff;
	}

	.footer {
		margin-top: var(--spacing-lg, 16px);
	}

	.footer-link {
		font-family: var(--hud-font, monospace);
		font-size: 0.5rem;
		color: #334455;
		letter-spacing: 2px;
		text-decoration: none;
		transition: color 0.2s;
	}

	.footer-link:hover {
		color: #6688aa;
	}

	/* ===== LARGER PHONES (375px+) ===== */
	@media (min-width: 375px) {
		.title {
			font-size: 2rem;
			letter-spacing: 3px;
		}

		.org-name {
			letter-spacing: 4px;
		}

		.discord-btn,
		.start-btn {
			max-width: 300px;
		}
	}

	/* ===== MEDIUM SCREENS (480px+) ===== */
	@media (min-width: 480px) {
		.welcome-overlay {
			padding: 20px;
		}

		.welcome-content {
			max-width: 420px;
		}

		.title {
			font-size: 2.5rem;
		}

		.gameover-badge {
			font-size: 0.8rem;
			letter-spacing: 4px;
		}

		.score-value {
			font-size: 1.2rem;
		}

		.org-name {
			font-size: 0.7rem;
			letter-spacing: 5px;
		}

		.org-logo {
			width: 24px;
			height: 24px;
		}

		.avatar {
			width: 40px;
			height: 40px;
		}

		.discord-btn {
			padding: 12px 24px;
			font-size: 0.95rem;
			letter-spacing: 2px;
			max-width: 320px;
		}

		.discord-icon {
			width: 24px;
			height: 24px;
		}

		.start-btn {
			padding: 12px 40px;
			font-size: 1.05rem;
			letter-spacing: 4px;
			max-width: 320px;
		}

		.lore {
			font-size: 0.8rem;
		}

		.feature {
			font-size: 0.7rem;
		}
	}

	/* ===== TABLETS AND UP (768px+) ===== */
	@media (min-width: 768px) {
		.welcome-content {
			max-width: 480px;
		}

		.title {
			font-size: 3.5rem;
			letter-spacing: 4px;
		}

		.org-name {
			font-size: 0.75rem;
			letter-spacing: 4px;
		}

		.org-logo {
			width: 28px;
			height: 28px;
		}

		.final-score {
			font-size: 0.9rem;
			margin-bottom: 20px;
		}

		.score-value {
			font-size: 1.3rem;
		}

		.user-info {
			gap: 12px;
			margin-bottom: 20px;
		}

		.username {
			font-size: 0.9rem;
		}

		.logout-btn {
			font-size: 0.7rem;
			padding: 4px 10px;
			min-height: auto;
			min-width: auto;
		}

		.discord-btn {
			padding: 14px 32px;
			font-size: 1rem;
			margin-bottom: 24px;
			width: auto;
		}

		.start-btn {
			padding: 14px 48px;
			font-size: 1.1rem;
			margin-bottom: 12px;
			width: auto;
		}

		.game-modes {
			flex-direction: row;
			justify-content: center;
			gap: var(--spacing-md, 12px);
		}

		.rooms-section {
			max-width: 400px;
		}

		.rooms-header {
			font-size: 0.7rem;
		}

		.room-btn {
			font-size: 0.8rem;
		}

		.lore {
			font-size: 0.85rem;
			line-height: 1.6;
			margin-bottom: 28px;
		}

		.feature {
			font-size: 0.75rem;
		}
	}
</style>
