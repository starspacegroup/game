/** Reactive game state for UI updates */
class GameStore {
	phase = $state<'welcome' | 'playing' | 'paused' | 'gameover'>('welcome');
	mode = $state<'solo' | 'multiplayer'>('solo');
	score = $state(0);
	health = $state(100);
	maxHealth = $state(100);
	wave = $state(1);
	playerCount = $state(1);
	npcCount = $state(2);
	puzzleProgress = $state(0);
	puzzleRevealed = $state(false);
	puzzleSolved = $state(false);
	showChat = $state(false);
	messages = $state<{ sender: string; text: string; time: number; }[]>([]);
	isMobile = $state(false);
	isFullscreen = $state(false);

	// Conversion system
	convertedNpcCount = $state(0);
	hints = $state<{ nodeId: string; hint: string; timestamp: number; }[]>([]);
	latestHint = $state<string | null>(null);
	dataCollected = $state(0); // Total data fragments collected from converted NPCs

	get healthPercent(): number {
		return (this.health / this.maxHealth) * 100;
	}

	get isAlive(): boolean {
		return this.health > 0;
	}

	addHint(nodeId: string, hint: string): void {
		this.hints.push({ nodeId, hint, timestamp: Date.now() });
		this.latestHint = hint;
		this.dataCollected += 1;
		// Auto-clear latest hint after 5 seconds
		setTimeout(() => {
			if (this.latestHint === hint) {
				this.latestHint = null;
			}
		}, 5000);
	}

	reset(): void {
		this.phase = 'welcome';
		this.score = 0;
		this.health = 100;
		this.wave = 1;
		this.puzzleProgress = 0;
		this.puzzleRevealed = false;
		this.puzzleSolved = false;
		this.messages = [];
		this.convertedNpcCount = 0;
		this.hints = [];
		this.latestHint = null;
		this.dataCollected = 0;
	}
}

export const gameState = new GameStore();
