<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { setupKeyboardControls, setupMouseControls } from '$lib/stores/inputState.svelte';
	import GameScene from '$lib/components/game/GameScene.svelte';
	import HUD from '$lib/components/ui/HUD.svelte';
	import VirtualJoystick from '$lib/components/ui/VirtualJoystick.svelte';
	import WelcomeScreen from '$lib/components/ui/WelcomeScreen.svelte';
	import ChatBox from '$lib/components/ui/ChatBox.svelte';

	let gameContainer: HTMLDivElement | undefined = $state();
	let cleanupKeyboard: (() => void) | undefined;
	let cleanupMouse: (() => void) | undefined;

	onMount(() => {
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
				document.documentElement.requestFullscreen?.().catch(() => {});
				document.removeEventListener('touchstart', requestFs);
			};
			document.addEventListener('touchstart', requestFs, { once: true });
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
		cleanupKeyboard?.();
		cleanupMouse?.();
	});
</script>

<div id="game-root" bind:this={gameContainer}>
	<!-- 3D Game Scene (always rendered, behind UI) -->
	<GameScene />

	<!-- UI Overlays -->
	{#if gameState.phase === 'playing'}
		<HUD />
		{#if gameState.isMobile}
			<VirtualJoystick />
		{/if}
		<ChatBox />
	{/if}

	<!-- Welcome / Game Over screen -->
	<WelcomeScreen />
</div>
