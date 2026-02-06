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
	.chat-wrapper {
		position: fixed;
		bottom: 16px;
		right: 16px;
		z-index: 30;
		pointer-events: all;
	}

	.chat-toggle {
		display: block;
		margin-left: auto;
		padding: 6px 14px;
		font-family: var(--hud-font, monospace);
		font-size: 0.65rem;
		letter-spacing: 2px;
		color: #8899aa;
		background: rgba(0, 0, 17, 0.8);
		border: 1px solid #335;
		border-radius: 4px;
		cursor: pointer;
		margin-bottom: 4px;
	}

	.badge {
		background: #4488ff;
		color: #fff;
		border-radius: 50%;
		padding: 1px 5px;
		font-size: 0.55rem;
		margin-left: 4px;
	}

	.chat-box {
		width: 260px;
		max-height: 200px;
		background: rgba(0, 0, 17, 0.9);
		border: 1px solid #335;
		border-radius: 6px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		max-height: 150px;
	}

	.chat-msg {
		font-size: 0.7rem;
		margin-bottom: 3px;
		line-height: 1.3;
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
		padding: 6px 8px;
		font-size: 0.7rem;
		font-family: var(--hud-font, monospace);
		outline: none;
	}

	.chat-send {
		padding: 6px 10px;
		background: #4488ff;
		color: #fff;
		border: none;
		font-family: var(--hud-font, monospace);
		font-size: 0.6rem;
		cursor: pointer;
		letter-spacing: 1px;
	}
</style>
