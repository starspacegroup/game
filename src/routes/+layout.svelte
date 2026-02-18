<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<svelte:head>
	<title>Game</title>
	<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='80' font-size='80'>&#x2B50;</text></svg>" />
</svelte:head>

{@render children?.()}
