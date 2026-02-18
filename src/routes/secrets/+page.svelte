<script lang="ts">
	import { onMount } from 'svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { TOTAL_FRAGMENTS, generateMetaRevelation, type FragmentData } from '$lib/game/fragments';

	let mode = $state<'solo' | 'multi'>('solo');
	let fragments = $state<FragmentData[]>([]);
	let metaSolved = $state(false);
	let metaSolvedAt = $state<string | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showMeta = $state(false);

	// Slots for the 12 fragment positions
	let slots = $derived(
		Array.from({ length: TOTAL_FRAGMENTS }, (_, i) => {
			return fragments.find((f) => f.index === i) ?? null;
		})
	);

	let metaText = $derived(
		metaSolved && fragments.length >= TOTAL_FRAGMENTS
			? generateMetaRevelation(fragments)
			: ''
	);

	async function fetchFragments() {
		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/secrets/fragments?mode=${mode}`);
			const data = await res.json() as {
				success: boolean;
				error?: string;
				fragments: FragmentData[];
				metaSolved: boolean;
				metaSolvedAt: string | null;
			};

			if (!data.success) {
				error = data.error ?? 'Failed to load fragments';
				return;
			}

			fragments = data.fragments;
			metaSolved = data.metaSolved;
			metaSolvedAt = data.metaSolvedAt;
		} catch (e) {
			error = 'Network error loading fragments';
		} finally {
			loading = false;
		}
	}

	function switchMode(m: 'solo' | 'multi') {
		mode = m;
		fetchFragments();
	}

	function glyphColor(params: number[]): string {
		const hue = Math.round(params[0] * 360);
		const sat = Math.round(params[1] * 100);
		return `hsl(${hue}, ${sat}%, 65%)`;
	}

	function glyphShadow(params: number[]): string {
		const hue = Math.round(params[0] * 360);
		return `0 0 20px hsla(${hue}, 80%, 50%, 0.6), 0 0 40px hsla(${hue}, 60%, 40%, 0.3)`;
	}

	onMount(() => {
		authState.loadFromStorage();
		if (!authState.isLoggedIn) {
			window.location.href = '/';
			return;
		}
		fetchFragments();
	});
</script>

<div class="secrets-page">
	<header class="secrets-header">
		<a href="/" class="back-link">← STARSPACE</a>
		<h1>E8 FRAGMENTS</h1>
		<p class="subtitle">
			{fragments.length} / {TOTAL_FRAGMENTS} collected
			{#if metaSolved}
				<span class="meta-badge">COMPLETE</span>
			{/if}
		</p>
	</header>

	<div class="mode-toggle">
		<button
			class="mode-btn"
			class:active={mode === 'solo'}
			onclick={() => switchMode('solo')}
		>
			SOLO
		</button>
		<button
			class="mode-btn"
			class:active={mode === 'multi'}
			onclick={() => switchMode('multi')}
		>
			MULTIPLAYER
		</button>
	</div>

	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			<p>Scanning lattice...</p>
		</div>
	{:else if error}
		<div class="error-msg">{error}</div>
	{:else}
		<div class="fragment-grid">
			{#each slots as slot, i}
				{#if slot}
					<a
						href="/secrets/{slot.id}"
						class="fragment-card unlocked"
						style="--glyph-color: {glyphColor(slot.glyphParams)}; --glyph-shadow: {glyphShadow(slot.glyphParams)}"
					>
						<div class="glyph-container">
							<svg viewBox="0 0 100 100" class="glyph-svg">
								{@html generateGlyphSVG(slot.glyphParams)}
							</svg>
						</div>
						<div class="card-info">
							<span class="frag-index">Fragment {i + 1}</span>
							<span class="frag-title">{slot.title}</span>
						</div>
					</a>
				{:else}
					<div class="fragment-card locked">
						<div class="glyph-container">
							<div class="locked-icon">?</div>
						</div>
						<div class="card-info">
							<span class="frag-index">Fragment {i + 1}</span>
							<span class="frag-title locked-text">Not yet discovered</span>
						</div>
					</div>
				{/if}
			{/each}
		</div>

		{#if metaSolved}
			<div class="meta-section">
				<button
					class="meta-reveal-btn"
					onclick={() => showMeta = !showMeta}
				>
					{showMeta ? '▼ HIDE REVELATION' : '▶ VIEW THE COMPLETE REVELATION'}
				</button>

				{#if showMeta}
					<div class="meta-content">
						{#each metaText.split('\n\n') as paragraph}
							<p>{paragraph}</p>
						{/each}
						{#if metaSolvedAt}
							<div class="meta-date">
								Completed {new Date(metaSolvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<script lang="ts" module>
	/** Generate an SVG glyph from the 8 float parameters */
	function generateGlyphSVG(params: number[]): string {
		const [hue, sat, vertexCount, rotOffset, innerRatio, symOrder, displacement, _pulseSpeed] = params;
		const cx = 50, cy = 50, r = 35;
		const n = Math.round(vertexCount);
		const innerR = r * innerRatio;
		const color = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 65%)`;
		const dimColor = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 35%)`;

		let paths = '';

		// Outer polygon
		const outerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2;
			const dx = displacement * Math.sin(angle * symOrder) * 8;
			const dy = displacement * Math.cos(angle * symOrder) * 8;
			outerPts.push([cx + Math.cos(angle) * r + dx, cy + Math.sin(angle) * r + dy]);
		}
		const outerPath = outerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${outerPath}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8"/>`;

		// Inner polygon
		const innerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
			innerPts.push([cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR]);
		}
		const innerPath = innerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${innerPath}" fill="none" stroke="${dimColor}" stroke-width="1" opacity="0.6"/>`;

		// Connecting lines (outer to inner)
		for (let i = 0; i < n; i++) {
			paths += `<line x1="${outerPts[i][0].toFixed(1)}" y1="${outerPts[i][1].toFixed(1)}" x2="${innerPts[i][0].toFixed(1)}" y2="${innerPts[i][1].toFixed(1)}" stroke="${color}" stroke-width="0.5" opacity="0.4"/>`;
		}

		// Center dot
		paths += `<circle cx="${cx}" cy="${cy}" r="2" fill="${color}" opacity="0.9"/>`;

		// Symmetry lines
		for (let s = 0; s < symOrder; s++) {
			const angle = rotOffset + (s / symOrder) * Math.PI;
			const x1 = cx + Math.cos(angle) * r * 0.3;
			const y1 = cy + Math.sin(angle) * r * 0.3;
			const x2 = cx - Math.cos(angle) * r * 0.3;
			const y2 = cy - Math.sin(angle) * r * 0.3;
			paths += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${dimColor}" stroke-width="0.5" opacity="0.3"/>`;
		}

		return paths;
	}
