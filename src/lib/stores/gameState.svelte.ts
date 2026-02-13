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
	phase = $state<'welcome' | 'playing' | 'paused' | 'gameover' | 'lobby'>('welcome');
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

	// Multiplayer death screen state
	multiplayerDead = $state(false);
	roomStats = $state<{
		playerCount: number;
		aliveCount: number;
		players: Array<{ id: string; username: string; score: number; health: number; maxHealth: number; }>;
		wave: number;
		puzzleProgress: number;
		puzzleSolved: boolean;
		canRejoin: boolean;
		roomClosed?: boolean;
	} | null>(null);

	/** Room-ended data sent when the entire room is over (all players dead). */
	roomEndData = $state<{
		reason: string;
		duration: number;
		finalWave: number;
		finalPuzzleProgress: number;
		players: Array<{ id: string; username: string; score: number; }>;
		eventLog: Array<{ time: number; event: string; actor?: string; detail?: string; }>;
	} | null>(null);

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

	// Shield system
	shieldHealth = $state(0);
	maxShieldHealth = $state(100);
	shieldHitFlash = $state(0); // 0..1 flash intensity when shield absorbs a hit

	// Health change animation: 'heal' | 'damage' | null
	healthChange = $state<'heal' | 'damage' | null>(null);
	previousHealth = $state(100);

	// Lobby (waiting room) state
	lobbyState = $state<{
		roomCode: string;
		hostId: string;
		isPrivate: boolean;
		players: Array<{ id: string; username: string; avatarUrl?: string; }>;
	} | null>(null);

	get healthPercent(): number {
		return (this.health / this.maxHealth) * 100;
	}

	get isAlive(): boolean {
		return this.health > 0;
	}

	get hasMultishot(): boolean {
		return this.activeBuffs.some(b => b.type === 'multishot' && Date.now() < b.expiresAt);
	}

	get hasSpeed(): boolean {
		return this.activeBuffs.some(b => b.type === 'speed' && Date.now() < b.expiresAt);
	}

	get hasShield(): boolean {
		return this.shieldHealth > 0 && this.activeBuffs.some(b => b.type === 'shield' && Date.now() < b.expiresAt);
	}

	get shieldPercent(): number {
		return this.maxShieldHealth > 0 ? (this.shieldHealth / this.maxShieldHealth) * 100 : 0;
	}

	/**
	 * Apply damage to the shield first. Returns any overflow damage that passes through.
	 * Also triggers shield hit flash. If shield HP reaches 0, removes the shield buff.
	 */
	applyShieldDamage(damage: number): number {
		if (!this.hasShield) return damage;
		this.shieldHitFlash = 1;
		if (damage >= this.shieldHealth) {
			const overflow = damage - this.shieldHealth;
			this.shieldHealth = 0;
			// Remove the shield buff since HP is depleted
			this.activeBuffs = this.activeBuffs.filter(b => b.type !== 'shield');
			return overflow;
		}
		this.shieldHealth -= damage;
		return 0; // fully absorbed
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

		// Initialize shield health when adding a shield buff
		if (type === 'shield') {
			this.shieldHealth = this.maxShieldHealth;
		}

		// Auto-remove when expired
		setTimeout(() => {
			this.activeBuffs = this.activeBuffs.filter(b => b !== buff);
			// Clear shield HP when the buff expires
			if (type === 'shield') {
				this.shieldHealth = 0;
			}
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
		const hadShield = this.activeBuffs.some(b => b.type === 'shield');
		this.activeBuffs = this.activeBuffs.filter(b => now < b.expiresAt);
		const hasShieldNow = this.activeBuffs.some(b => b.type === 'shield');
		if (hadShield && !hasShieldNow) {
			this.shieldHealth = 0;
		}
		if (this.activeBuffs.length !== before) {
			// Trigger reactivity
			this.activeBuffs = [...this.activeBuffs];
		}

		// Decay shield hit flash
		if (this.shieldHitFlash > 0) {
			this.shieldHitFlash = Math.max(0, this.shieldHitFlash - 0.05);
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
		this.shieldHealth = 0;
		this.shieldHitFlash = 0;
		this.multiplayerDead = false;
		this.roomStats = null;
		this.roomEndData = null;
		this.lobbyState = null;
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
