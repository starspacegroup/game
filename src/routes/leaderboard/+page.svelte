<script lang="ts">
	import type { LeaderboardEntry } from '../api/leaderboard/+server';
	import logoUrl from '$lib/assets/logo.png';

	let { data } = $props();
	const entries: LeaderboardEntry[] = data.entries;

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffSec = Math.round(diffMs / 1000);
		if (diffSec < 60) return 'just now';
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
		if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
		return d.toLocaleDateString();
	}

	function getRankClass(rank: number): string {
		if (rank === 1) return 'rank-gold';
		if (rank === 2) return 'rank-silver';
		if (rank === 3) return 'rank-bronze';
		return '';
	}

	function getRankIcon(rank: number): string {
		if (rank === 1) return '◆';
		if (rank === 2) return '◇';
		if (rank === 3) return '▸';
		return '';
	}
</script>

<svelte:head>
	<title>Leaderboard — *Space Game</title>
</svelte:head>

<div class="leaderboard-page">
	<div class="leaderboard-container">
		<header class="leaderboard-header">
			<a href="/" class="back-link">
				<span class="back-arrow">←</span>
				<img src={logoUrl} alt="*Space logo" class="header-logo" />
				<span class="header-org">*SPACE</span>
			</a>
			<h1 class="leaderboard-title">LEADERBOARD</h1>
			<p class="leaderboard-subtitle">PERSONAL BESTS — SOLO</p>
		</header>

		{#if entries.length === 0}
			<div class="empty-state">
				<div class="empty-icon">◇</div>
				<p class="empty-text">No scores yet — be the first!</p>
				<a href="/" class="play-link">PLAY NOW</a>
			</div>
		{:else}
			<div class="leaderboard-table">
				<div class="table-header">
					<span class="col-rank">RANK</span>
					<span class="col-player">PLAYER</span>
					<span class="col-score">SCORE</span>
					<span class="col-wave">WAVE</span>
					<span class="col-date">DATE</span>
				</div>

				{#each entries as entry, i (entry.userId + '-' + i)}
					{@const rank = i + 1}
					<div class="table-row {getRankClass(rank)}">
						<span class="col-rank">
							{#if getRankIcon(rank)}
								<span class="rank-icon">{getRankIcon(rank)}</span>
							{/if}
							<span class="rank-num">#{rank}</span>
						</span>
						<span class="col-player">{entry.username}</span>
						<span class="col-score">{entry.score.toLocaleString()}</span>
						<span class="col-wave">{entry.wave}</span>
						<span class="col-date">{formatDate(entry.date)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<footer class="leaderboard-footer">
			<a href="/" class="play-link">PLAY NOW</a>
		</footer>
	</div>
</div>

<style>
	.leaderboard-page {
		min-height: 100vh;
		background: radial-gradient(ellipse at center, rgba(0, 10, 30, 0.95) 0%, rgba(0, 0, 10, 1) 100%);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 16px;
		overflow-y: auto;
	}

	.leaderboard-container {
		max-width: 700px;
		width: 100%;
		margin: 0 auto;
		padding: 24px 0;
	}

	/* Header */
	.leaderboard-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		color: #556677;
		font-family: var(--hud-font, monospace);
		font-size: 0.7rem;
		letter-spacing: 2px;
		margin-bottom: 12px;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: #00ff88;
	}

	.back-arrow {
		font-size: 1rem;
	}

	.header-logo {
		width: 20px;
		height: 20px;
		border-radius: 4px;
	}

	.header-org {
		font-weight: 700;
	}

	.leaderboard-title {
		font-family: var(--hud-font, monospace);
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: 6px;
		margin: 16px 0 6px;
		background: linear-gradient(135deg, #00ff88, #4488ff);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		filter: drop-shadow(0 0 20px rgba(0, 255, 136, 0.3));
	}

	.leaderboard-subtitle {
		font-family: var(--hud-font, monospace);
		font-size: 0.65rem;
		color: #556677;
		letter-spacing: 4px;
		margin: 0;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 60px 20px;
	}

	.empty-icon {
		font-size: 3rem;
		color: #334455;
		margin-bottom: 16px;
	}

	.empty-text {
		font-family: var(--hud-font, monospace);
		font-size: 0.85rem;
		color: #556677;
		margin-bottom: 24px;
	}

	/* Table */
	.leaderboard-table {
		background: rgba(0, 20, 40, 0.4);
		border: 1px solid rgba(0, 180, 255, 0.1);
		border-radius: 8px;
		overflow: hidden;
	}

	.table-header {
		display: grid;
		grid-template-columns: 70px 1fr 100px 60px 80px;
		padding: 12px 16px;
		font-family: var(--hud-font, monospace);
		font-size: 0.55rem;
		color: #445566;
		letter-spacing: 2px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(0, 0, 0, 0.2);
	}

	.table-row {
		display: grid;
		grid-template-columns: 70px 1fr 100px 60px 80px;
		padding: 10px 16px;
		font-family: var(--hud-font, monospace);
		font-size: 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
		transition: background 0.15s;
	}

	.table-row:hover {
		background: rgba(0, 255, 136, 0.03);
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.col-rank {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.rank-num {
		color: #556677;
	}

	.rank-icon {
		font-size: 0.8rem;
	}

	.col-player {
		color: #aabbcc;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-score {
		color: #00ff88;
		text-align: right;
		text-shadow: 0 0 8px rgba(0, 255, 136, 0.3);
	}

	.col-wave {
		color: #88aacc;
		text-align: center;
	}

	.col-date {
		color: #445566;
		text-align: right;
		font-size: 0.6rem;
	}

	/* Rank highlight */
	.rank-gold .rank-icon { color: #ffdd00; text-shadow: 0 0 10px rgba(255, 221, 0, 0.5); }
	.rank-gold .col-player { color: #ffdd00; }
	.rank-gold .col-score { color: #ffdd00; text-shadow: 0 0 10px rgba(255, 221, 0, 0.5); }
	.rank-gold { background: rgba(255, 221, 0, 0.03); }

	.rank-silver .rank-icon { color: #c0c0c0; text-shadow: 0 0 8px rgba(192, 192, 192, 0.4); }
	.rank-silver .col-player { color: #c0c0c0; }
	.rank-silver { background: rgba(192, 192, 192, 0.02); }

	.rank-bronze .rank-icon { color: #cd7f32; text-shadow: 0 0 8px rgba(205, 127, 50, 0.4); }
	.rank-bronze .col-player { color: #cd7f32; }
	.rank-bronze { background: rgba(205, 127, 50, 0.02); }

	/* Footer */
	.leaderboard-footer {
		text-align: center;
		padding: 24px 0;
	}

	.play-link {
		display: inline-block;
		font-family: var(--hud-font, monospace);
		font-size: 0.8rem;
		letter-spacing: 2px;
		padding: 12px 32px;
		border: 1px solid rgba(0, 255, 136, 0.4);
		border-radius: 4px;
		background: rgba(0, 255, 136, 0.1);
		color: #00ff88;
		text-decoration: none;
		transition: all 0.2s;
	}

	.play-link:hover {
		background: rgba(0, 255, 136, 0.2);
		box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
	}

	/* Responsive: collapse date + wave on small screens */
	@media (max-width: 540px) {
		.table-header,
		.table-row {
			grid-template-columns: 50px 1fr 80px;
		}

		.col-wave,
		.col-date {
			display: none;
		}

		.leaderboard-title {
			font-size: 1.5rem;
			letter-spacing: 4px;
		}
	}
</style>
