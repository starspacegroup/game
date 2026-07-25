<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { setupKeyboardControls, setupMouseControls } from '$lib/stores/inputState.svelte';
	import { disconnect } from '$lib/stores/socketClient';
	import GameScene from '$lib/components/game/GameScene.svelte';
	import HUD from '$lib/components/ui/HUD.svelte';
	import VirtualJoystick from '$lib/components/ui/VirtualJoystick.svelte';
	import WelcomeScreen from '$lib/components/ui/WelcomeScreen.svelte';
	import ChatBox from '$lib/components/ui/ChatBox.svelte';
	import PlayerIndicators from '$lib/components/ui/PlayerIndicators.svelte';
	import SphereMap from '$lib/components/ui/SphereMap.svelte';
	import PowerUpNotification from '$lib/components/ui/PowerUpNotification.svelte';
	import DeathScreen from '$lib/components/ui/DeathScreen.svelte';
	import SolveReveal from '$lib/components/ui/SolveReveal.svelte';

	let gameContainer: HTMLDivElement | undefined = $state();
	let cleanupKeyboard: (() => void) | undefined;
	let cleanupMouse: (() => void) | undefined;

	/**
	 * Handle session end (browser close / navigate away) while the player is alive.
	 * Saves personal best to localStorage synchronously and uses sendBeacon to
	 * submit the score to the leaderboard (works reliably during page unload).
	 */
	/** Highest score already sent, so repeated triggers don't resubmit the same run. */
	let lastSubmittedScore = 0;

	function handleSessionEnd(): void {
		// Only act if player is in an active game and not already dead
		if (gameState.phase !== 'playing' || gameState.multiplayerDead) return;

		const score = gameState.score;
		const wave = gameState.wave;

		// Fires from several events now (see onMount) — only the first one with
		// a given score does any work. Score only grows during a run, so a
		// player who backgrounds the app, returns and scores more still submits
		// the improvement on the next trigger.
		if (score <= lastSubmittedScore) return;
		lastSubmittedScore = score;

		// Save personal best to localStorage (synchronous, always works)
		if (score > 0) {
			const currentBest = parseInt(localStorage.getItem('starspace_personal_best') || '0', 10) || 0;
			if (score > currentBest) {
				localStorage.setItem('starspace_personal_best', String(score));
			}
		}

		// Submit score to leaderboard via sendBeacon (fire-and-forget, survives page unload)
		if (score > 0) {
			const payload: Record<string, unknown> = { score, wave };
			if (!authState.isLoggedIn) {
				// Persist a freshly minted ID, or this run lands under an identity
				// no later run can improve on. GameWorld normally creates it first;
				// this covers the case where it never mounted.
				let guestId = localStorage.getItem('starspace_guest_id');
				if (!guestId) {
					guestId = crypto.randomUUID();
					localStorage.setItem('starspace_guest_id', guestId);
				}
				payload.guestId = guestId;
				payload.guestName = 'Guest';
			}

			const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
			navigator.sendBeacon('/api/leaderboard', blob);
		}
	}

	function onBeforeUnload(): void {
		handleSessionEnd();
	}

	function onPageHide(): void {
		handleSessionEnd();
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden') handleSessionEnd();
	}

	onMount(() => {
		// `beforeunload` alone loses mobile scores: it is unreliable on mobile
		// browsers, and backgrounding the app — the normal way a phone session
		// ends — often never fires it. `pagehide` and visibilitychange→hidden do
		// fire there. handleSessionEnd() is idempotent per score, so overlapping
		// events on desktop cost nothing.
		window.addEventListener('beforeunload', onBeforeUnload);
		window.addEventListener('pagehide', onPageHide);
		document.addEventListener('visibilitychange', onVisibilityChange);
		// Detect mobile
		gameState.isMobile =
			'ontouchstart' in window ||
			navigator.maxTouchPoints > 0 ||
			window.innerWidth < 768;

		// Setup controls
		cleanupKeyboard = setupKeyboardControls();
		if (gameContainer && !gameState.isMobile) {
			cleanupMouse = setupMouseControls(gameContainer);
		}

		// Request fullscreen on mobile after first interaction
		if (gameState.isMobile) {
			const requestFs = () => {
				if (!document.fullscreenElement) {
					document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
				}
				document.removeEventListener('touchstart', requestFs);
			};
			document.addEventListener('touchstart', requestFs, { once: true });

			// Also try to scroll away the address bar as a fallback
			window.scrollTo(0, 1);
		}

		// Handle resize
		function onResize(): void {
			gameState.isMobile = window.innerWidth < 768;
		}
		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
		};
	});

	onDestroy(() => {
		window.removeEventListener('beforeunload', onBeforeUnload);
		window.removeEventListener('pagehide', onPageHide);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		handleSessionEnd();
		cleanupKeyboard?.();
		cleanupMouse?.();
		disconnect();
	});
</script>

<div id="game-root" bind:this={gameContainer}>
	<!-- 3D Game Scene (always rendered, behind UI) -->
	<GameScene />

	<!-- UI Overlays -->
	{#if gameState.phase === 'playing'}
		<HUD />
		<SphereMap />
		<PlayerIndicators />
		<PowerUpNotification />
		{#if gameState.isMobile}
			<VirtualJoystick />
		{/if}
		<ChatBox />
		{#if gameState.solveSequenceActive}
			<SolveReveal
				fragment={gameState.lastUnlockedFragment}
				onComplete={() => { gameState.solveSequenceActive = false; }}
			/>
		{/if}
	{/if}

	<!-- Multiplayer death screen (shown over game while still connected) -->
	<DeathScreen />

	<!-- Welcome / Game Over screen -->
	<WelcomeScreen />
</div>
