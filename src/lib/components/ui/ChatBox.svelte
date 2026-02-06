<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { sendChat } from '$lib/stores/socketClient';

	let chatInput = $state('');

	function handleSubmit(e: Event): void {
		e.preventDefault();
		if (!chatInput.trim()) return;
		sendChat(chatInput.trim());
		gameState.messages = [
			...gameState.messages,
			{ sender: 'You', text: chatInput.trim(), time: Date.now() }
		];
		chatInput = '';
	}

	function toggleChat(): void {
		gameState.showChat = !gameState.showChat;
	}

	// Only show last 20 messages
	let visibleMessages = $derived(gameState.messages.slice(-20));
</script>

{#if gameState.mode === 'multiplayer'}
	<div class="chat-wrapper">
		<button class="chat-toggle" onclick={toggleChat}>
			{gameState.showChat ? 'CLOSE' : 'CHAT'}
			{#if gameState.messages.length > 0}
				<span class="badge">{gameState.messages.length}</span>
			{/if}
		</button>

		{#if gameState.showChat}
			<div class="chat-box">
				<div class="chat-messages">
					{#each visibleMessages as msg}
						<div class="chat-msg">
							<span class="chat-sender">{msg.sender}:</span>
							<span class="chat-text">{msg.text}</span>
						</div>
					{/each}
				</div>
				<form class="chat-input-form" onsubmit={handleSubmit}>
					<input
						type="text"
						class="chat-input"
						bind:value={chatInput}
						placeholder="Type message..."
						maxlength="200"
					/>
					<button type="submit" class="chat-send">SEND</button>
				</form>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ===== MOBILE-FIRST CHAT BOX STYLES ===== */
	.chat-wrapper {
		position: fixed;
		/* Mobile: position at top to avoid joysticks */
		top: calc(var(--safe-top, 0px) + 60px);
		right: calc(var(--safe-right, 0px) + var(--spacing-sm, 8px));
		z-index: 30;
		pointer-events: all;
		max-width: calc(100vw - var(--spacing-lg, 16px) * 2);
	}

	.chat-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		/* Touch-friendly minimum size */
		min-height: var(--touch-target-min, 44px);
		min-width: var(--touch-target-min, 44px);
		padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		letter-spacing: 1px;
		color: #8899aa;
		background: rgba(0, 0, 17, 0.85);
		border: 1px solid #335;
		border-radius: 6px;
		cursor: pointer;
		margin-bottom: var(--spacing-xs, 4px);
		-webkit-tap-highlight-color: transparent;
	}

	.badge {
		background: #4488ff;
		color: #fff;
		border-radius: 50%;
		padding: 2px 6px;
		font-size: 0.5rem;
		margin-left: var(--spacing-xs, 4px);
		min-width: 18px;
		text-align: center;
	}

	.chat-box {
		/* Mobile-first: smaller chat box */
		width: 220px;
		max-height: 160px;
		background: rgba(0, 0, 17, 0.92);
		border: 1px solid #335;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		backdrop-filter: blur(4px);
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-sm, 8px);
		max-height: 110px;
		/* Better touch scrolling */
		-webkit-overflow-scrolling: touch;
	}

	.chat-msg {
		font-size: var(--font-xs, 0.6rem);
		margin-bottom: 3px;
		line-height: 1.3;
		word-wrap: break-word;
	}

	.chat-sender {
		color: #4488ff;
		font-weight: bold;
	}

	.chat-text {
		color: #aabbcc;
	}

	.chat-input-form {
		display: flex;
		border-top: 1px solid #223;
	}

	.chat-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: none;
		color: #fff;
		/* Touch-friendly input height */
		min-height: var(--touch-target-min, 44px);
		padding: var(--spacing-sm, 8px);
		font-size: var(--font-sm, 0.7rem);
		font-family: var(--hud-font, monospace);
		outline: none;
		-webkit-appearance: none;
		appearance: none;
	}

	.chat-input::placeholder {
		color: #556677;
	}

	.chat-send {
		/* Touch-friendly send button */
		min-width: var(--touch-target-min, 44px);
		min-height: var(--touch-target-min, 44px);
		padding: var(--spacing-sm, 8px);
		background: #4488ff;
		color: #fff;
		border: none;
		font-family: var(--hud-font, monospace);
		font-size: var(--font-xs, 0.6rem);
		cursor: pointer;
		letter-spacing: 1px;
		-webkit-tap-highlight-color: transparent;
	}

	.chat-send:active {
		background: #3366dd;
	}

	/* ===== LARGER PHONES (375px+) ===== */
	@media (min-width: 375px) {
		.chat-box {
			width: 240px;
			max-height: 180px;
		}

		.chat-messages {
			max-height: 130px;
		}
	}

	/* ===== TABLETS AND UP (768px+) ===== */
	@media (min-width: 768px) {
		.chat-wrapper {
			/* Desktop: position at bottom right */
			top: auto;
			bottom: calc(var(--safe-bottom, 0px) + 16px);
			right: 16px;
		}

		.chat-toggle {
			min-height: auto;
			min-width: auto;
			padding: 6px 14px;
			font-size: 0.65rem;
			letter-spacing: 2px;
		}

		.chat-box {
			width: 260px;
			max-height: 200px;
		}

		.chat-messages {
			max-height: 150px;
		}

		.chat-msg {
			font-size: 0.7rem;
		}

		.chat-input {
			min-height: auto;
			padding: 6px 8px;
			font-size: 0.7rem;
		}

		.chat-send {
			min-width: auto;
			min-height: auto;
			padding: 6px 10px;
		}
	}
</style>
