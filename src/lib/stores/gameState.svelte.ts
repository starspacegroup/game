// ============================================
// Active buff / debuff system
// ============================================

export type BuffType = 'speed' | 'shield' | 'multishot';

export interface ActiveBuff {
	type: BuffType;
	label: string;
	icon: string;
	color: string;
	startedAt: number;
	expiresAt: number;
	/** 0..1 remaining fraction */
	get remaining(): number;
}

class BuffInstance implements ActiveBuff {
	type: BuffType;
	label: string;
	icon: string;
	color: string;
	startedAt: number;
	expiresAt: number;

	constructor(type: BuffType, label: string, icon: string, color: string, durationMs: number) {
		this.type = type;
		this.label = label;
		this.icon = icon;
		this.color = color;
		this.startedAt = Date.now();
		this.expiresAt = this.startedAt + durationMs;
	}

	get remaining(): number {
		const now = Date.now();
		if (now >= this.expiresAt) return 0;
		return (this.expiresAt - now) / (this.expiresAt - this.startedAt);
	}
}

// ============================================
// Pickup notification system
// ============================================

export interface PickupNotification {
	id: number;
	type: 'health' | 'speed' | 'multishot' | 'shield';
	label: string;
	icon: string;
	color: string;
	detail: string;
	timestamp: number;
}

/** Reactive game state for UI updates */
let _notifTimer: ReturnType<typeof setTimeout> | null = null;

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

	// Active buffs (time-limited effects)
	activeBuffs = $state<ActiveBuff[]>([]);

	// Pickup notifications (animated toasts)
	pickupNotifications = $state<PickupNotification[]>([]);
	private nextNotifId = 0;

	// Health change animation: 'heal' | 'damage' | null
	healthChange = $state<'heal' | 'damage' | null>(null);
	previousHealth = $state(100);

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

	/** Add a buff with duration; replaces existing buff of same type */
	addBuff(type: BuffType, durationMs: number): void {
		// Remove existing buff of same type
		this.activeBuffs = this.activeBuffs.filter(b => b.type !== type);

		const meta = BUFF_META[type];
		const buff = new BuffInstance(type, meta.label, meta.icon, meta.color, durationMs);
		this.activeBuffs = [...this.activeBuffs, buff];

		// Auto-remove when expired
		setTimeout(() => {
			this.activeBuffs = this.activeBuffs.filter(b => b !== buff);
		}, durationMs + 100);
	}

	/** Show a pickup notification toast (only one at a time, replaces previous) */
	notifyPickup(type: 'health' | 'speed' | 'multishot' | 'shield', detail: string): void {
		const meta = PICKUP_META[type];
		const notif: PickupNotification = {
			id: this.nextNotifId++,
			type,
			label: meta.label,
			icon: meta.icon,
			color: meta.color,
			detail,
			timestamp: Date.now()
		};
		// Replace — only one notification visible at a time
		this.pickupNotifications = [notif];

		// Clear any pending removal timer
		if (_notifTimer) clearTimeout(_notifTimer);

		// Auto-remove after animation
		_notifTimer = setTimeout(() => {
			this.pickupNotifications = [];
			_notifTimer = null;
		}, 2500);
	}

	/** Trigger health bar flash animation for healing */
	flashHealth(): void {
		this.healthChange = 'heal';
		setTimeout(() => {
			this.healthChange = null;
		}, 700);
	}

	/** Trigger health bar flash animation for damage */
	flashDamage(): void {
		this.healthChange = 'damage';
		setTimeout(() => {
			this.healthChange = null;
		}, 700);
	}

	/** Prune expired buffs (call from game loop) */
	tickBuffs(): void {
		const now = Date.now();
		const before = this.activeBuffs.length;
		this.activeBuffs = this.activeBuffs.filter(b => now < b.expiresAt);
		if (this.activeBuffs.length !== before) {
			// Trigger reactivity
			this.activeBuffs = [...this.activeBuffs];
		}
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
		this.activeBuffs = [];
		this.pickupNotifications = [];
		this.healthChange = null;
		this.previousHealth = 100;
	}
}

// Metadata for buff types
const BUFF_META: Record<BuffType, { label: string; icon: string; color: string; }> = {
	speed: { label: 'SPEED BOOST', icon: '⚡', color: '#ffdd00' },
	shield: { label: 'SHIELD', icon: '🛡️', color: '#4488ff' },
	multishot: { label: 'MULTI-SHOT', icon: '✦', color: '#ff44ff' },
};

// Metadata for pickup notification types
const PICKUP_META: Record<string, { label: string; icon: string; color: string; }> = {
	health: { label: 'REPAIR', icon: '✚', color: '#44ff44' },
	speed: { label: 'SPEED BOOST', icon: '⚡', color: '#ffdd00' },
	multishot: { label: 'MULTI-SHOT', icon: '✦', color: '#ff44ff' },
	shield: { label: 'SHIELD', icon: '🛡️', color: '#4488ff' },
};

export const gameState = new GameStore();
