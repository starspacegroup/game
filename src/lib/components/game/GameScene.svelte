<script lang="ts">
	import { Canvas } from '@threlte/core';
	import GameWorld from './GameWorld.svelte';
</script>

<div class="game-canvas">
	<Canvas>
		<GameWorld />
	</Canvas>
</div>

<style>
	.game-canvas {
		width: 100%;
		height: 100%;
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
