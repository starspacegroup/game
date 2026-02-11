<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';

	// Derive visible notifications reactively
	let notifications = $derived(gameState.pickupNotifications);
</script>

<div class="notif-container">
	{#each notifications as notif (notif.id)}
		<div
			class="pickup-notif"
			style="--accent: {notif.color}; --accent-bg: {notif.color}22; --accent-border: {notif.color}66"
		>
			<div class="notif-icon-wrap">
				<span class="notif-icon">{notif.icon}</span>
				<div class="notif-ring" style="border-color: {notif.color}"></div>
			</div>
			<div class="notif-content">
				<span class="notif-label">{notif.label}</span>
				<span class="notif-detail">{notif.detail}</span>
			</div>
			<div class="notif-flash" style="background: {notif.color}"></div>
		</div>
	{/each}
</div>

<style>
	.notif-container {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		pointer-events: none;
		z-index: 50;
	}

	.pickup-notif {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 22px 10px 14px;
		background: rgba(0, 8, 20, 0.85);
		border: 1px solid var(--accent-border);
		border-radius: 12px;
		backdrop-filter: blur(8px);
		animation: notif-enter 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards,
		           notif-exit 0.5s ease-in 1.8s forwards;
		position: relative;
		overflow: hidden;
		min-width: 200px;
	}

	.notif-flash {
		position: absolute;
		inset: 0;
		opacity: 0;
		animation: flash-burst 0.6s ease-out forwards;
		pointer-events: none;
	}

	@keyframes flash-burst {
		0% { opacity: 0.35; }
		100% { opacity: 0; }
	}

	@keyframes notif-enter {
		0% {
			opacity: 0;
			transform: scale(0.3) translateY(20px);
			filter: brightness(3);
		}
		50% {
			filter: brightness(1.5);
		}
		100% {
			opacity: 1;
			transform: scale(1) translateY(0);
			filter: brightness(1);
		}
	}

	@keyframes notif-exit {
		0% {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
		100% {
			opacity: 0;
			transform: scale(0.8) translateY(-30px);
		}
	}

	.notif-icon-wrap {
		position: relative;
		width: 42px;
		height: 42px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.notif-icon {
		font-size: 1.5rem;
		z-index: 1;
		animation: icon-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
		filter: drop-shadow(0 0 6px var(--accent));
	}

	@keyframes icon-pop {
		0% { transform: scale(0); }
		60% { transform: scale(1.4); }
		100% { transform: scale(1); }
	}

	.notif-ring {
		position: absolute;
		inset: 0;
		border: 2px solid;
		border-radius: 50%;
		animation: ring-expand 0.8s ease-out forwards;
		opacity: 0.6;
	}

	@keyframes ring-expand {
		0% {
			transform: scale(0.5);
			opacity: 0.8;
		}
		100% {
			transform: scale(1.3);
			opacity: 0;
		}
	}

	.notif-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.notif-label {
		font-family: 'Courier New', monospace;
		font-size: 0.8rem;
		font-weight: bold;
		color: var(--accent);
		letter-spacing: 2px;
		text-shadow: 0 0 10px var(--accent);
	}

	.notif-detail {
		font-family: 'Courier New', monospace;
		font-size: 0.65rem;
		color: rgba(200, 220, 240, 0.8);
		letter-spacing: 0.5px;
	}

	@media (min-width: 768px) {
		.pickup-notif {
			gap: 18px;
			padding: 12px 28px 12px 16px;
			min-width: 260px;
		}

		.notif-icon {
			font-size: 1.8rem;
		}

		.notif-label {
			font-size: 0.9rem;
		}

		.notif-detail {
			font-size: 0.7rem;
		}
	}
</style>
