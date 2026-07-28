<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<svelte:head>
	<title>*Space Game</title>
	<!-- Icons live in app.html, not here: they are static for every route, and a
	     <svelte:head> link is re-evaluated per navigation for no benefit. This
	     used to be an inline data-URI of the ⭐ emoji. -->
</svelte:head>

{@render children?.()}
