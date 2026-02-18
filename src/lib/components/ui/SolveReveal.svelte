<script lang="ts">
	import { gameState } from '$lib/stores/gameState.svelte';
	import { authState } from '$lib/stores/authState.svelte';
	import { TOTAL_FRAGMENTS, type FragmentData } from '$lib/game/fragments';

	let { fragment, onComplete }: {
		fragment: FragmentData | null;
		onComplete: () => void;
	} = $props();

	let phase = $state<'flash' | 'reveal' | 'fadeout'>('flash');
	let visible = $state(true);

	// Auto-advance through phases
	$effect(() => {
		if (!visible) return;

		// Phase 1: Flash (0-1s) — bright white pulse
		const t1 = setTimeout(() => { phase = 'reveal'; }, 1000);

		// Phase 2: Reveal (1-3.5s) — show fragment info
		const t2 = setTimeout(() => { phase = 'fadeout'; }, 3500);

		// Phase 3: Fadeout (3.5-4.5s) — fade and complete
		const t3 = setTimeout(() => {
			visible = false;
			onComplete();
		}, 4500);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
			clearTimeout(t3);
		};
	});

	function glyphColor(params: number[]): string {
		if (!params || params.length < 2) return '#4488ff';
		const hue = Math.round(params[0] * 360);
		const sat = Math.round(params[1] * 100);
		return `hsl(${hue}, ${sat}%, 65%)`;
	}

	function generateMiniGlyphSVG(params: number[]): string {
		if (!params || params.length < 8) return '<circle cx="50" cy="50" r="20" fill="#4488ff" opacity="0.5"/>';
		const [hue, sat, vertexCount, rotOffset, innerRatio, symOrder, displacement] = params;
		const cx = 50, cy = 50, r = 35;
		const n = Math.round(vertexCount);
		const innerR = r * innerRatio;
		const color = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 65%)`;
		const dimColor = `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 100)}%, 40%)`;

		let paths = '';

		const outerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2;
			const dx = displacement * Math.sin(angle * symOrder) * 8;
			const dy = displacement * Math.cos(angle * symOrder) * 8;
			outerPts.push([cx + Math.cos(angle) * r + dx, cy + Math.sin(angle) * r + dy]);
		}

		const outerPath = outerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${outerPath}" fill="none" stroke="${color}" stroke-width="2" opacity="0.9"/>`;

		const innerPts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const angle = rotOffset + (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
			innerPts.push([cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR]);
		}

		const innerPath = innerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
		paths += `<path d="${innerPath}" fill="none" stroke="${dimColor}" stroke-width="1" opacity="0.6"/>`;

		for (let i = 0; i < n; i++) {
			paths += `<line x1="${outerPts[i][0].toFixed(1)}" y1="${outerPts[i][1].toFixed(1)}" x2="${innerPts[i][0].toFixed(1)}" y2="${innerPts[i][1].toFixed(1)}" stroke="${color}" stroke-width="0.5" opacity="0.4"/>`;
		}

		paths += `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" opacity="0.9"/>`;

		return paths;
	}
</script>

