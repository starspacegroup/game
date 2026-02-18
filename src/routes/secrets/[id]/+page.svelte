<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authState } from '$lib/stores/authState.svelte';
	import type { FragmentData } from '$lib/game/fragments';

	let fragment = $state<FragmentData | null>(null);
	let fragmentMode = $state<string>('solo');
	let loading = $state(true);
	let error = $state<string | null>(null);

	function glyphColor(params: number[]): string {
		const hue = Math.round(params[0] * 360);
		const sat = Math.round(params[1] * 100);
		return `hsl(${hue}, ${sat}%, 65%)`;
	}

	function glyphDimColor(params: number[]): string {
		const hue = Math.round(params[0] * 360);
		const sat = Math.round(params[1] * 100);
		return `hsl(${hue}, ${sat}%, 35%)`;
	}

	/** Generate larger, more detailed SVG glyph for the detail view */
	function generateDetailGlyphSVG(params: number[]): string {
		const [hue, sat, vertexCount, rotOffset, innerRatio, symOrder, displacement, _pulseSpeed] = params;
		const cx = 100, cy = 100, r = 70;
		const n = Math.round(vertexCount);
		const innerR = r * innerRatio;
		const midR = r * (0.5 + innerRatio * 0.3);
		const color = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 65%)`;
		const dimColor = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 35%)`;
		const glowColor = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 50%)`;

		let paths = '';

		// Outer glow circle
		paths += `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${dimColor}" stroke-width="0.5" opacity="0.2"/>`;

		// Outer polygon
		const outerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2;
			const dx = displacement * Math.sin(angle * symOrder) * 15;
			const dy = displacement * Math.cos(angle * symOrder) * 15;
			outerPts.push([cx + Math.cos(angle) * r + dx, cy + Math.sin(angle) * r + dy]);
		}
		const outerPath = outerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${outerPath}" fill="none" stroke="${color}" stroke-width="2" opacity="0.8"/>`;

		// Mid polygon
		const midPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n / 2;
			midPts.push([cx + Math.cos(angle) * midR, cy + Math.sin(angle) * midR]);
		}
		const midPath = midPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${midPath}" fill="none" stroke="${glowColor}" stroke-width="1" opacity="0.4"/>`;

		// Inner polygon
		const innerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
			innerPts.push([cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR]);
		}
		const innerPath = innerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${innerPath}" fill="none" stroke="${dimColor}" stroke-width="1.5" opacity="0.6"/>`;

		// Connecting lines (outer to mid, mid to inner)
		for (let i = 0; i < n; i++) {
			paths += `<line x1="${outerPts[i][0].toFixed(1)}" y1="${outerPts[i][1].toFixed(1)}" x2="${midPts[i][0].toFixed(1)}" y2="${midPts[i][1].toFixed(1)}" stroke="${color}" stroke-width="0.5" opacity="0.3"/>`;
			paths += `<line x1="${midPts[i][0].toFixed(1)}" y1="${midPts[i][1].toFixed(1)}" x2="${innerPts[i][0].toFixed(1)}" y2="${innerPts[i][1].toFixed(1)}" stroke="${dimColor}" stroke-width="0.5" opacity="0.3"/>`;
		}

		// Symmetry lines through center
		for (let s = 0; s < symOrder; s++) {
			const angle = rotOffset + (s / symOrder) * Math.PI;
			const x1 = cx + Math.cos(angle) * r * 0.9;
			const y1 = cy + Math.sin(angle) * r * 0.9;
			const x2 = cx - Math.cos(angle) * r * 0.9;
			const y2 = cy - Math.sin(angle) * r * 0.9;
			paths += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${dimColor}" stroke-width="0.5" opacity="0.15"/>`;
		}

		// Center circle
		paths += `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" opacity="0.8"/>`;
		paths += `<circle cx="${cx}" cy="${cy}" r="2" fill="#fff" opacity="0.6"/>`;

		// Vertex dots
		for (const pt of outerPts) {
			paths += `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="2.5" fill="${color}" opacity="0.7"/>`;
		}

		return paths;
	}

	onMount(() => {
		authState.loadFromStorage();
		if (!authState.isLoggedIn) {
			window.location.href = '/';
			return;
		}

		const id = $page.params.id;
		if (!id) {
			error = 'No fragment ID specified';
			loading = false;
			return;
		}

		fetch(`/api/secrets/fragment/${id}`)
			.then(async (res) => {
				const data = await res.json() as {
					success: boolean;
					error?: string;
					fragment: FragmentData;
					mode: string;
				};
				if (!data.success) {
					error = data.error ?? 'Fragment not found';
					return;
				}
				fragment = data.fragment;
				fragmentMode = data.mode;
			})
			.catch(() => {
				error = 'Network error';
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

<div class="detail-page">
	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			<p>Decoding fragment...</p>
		</div>
	{:else if error}
		<div class="error-container">
			<div class="error-icon">⊘</div>
			<p class="error-text">{error}</p>
			<a href="/secrets" class="back-btn">← Back to collection</a>
		</div>
	{:else if fragment}
		<div class="fragment-detail" style="--glyph-color: {glyphColor(fragment.glyphParams)}; --glyph-dim: {glyphDimColor(fragment.glyphParams)}">
			<a href="/secrets" class="back-link">← COLLECTION</a>

			<div class="glyph-hero">
				<svg viewBox="0 0 200 200" class="glyph-large">
					{@html generateDetailGlyphSVG(fragment.glyphParams)}
				</svg>
				<div class="glyph-pulse"></div>
			</div>

			<div class="fragment-meta">
				<span class="frag-index">Fragment {fragment.index + 1} of 12</span>
				<span class="frag-mode">{fragmentMode.toUpperCase()}</span>
			</div>

			<h1 class="fragment-title">{fragment.title}</h1>

			<div class="lore-text">
				{fragment.loreText}
			</div>

			<div class="fragment-footer">
				<div class="footer-row">
					<span class="footer-label">SEED</span>
					<span class="footer-value">{fragment.seed}</span>
				</div>
				<div class="footer-row">
					<span class="footer-label">UNLOCKED</span>
					<span class="footer-value">
						{new Date(fragment.unlockedAt).toLocaleDateString('en-US', {
							year: 'numeric', month: 'long', day: 'numeric',
							hour: '2-digit', minute: '2-digit'
						})}
					</span>
				</div>
				<div class="footer-row">
					<span class="footer-label">SESSION</span>
					<span class="footer-value mono">{fragment.gameSessionId.slice(0, 8)}</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.detail-page {
		min-height: 100vh;
		background: #000011;
		color: #fff;
		font-family: 'Courier New', monospace;
		padding: 24px;
		max-width: 640px;
		margin: 0 auto;
	}

	.loading {
		text-align: center;
		padding: 100px 0;
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

	.error-container {
		text-align: center;
		padding: 80px 0;
	}

	.error-icon {
		font-size: 3rem;
		color: #335;
		margin-bottom: 16px;
	}

	.error-text {
		color: #ff6666;
		font-size: 1rem;
		margin-bottom: 24px;
	}

	.back-btn, .back-link {
		color: #6688aa;
		text-decoration: none;
		font-size: 0.8rem;
		letter-spacing: 1px;
	}

	.back-btn:hover, .back-link:hover {
		color: #00ff88;
	}

	.fragment-detail {
		animation: fadeIn 0.6s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.glyph-hero {
		position: relative;
		width: 200px;
		height: 200px;
		margin: 40px auto 32px;
	}

	.glyph-large {
		width: 100%;
		height: 100%;
		position: relative;
		z-index: 1;
	}

	.glyph-pulse {
		position: absolute;
		inset: -20px;
		border-radius: 50%;
		background: radial-gradient(circle, var(--glyph-color, #4488ff) 0%, transparent 70%);
		opacity: 0.08;
		animation: pulse 3s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { transform: scale(1); opacity: 0.05; }
		50% { transform: scale(1.15); opacity: 0.12; }
	}

	.fragment-meta {
		text-align: center;
		margin-bottom: 8px;
		display: flex;
		justify-content: center;
		gap: 16px;
	}

	.frag-index {
		font-size: 0.7rem;
		color: #6688aa;
		letter-spacing: 2px;
		text-transform: uppercase;
	}

	.frag-mode {
		font-size: 0.65rem;
		color: #445;
		letter-spacing: 2px;
		border: 1px solid #223;
		padding: 1px 6px;
		border-radius: 3px;
	}

	.fragment-title {
		text-align: center;
		font-size: 1.3rem;
		color: var(--glyph-color, #4488ff);
		text-shadow: 0 0 20px var(--glyph-dim, rgba(68, 136, 255, 0.3));
		margin: 8px 0 32px;
		letter-spacing: 1px;
		line-height: 1.4;
	}

	.lore-text {
		color: #bbccdd;
		line-height: 1.8;
		font-size: 0.9rem;
		padding: 24px;
		background: rgba(20, 30, 50, 0.4);
		border-left: 2px solid var(--glyph-dim, #335);
		border-radius: 0 6px 6px 0;
		margin-bottom: 40px;
	}

	.fragment-footer {
		border-top: 1px solid #1a1a30;
		padding-top: 24px;
	}

	.footer-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
	}

	.footer-label {
		font-size: 0.65rem;
		color: #445;
		letter-spacing: 2px;
	}

	.footer-value {
		font-size: 0.7rem;
		color: #6688aa;
	}

	.mono {
		font-family: 'Courier New', monospace;
	}

	@media (max-width: 480px) {
		.detail-page {
			padding: 16px;
		}

		.glyph-hero {
			width: 150px;
			height: 150px;
		}

		.fragment-title {
			font-size: 1.1rem;
		}

		.lore-text {
			padding: 16px;
			font-size: 0.85rem;
		}
	}
</style>