</script>

<style>
	.secrets-page {
		min-height: 100vh;
		background: #000011;
		color: #fff;
		font-family: 'Courier New', monospace;
		padding: 24px;
		max-width: 900px;
		margin: 0 auto;
	}

	.secrets-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.back-link {
		color: #6688aa;
		text-decoration: none;
		font-size: 0.8rem;
		letter-spacing: 1px;
	}

	.back-link:hover {
		color: #00ff88;
	}

	h1 {
		font-size: 2rem;
		color: #00ff88;
		text-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
		margin: 12px 0 8px;
		letter-spacing: 4px;
	}

	.subtitle {
		color: #6688aa;
		font-size: 0.85rem;
		letter-spacing: 2px;
	}

	.meta-badge {
		background: rgba(0, 255, 136, 0.15);
		color: #00ff88;
		padding: 2px 8px;
		border: 1px solid rgba(0, 255, 136, 0.3);
		border-radius: 4px;
		font-size: 0.7rem;
		margin-left: 8px;
	}

	.mode-toggle {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-bottom: 32px;
	}

	.mode-btn {
		background: transparent;
		border: 1px solid #335;
		color: #6688aa;
		padding: 6px 20px;
		font-family: inherit;
		font-size: 0.75rem;
		letter-spacing: 2px;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.mode-btn.active {
		border-color: #4488ff;
		color: #4488ff;
		background: rgba(68, 136, 255, 0.1);
	}

	.mode-btn:hover {
		border-color: #4488ff;
	}

	.loading {
		text-align: center;
		padding: 60px 0;
		color: #6688aa;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 2px solid #335;
		border-top-color: #00ff88;
		border-radius: 50%;
		margin: 0 auto 16px;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-msg {
		text-align: center;
		color: #ff4444;
		padding: 40px;
	}

	.fragment-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 16px;
		margin-bottom: 40px;
	}

	.fragment-card {
		background: rgba(20, 30, 50, 0.6);
		border: 1px solid #223;
		border-radius: 8px;
		padding: 20px;
		text-align: center;
		transition: all 0.3s;
		text-decoration: none;
		color: inherit;
		display: block;
	}

	.fragment-card.unlocked {
		border-color: var(--glyph-color, #4488ff);
		cursor: pointer;
	}

	.fragment-card.unlocked:hover {
		background: rgba(30, 45, 70, 0.8);
		box-shadow: var(--glyph-shadow, 0 0 20px rgba(68, 136, 255, 0.3));
		transform: translateY(-2px);
	}

	.fragment-card.locked {
		opacity: 0.35;
		border-color: #222;
	}

	.glyph-container {
		width: 80px;
		height: 80px;
		margin: 0 auto 12px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.glyph-svg {
		width: 100%;
		height: 100%;
	}

	.locked-icon {
		font-size: 2rem;
		color: #335;
	}

	.card-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.frag-index {
		font-size: 0.65rem;
		color: #6688aa;
		letter-spacing: 2px;
		text-transform: uppercase;
	}

	.frag-title {
		font-size: 0.8rem;
		color: var(--glyph-color, #aabbcc);
		line-height: 1.3;
	}

	.locked-text {
		color: #445 !important;
		font-style: italic;
	}

	.meta-section {
		border-top: 1px solid #223;
		padding-top: 32px;
		text-align: center;
	}

	.meta-reveal-btn {
		background: rgba(0, 255, 136, 0.08);
		border: 1px solid rgba(0, 255, 136, 0.3);
		color: #00ff88;
		padding: 12px 32px;
		font-family: inherit;
		font-size: 0.85rem;
		letter-spacing: 2px;
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.3s;
	}

	.meta-reveal-btn:hover {
		background: rgba(0, 255, 136, 0.15);
		box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
	}

	.meta-content {
		max-width: 600px;
		margin: 32px auto 0;
		text-align: left;
	}

	.meta-content p {
		color: #ccdde8;
		line-height: 1.7;
		margin-bottom: 20px;
		font-size: 0.9rem;
	}

	.meta-content p:first-child {
		color: #00ff88;
		font-size: 1rem;
		text-align: center;
		letter-spacing: 1px;
	}

	.meta-date {
		text-align: center;
		color: #445;
		font-size: 0.75rem;
		margin-top: 24px;
		letter-spacing: 1px;
	}

	@media (max-width: 480px) {
		.secrets-page {
			padding: 16px;
		}

		.fragment-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 10px;
		}

		h1 {
			font-size: 1.4rem;
		}

		.glyph-container {
			width: 60px;
			height: 60px;
		}
	}
</style>