{#if visible}
	<div class="solve-overlay" class:flash={phase === 'flash'} class:reveal={phase === 'reveal'} class:fadeout={phase === 'fadeout'}>
		<!-- White flash layer -->
		<div class="flash-layer"></div>

		<!-- Content layer -->
		<div class="content-layer">
			{#if phase === 'reveal' || phase === 'fadeout'}
				<div class="reveal-content">
					<div class="lattice-complete">✦ E8 LATTICE COMPLETE ✦</div>

					{#if fragment}
						<div class="fragment-reveal" style="--frag-color: {glyphColor(fragment.glyphParams)}">
							<div class="frag-glyph">
								<svg viewBox="0 0 100 100" class="frag-svg">
									{@html generateMiniGlyphSVG(fragment.glyphParams)}
								</svg>
							</div>
							<div class="frag-info">
								<span class="frag-label">FRAGMENT {fragment.index + 1} / {TOTAL_FRAGMENTS} UNLOCKED</span>
								<span class="frag-title">{fragment.title}</span>
							</div>
						</div>
						<div class="view-link">View at /secrets</div>
					{:else if !authState.isLoggedIn}
						<div class="guest-notice">
							Log in with Discord to collect E8 fragments
						</div>
					{:else}
						<div class="already-complete">
							All fragments collected — visit /secrets
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.solve-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flash-layer {
		position: absolute;
		inset: 0;
		background: white;
		opacity: 0;
		transition: opacity 0.3s;
	}

	.solve-overlay.flash .flash-layer {
		opacity: 0.4;
		animation: flashPulse 1s ease-out forwards;
	}

	@keyframes flashPulse {
		0% { opacity: 0; }
		15% { opacity: 0.5; }
		100% { opacity: 0; }
	}

	.content-layer {
		position: relative;
		z-index: 1;
		text-align: center;
	}

	.reveal-content {
		animation: revealIn 0.6s ease-out;
	}

	@keyframes revealIn {
		from { opacity: 0; transform: scale(0.9) translateY(10px); }
		to { opacity: 1; transform: scale(1) translateY(0); }
	}

	.solve-overlay.fadeout .reveal-content {
		animation: revealOut 1s ease-in forwards;
	}

	@keyframes revealOut {
		from { opacity: 1; transform: translateY(0); }
		to { opacity: 0; transform: translateY(-20px); }
	}

	.lattice-complete {
		font-family: 'Courier New', monospace;
		font-size: 1.4rem;
		color: #00ff88;
		text-shadow: 0 0 30px rgba(0, 255, 136, 0.6), 0 0 60px rgba(0, 255, 136, 0.3);
		letter-spacing: 4px;
		margin-bottom: 24px;
		animation: textGlow 2s ease-in-out infinite;
	}

	@keyframes textGlow {
		0%, 100% { text-shadow: 0 0 30px rgba(0, 255, 136, 0.6), 0 0 60px rgba(0, 255, 136, 0.3); }
		50% { text-shadow: 0 0 40px rgba(0, 255, 136, 0.8), 0 0 80px rgba(0, 255, 136, 0.4); }
	}

	.fragment-reveal {
		display: flex;
		align-items: center;
		gap: 16px;
		background: rgba(0, 0, 17, 0.9);
		border: 1px solid var(--frag-color, #4488ff);
		border-radius: 8px;
		padding: 16px 24px;
		box-shadow: 0 0 30px rgba(0, 0, 0, 0.5), 0 0 15px var(--frag-color, rgba(68, 136, 255, 0.2));
		max-width: 400px;
		margin: 0 auto;
	}

	.frag-glyph {
		width: 60px;
		height: 60px;
		flex-shrink: 0;
	}

	.frag-svg {
		width: 100%;
		height: 100%;
	}

	.frag-info {
		display: flex;
		flex-direction: column;
		text-align: left;
		gap: 4px;
	}

	.frag-label {
		font-family: 'Courier New', monospace;
		font-size: 0.6rem;
		color: #6688aa;
		letter-spacing: 2px;
	}

	.frag-title {
		font-family: 'Courier New', monospace;
		font-size: 0.85rem;
		color: var(--frag-color, #4488ff);
		line-height: 1.3;
	}

	.view-link {
		font-family: 'Courier New', monospace;
		font-size: 0.65rem;
		color: #445;
		margin-top: 12px;
		letter-spacing: 1px;
	}

	.guest-notice, .already-complete {
		font-family: 'Courier New', monospace;
		font-size: 0.8rem;
		color: #6688aa;
		background: rgba(0, 0, 17, 0.9);
		border: 1px solid #335;
		border-radius: 6px;
		padding: 12px 24px;
		max-width: 360px;
		margin: 0 auto;
	}

	@media (max-width: 480px) {
		.lattice-complete {
			font-size: 1rem;
			letter-spacing: 2px;
		}

		.fragment-reveal {
			flex-direction: column;
			padding: 16px;
		}

		.frag-info {
			text-align: center;
		}
	}
</style>
