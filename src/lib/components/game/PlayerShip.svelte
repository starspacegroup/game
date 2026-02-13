<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { world, getPlayerOrientation } from '$lib/game/world';
	import { authState } from '$lib/stores/authState.svelte';
	import { gameState } from '$lib/stores/gameState.svelte';
	import ShieldBubble from './ShieldBubble.svelte';
	import SpeedLines from './SpeedLines.svelte';

	const BUFF_COLORS: Record<string, string> = {
		speed: '#ffdd00',
		shield: '#4488ff',
		multishot: '#ff44ff',
	};

	let rootGroup: THREE.Group | undefined = $state();
	let shipMesh: THREE.Mesh | undefined = $state();
	let engineGlow = 0.5;
	let engineMesh: THREE.Mesh | undefined = $state();
	let labelSprite: THREE.Sprite | undefined = $state();
	let avatarSprite: THREE.Sprite | undefined = $state();

	// Avatar system
	const AVATAR_SIZE = 1.25; // 50% of ship width (2.5)
	const AVATAR_CANVAS_SIZE = 128;
	let avatarTexture: THREE.CanvasTexture | undefined;
	let avatarLoaded = false;
	let lastAvatarUrl = '';

	function loadAvatar(url: string): void {
		if (!url || url === lastAvatarUrl) return;
		lastAvatarUrl = url;

		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = AVATAR_CANVAS_SIZE;
			canvas.height = AVATAR_CANVAS_SIZE;
			const ctx = canvas.getContext('2d')!;

			// Draw circular clipped avatar
			ctx.beginPath();
			ctx.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 2, 0, Math.PI * 2);
			ctx.closePath();
			ctx.clip();
			ctx.drawImage(img, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);

			// Draw border ring
			ctx.beginPath();
			ctx.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 2, 0, Math.PI * 2);
			ctx.strokeStyle = '#00ffff';
			ctx.lineWidth = 3;
			ctx.stroke();

			if (!avatarTexture) {
				avatarTexture = new THREE.CanvasTexture(canvas);
				avatarTexture.colorSpace = THREE.SRGBColorSpace;
			} else {
				avatarTexture.image = canvas;
			}
			avatarTexture.needsUpdate = true;
			avatarLoaded = true;

			if (avatarSprite) {
				(avatarSprite.material as THREE.SpriteMaterial).map = avatarTexture;
				(avatarSprite.material as THREE.SpriteMaterial).needsUpdate = true;
			}
		};
		img.src = url;
	}

	// Canvas label system
	const CANVAS_W = 256;
	const CANVAS_H = 128;
	const labelCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
	if (labelCanvas) {
		labelCanvas.width = CANVAS_W;
		labelCanvas.height = CANVAS_H;
	}
	let labelTexture: THREE.CanvasTexture | undefined;

	// Smooth health animation
	let displayedHealth = 100;
	let lastHealth = -1;
	let healthFlashTimer = 0;
	let healthFlashType: 'heal' | 'damage' | null = null;

	// Track last drawn state for change detection
	let lastUsername = '';
	let lastBuffKey = '';
	let lastFrameDrawn = 0;

	// Load the ship texture
	const textureLoader = new THREE.TextureLoader();
	const shipTexture = textureLoader.load('/ship-64.png');
	shipTexture.colorSpace = THREE.SRGBColorSpace;

	/** Draw a speed buff icon (lightning bolt shape) */
	function drawSpeedIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
		ctx.save();
		ctx.fillStyle = BUFF_COLORS.speed + '66';
		ctx.strokeStyle = BUFF_COLORS.speed;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// Lightning bolt
		const s = r * 0.55;
		ctx.fillStyle = BUFF_COLORS.speed;
		ctx.beginPath();
		ctx.moveTo(cx + s * 0.1, cy - s * 1.1);
		ctx.lineTo(cx - s * 0.5, cy + s * 0.1);
		ctx.lineTo(cx + s * 0.05, cy + s * 0.1);
		ctx.lineTo(cx - s * 0.1, cy + s * 1.1);
		ctx.lineTo(cx + s * 0.5, cy - s * 0.1);
		ctx.lineTo(cx - s * 0.05, cy - s * 0.1);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	/** Draw a shield buff icon (shield shape) */
	function drawShieldIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
		ctx.save();
		ctx.fillStyle = BUFF_COLORS.shield + '66';
		ctx.strokeStyle = BUFF_COLORS.shield;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// Shield shape
		const s = r * 0.6;
		ctx.fillStyle = BUFF_COLORS.shield;
		ctx.beginPath();
		ctx.moveTo(cx, cy - s);
		ctx.lineTo(cx + s * 0.85, cy - s * 0.4);
		ctx.lineTo(cx + s * 0.7, cy + s * 0.3);
		ctx.lineTo(cx, cy + s);
		ctx.lineTo(cx - s * 0.7, cy + s * 0.3);
		ctx.lineTo(cx - s * 0.85, cy - s * 0.4);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	/** Draw a multishot buff icon (three-dot spread) */
	function drawMultishotIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
		ctx.save();
		ctx.fillStyle = BUFF_COLORS.multishot + '66';
		ctx.strokeStyle = BUFF_COLORS.multishot;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// Three spread dots
		const s = r * 0.3;
		ctx.fillStyle = BUFF_COLORS.multishot;
		ctx.beginPath();
		ctx.arc(cx, cy - s * 1.2, s, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(cx - s * 1.4, cy + s * 0.8, s, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(cx + s * 1.4, cy + s * 0.8, s, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	const BUFF_DRAW: Record<string, (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void> = {
		speed: drawSpeedIcon,
		shield: drawShieldIcon,
		multishot: drawMultishotIcon,
	};

	function drawLabel(username: string, healthPct: number, flashType: 'heal' | 'damage' | null, flashIntensity: number, buffTypes: string[]): void {
		if (!labelCanvas) return;
		const ctx = labelCanvas.getContext('2d')!;
		ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

		const hasBuffs = buffTypes.length > 0;
		const hasShield = gameState.hasShield;
		const pillH = hasBuffs ? (hasShield ? 104 : 90) : (hasShield ? 78 : 64);

		// Background pill
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.beginPath();
		ctx.roundRect(16, 4, 224, pillH, 8);
		ctx.fill();

		// Username text - cyan for local player
		ctx.font = 'bold 22px Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#00ffff';
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 2.5;
		ctx.strokeText(username, 128, 24);
		ctx.fillText(username, 128, 24);

		// Health bar background
		const barX = 36;
		const barY = 44;
		const barW = 184;
		const barH = 10;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
		ctx.beginPath();
		ctx.roundRect(barX, barY, barW, barH, 4);
		ctx.fill();

		// Health bar fill
		const fillW = Math.max(0, Math.min(1, healthPct)) * barW;
		let barColor: string;
		if (healthPct < 0.25) barColor = '#ff4444';
		else if (healthPct < 0.5) barColor = '#ffaa00';
		else barColor = '#00ff88';

		if (fillW > 0) {
			ctx.fillStyle = barColor;
			ctx.beginPath();
			ctx.roundRect(barX, barY, fillW, barH, 4);
			ctx.fill();
		}

		// Flash overlay on health change
		if (flashType && flashIntensity > 0) {
			const flashColor = flashType === 'heal' ? '#44ff44' : '#ff4444';
			ctx.save();
			ctx.globalAlpha = flashIntensity * 0.6;
			ctx.fillStyle = flashColor;
			ctx.beginPath();
			ctx.roundRect(barX, barY, barW, barH, 4);
			ctx.fill();
			ctx.globalAlpha = 1;

			// Glow
			ctx.shadowColor = flashColor;
			ctx.shadowBlur = 12 * flashIntensity;
			ctx.strokeStyle = flashColor;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.roundRect(barX, barY, barW, barH, 4);
			ctx.stroke();
			ctx.restore();
		}

		// Shield health bar (below health bar, only when shield active)
		let shieldBarBottom = barY + barH;
		if (hasShield) {
			const sBarY = barY + barH + 4;
			const sBarH = 6;
			const shieldPct = gameState.shieldPercent / 100;
			const sFillW = Math.max(0, Math.min(1, shieldPct)) * barW;

			// Shield bar label
			ctx.font = 'bold 8px "Courier New", monospace';
			ctx.textAlign = 'left';
			ctx.fillStyle = '#4488ff';
			ctx.fillText('🛡', barX - 2, sBarY + sBarH / 2 + 1);

			// Shield bar background
			ctx.fillStyle = 'rgba(68, 136, 255, 0.15)';
			ctx.beginPath();
			ctx.roundRect(barX, sBarY, barW, sBarH, 3);
			ctx.fill();

			// Shield bar fill
			if (sFillW > 0) {
				ctx.fillStyle = shieldPct < 0.25 ? '#ff6644' : '#4488ff';
				ctx.beginPath();
				ctx.roundRect(barX, sBarY, sFillW, sBarH, 3);
				ctx.fill();
			}

			// Shield hit flash
			const shieldFlash = gameState.shieldHitFlash;
			if (shieldFlash > 0) {
				ctx.save();
				ctx.globalAlpha = shieldFlash * 0.7;
				ctx.fillStyle = '#88ccff';
				ctx.beginPath();
				ctx.roundRect(barX, sBarY, barW, sBarH, 3);
				ctx.fill();
				ctx.restore();
			}

			shieldBarBottom = sBarY + sBarH;
		}

		// Buff icons row
		if (hasBuffs) {
			const iconR = 11;
			const gap = 8;
			const totalW = buffTypes.length * iconR * 2 + (buffTypes.length - 1) * gap;
			let startX = 128 - totalW / 2 + iconR;
			const iconY = shieldBarBottom + 12;

			for (const bType of buffTypes) {
				const drawFn = BUFF_DRAW[bType];
				if (drawFn) {
					drawFn(ctx, startX, iconY, iconR);
				}
				startX += iconR * 2 + gap;
			}
		}

		// Update texture
		if (!labelTexture) {
			labelTexture = new THREE.CanvasTexture(labelCanvas);
		}
		labelTexture.needsUpdate = true;
	}

	useTask((delta) => {
		if (!rootGroup) return;

		// Position on sphere surface and orient tangent to sphere
		rootGroup.position.copy(world.player.position);
		rootGroup.quaternion.copy(getPlayerOrientation());

		// Load avatar once available
		const avatarUrl = authState.avatarUrl;
		if (avatarUrl && !avatarLoaded) {
			loadAvatar(avatarUrl);
		}

		// Blink during invincibility
		const isInvincible = Date.now() < world.player.damageCooldownUntil;
		if (isInvincible) {
			rootGroup.visible = Math.floor(Date.now() / 125) % 2 === 0;
		} else {
			rootGroup.visible = true;
		}

		// Rotate only the ship mesh within the tangent plane
		if (shipMesh) {
			shipMesh.rotation.z = world.player.rotation.z;
		}

		// Engine effect
		const speed = world.player.velocity.length();
		const targetGlow = 0.3 + Math.min(speed / 20, 1) * 0.7;
		engineGlow += (targetGlow - engineGlow) * 5 * delta;
		if (engineMesh) {
			(engineMesh.material as THREE.MeshBasicMaterial).opacity = engineGlow;
		}

		// --- Label rendering ---
		if (!labelSprite) return;

		const username = authState.username || 'Player';
		const health = gameState.health;
		const maxHealth = gameState.maxHealth;

		// Detect health changes for flash animation
		if (lastHealth >= 0 && health !== lastHealth) {
			healthFlashType = health > lastHealth ? 'heal' : 'damage';
			healthFlashTimer = 1.0;
		}
		lastHealth = health;

		// Smooth health animation (lerp displayed health toward actual)
		const targetPct = maxHealth > 0 ? health / maxHealth : 0;
		const currentPct = maxHealth > 0 ? displayedHealth / maxHealth : 0;
		displayedHealth += (health - displayedHealth) * Math.min(1, delta * 8);

		// Decay flash
		if (healthFlashTimer > 0) {
			healthFlashTimer = Math.max(0, healthFlashTimer - delta * 2.5);
			if (healthFlashTimer <= 0) {
				healthFlashType = null;
			}
		}

		// Gather active buffs
		const now = Date.now();
		const buffTypes: string[] = [];
		for (const b of gameState.activeBuffs) {
			if (now < b.expiresAt) buffTypes.push(b.type);
		}
		const buffKey = buffTypes.join(',');

		// Determine if we need to redraw
		const displayedPct = maxHealth > 0 ? displayedHealth / maxHealth : 0;
		const healthAnimating = Math.abs(displayedHealth - health) > 0.5;
		const flashing = healthFlashTimer > 0;
		const shieldChanged = gameState.hasShield || gameState.shieldHitFlash > 0;
		const needsRedraw = username !== lastUsername || buffKey !== lastBuffKey || healthAnimating || flashing || shieldChanged || (lastFrameDrawn > 0 && now - lastFrameDrawn > 500);

		if (needsRedraw || buffKey !== lastBuffKey || username !== lastUsername || Math.abs(targetPct - currentPct) > 0.005) {
			lastUsername = username;
			lastBuffKey = buffKey;
			lastFrameDrawn = now;

			drawLabel(username, displayedPct, healthFlashType, healthFlashTimer, buffTypes);

			// Update sprite scale and material
			const hasBuffs = buffTypes.length > 0;
			const hasShield = gameState.hasShield;
			const spriteH = hasBuffs ? (hasShield ? 2.1 : 1.8) : (hasShield ? 1.55 : 1.25);
			labelSprite.scale.set(4, spriteH, 1);

			if (labelTexture) {
				(labelSprite.material as THREE.SpriteMaterial).map = labelTexture;
				(labelSprite.material as THREE.SpriteMaterial).needsUpdate = true;
			}
		}
	});
</script>

<!-- Root group: positioned at player, NO rotation -->
<T.Group bind:ref={rootGroup}>
	<!-- Ship plane: rotates with player direction -->
	<T.Mesh bind:ref={shipMesh}>
		<T.PlaneGeometry args={[2.5, 2.5]} />
		<T.MeshBasicMaterial 
			map={shipTexture} 
			transparent={true}
			side={THREE.DoubleSide}
			depthTest={true}
			depthWrite={false}
		/>
	</T.Mesh>

	<!-- Engine glow behind ship -->
	<T.Mesh position.z={-0.5} scale={[0.4, 0.4, 1]} bind:ref={engineMesh}>
		<T.SphereGeometry args={[0.5, 6, 6]} />
		<T.MeshBasicMaterial color="#44ffaa" transparent opacity={0.5} />
	</T.Mesh>

	<!-- Speed lines (visible when speed buff active and moving) -->
	<SpeedLines />

	<!-- Shield bubble (visible when shield buff active) -->
	<ShieldBubble />

	<!-- Discord avatar centered on ship -->
	<T.Sprite
		position.z={0.15}
		scale={[AVATAR_SIZE, AVATAR_SIZE, 1]}
		bind:ref={avatarSprite}
	>
		<T.SpriteMaterial transparent depthTest={true} depthWrite={false} opacity={0.9} />
	</T.Sprite>

	<!-- Username + health label: ALWAYS above ship, does NOT rotate -->
	<T.Sprite 
		position.y={2.8} 
		position.z={0.5}
		scale={[4, 1.25, 1]}
		bind:ref={labelSprite}
	>
		<T.SpriteMaterial transparent depthTest={false} />
	</T.Sprite>
</T.Group>
