<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { inputState } from '$lib/stores/inputState.svelte';

	// Track active touches for each joystick
	let leftStickActive = $state(false);
	let leftStickX = $state(0);
	let leftStickY = $state(0);
	let rightStickActive = $state(false);
	let rightStickX = $state(0);
	let rightStickY = $state(0);

	let leftTouchId: number | null = null;
	let rightTouchId: number | null = null;
	let leftOrigin = { x: 0, y: 0 };
	let rightOrigin = { x: 0, y: 0 };

	const STICK_RADIUS = 50;
	const DEAD_ZONE = 0.1;

	function handleTouchStart(e: TouchEvent): void {
		e.preventDefault();
		const screenMid = window.innerWidth / 2;

		for (const touch of e.changedTouches) {
			if (touch.clientX < screenMid && leftTouchId === null) {
				// Left joystick (movement)
				leftTouchId = touch.identifier;
				leftOrigin = { x: touch.clientX, y: touch.clientY };
				leftStickActive = true;
				leftStickX = 0;
				leftStickY = 0;
			} else if (touch.clientX >= screenMid && rightTouchId === null) {
				// Right joystick (aim + auto-shoot)
				rightTouchId = touch.identifier;
				rightOrigin = { x: touch.clientX, y: touch.clientY };
				rightStickActive = true;
				rightStickX = 0;
				rightStickY = 0;
				inputState.shooting = true;
			}
		}
	}

	function handleTouchMove(e: TouchEvent): void {
		e.preventDefault();

		for (const touch of e.changedTouches) {
			if (touch.identifier === leftTouchId) {
				const dx = touch.clientX - leftOrigin.x;
				const dy = touch.clientY - leftOrigin.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const clamped = Math.min(dist, STICK_RADIUS);
				const norm = dist > 0 ? clamped / STICK_RADIUS : 0;

				leftStickX = dist > 0 ? (dx / dist) * clamped : 0;
				leftStickY = dist > 0 ? (dy / dist) * clamped : 0;

				const mx = dist > 0 ? (dx / dist) * norm : 0;
				const my = dist > 0 ? -(dy / dist) * norm : 0;
				inputState.moveX = Math.abs(mx) > DEAD_ZONE ? mx : 0;
				inputState.moveY = Math.abs(my) > DEAD_ZONE ? my : 0;
			}

			if (touch.identifier === rightTouchId) {
				const dx = touch.clientX - rightOrigin.x;
				const dy = touch.clientY - rightOrigin.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const clamped = Math.min(dist, STICK_RADIUS);

				rightStickX = dist > 0 ? (dx / dist) * clamped : 0;
				rightStickY = dist > 0 ? (dy / dist) * clamped : 0;

				if (dist > DEAD_ZONE * STICK_RADIUS) {
					inputState.aimX = dx / dist;
					inputState.aimY = -(dy / dist);
				}
			}
		}
	}

	function handleTouchEnd(e: TouchEvent): void {
		for (const touch of e.changedTouches) {
			if (touch.identifier === leftTouchId) {
				leftTouchId = null;
				leftStickActive = false;
				leftStickX = 0;
				leftStickY = 0;
				inputState.moveX = 0;
				inputState.moveY = 0;
			}
			if (touch.identifier === rightTouchId) {
				rightTouchId = null;
				rightStickActive = false;
				rightStickX = 0;
				rightStickY = 0;
				inputState.shooting = false;
			}
		}
	}

	onMount(() => {
		document.addEventListener('touchstart', handleTouchStart, { passive: false });
		document.addEventListener('touchmove', handleTouchMove, { passive: false });
		document.addEventListener('touchend', handleTouchEnd);
		document.addEventListener('touchcancel', handleTouchEnd);
	});

	onDestroy(() => {
		document.removeEventListener('touchstart', handleTouchStart);
		document.removeEventListener('touchmove', handleTouchMove);
		document.removeEventListener('touchend', handleTouchEnd);
		document.removeEventListener('touchcancel', handleTouchEnd);
	});
</script>

<div class="joystick-overlay">
	<!-- Left joystick (movement) -->
	<div class="joystick left" class:active={leftStickActive}>
		<div class="joystick-base">
			<div
				class="joystick-knob"
				style="transform: translate({leftStickX}px, {leftStickY}px)"
			></div>
		</div>
		<span class="joystick-label">MOVE</span>
	</div>

	<!-- Right joystick (aim/shoot) -->
	<div class="joystick right" class:active={rightStickActive}>
		<div class="joystick-base">
			<div
				class="joystick-knob"
				style="transform: translate({rightStickX}px, {rightStickY}px)"
			></div>
		</div>
		<span class="joystick-label">AIM</span>
	</div>

	<!-- Interact button -->
	<button
		class="action-btn interact"
		ontouchstart={() => (inputState.interact = true)}
		ontouchend={() => (inputState.interact = false)}
	>
		E
	</button>

	<!-- Boost button -->
	<button
		class="action-btn boost"
		ontouchstart={() => (inputState.boost = true)}
		ontouchend={() => (inputState.boost = false)}
	>
		BOOST
	</button>
</div>

<style>
	/* ===== MOBILE-FIRST VIRTUAL JOYSTICK STYLES ===== */
	.joystick-overlay {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		pointer-events: none;
		z-index: 20;
		padding-bottom: calc(var(--safe-bottom, 0px) + 12px);
	}

	.joystick {
		position: fixed;
		/* Responsive bottom positioning based on screen height */
		bottom: max(60px, 10vh);
		pointer-events: all;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		opacity: 0.35;
		transition: opacity 0.2s;
	}

	.joystick.active {
		opacity: 0.7;
	}

	/* Mobile-first: smaller joysticks for small screens */
	.joystick.left {
		left: max(var(--safe-left, 0px), 8px) + 20px;
		left: calc(var(--safe-left, 0px) + 20px);
	}

	.joystick.right {
		right: calc(var(--safe-right, 0px) + 20px);
	}

	/* Responsive joystick base - smaller on mobile */
	.joystick-base {
		width: 90px;
		height: 90px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.2);
		background: rgba(255, 255, 255, 0.05);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
	}

	/* Responsive joystick knob */
	.joystick-knob {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: rgba(0, 255, 136, 0.4);
		border: 2px solid rgba(0, 255, 136, 0.6);
		transition: background 0.1s;
	}

	.joystick.right .joystick-knob {
		background: rgba(255, 68, 68, 0.4);
		border-color: rgba(255, 68, 68, 0.6);
	}

	.joystick-label {
		font-family: var(--hud-font, monospace);
		font-size: 0.5rem;
		color: rgba(255, 255, 255, 0.3);
		letter-spacing: 2px;
	}

	/* Action buttons - minimum touch target 44px */
	.action-btn {
		position: fixed;
		pointer-events: all;
		width: var(--touch-target-min, 44px);
		height: var(--touch-target-min, 44px);
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.5);
		font-family: var(--hud-font, monospace);
		font-size: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.action-btn.interact {
		right: calc(var(--safe-right, 0px) + 130px);
		bottom: max(80px, 12vh);
		border-color: rgba(68, 136, 255, 0.4);
	}

	.action-btn.boost {
		right: calc(var(--safe-right, 0px) + 130px);
		bottom: max(140px, 18vh);
		border-color: rgba(255, 170, 0, 0.4);
		font-size: 0.45rem;
	}

	.action-btn:active {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(0.95);
	}

	/* ===== LARGER PHONES (375px+) ===== */
	@media (min-width: 375px) {
		.joystick.left {
			left: calc(var(--safe-left, 0px) + 30px);
		}

		.joystick.right {
			right: calc(var(--safe-right, 0px) + 30px);
		}

		.joystick-base {
			width: 100px;
			height: 100px;
		}

		.joystick-knob {
			width: 40px;
			height: 40px;
		}

		.action-btn {
			width: 46px;
			height: 46px;
		}

		.action-btn.interact {
			right: calc(var(--safe-right, 0px) + 145px);
		}

		.action-btn.boost {
			right: calc(var(--safe-right, 0px) + 145px);
		}
	}

	/* ===== MEDIUM PHONES (414px+) ===== */
	@media (min-width: 414px) {
		.joystick {
			bottom: max(70px, 11vh);
		}

		.joystick.left {
			left: calc(var(--safe-left, 0px) + 35px);
		}

		.joystick.right {
			right: calc(var(--safe-right, 0px) + 35px);
		}

		.joystick-base {
			width: 110px;
			height: 110px;
		}

		.joystick-knob {
			width: 42px;
			height: 42px;
		}

		.action-btn {
			width: 48px;
			height: 48px;
			font-size: 0.65rem;
		}

		.action-btn.interact {
			right: calc(var(--safe-right, 0px) + 160px);
			bottom: max(90px, 13vh);
		}

		.action-btn.boost {
			right: calc(var(--safe-right, 0px) + 160px);
			bottom: max(155px, 20vh);
			font-size: 0.5rem;
		}
	}

	/* ===== LARGER PHONES (480px+) / LANDSCAPE ===== */
	@media (min-width: 480px) {
		.joystick {
			bottom: max(80px, 12vh);
		}

		.joystick.left {
			left: calc(var(--safe-left, 0px) + 40px);
		}

		.joystick.right {
			right: calc(var(--safe-right, 0px) + 40px);
		}

		.joystick-base {
			width: 120px;
			height: 120px;
		}

		.joystick-knob {
			width: 44px;
			height: 44px;
		}

		.joystick-label {
			font-size: 0.55rem;
		}

		.action-btn.interact {
			right: calc(var(--safe-right, 0px) + 170px);
			bottom: max(100px, 14vh);
		}

		.action-btn.boost {
			right: calc(var(--safe-right, 0px) + 170px);
			bottom: max(170px, 22vh);
		}
	}

	/* ===== LANDSCAPE MODE ADJUSTMENTS ===== */
	@media (orientation: landscape) and (max-height: 500px) {
		.joystick {
			bottom: max(40px, 8vh);
		}

		.joystick-base {
			width: 80px;
			height: 80px;
		}

		.joystick-knob {
			width: 32px;
			height: 32px;
		}

		.action-btn {
			width: 40px;
			height: 40px;
		}

		.action-btn.interact {
			bottom: max(50px, 10vh);
		}

		.action-btn.boost {
			bottom: max(100px, 18vh);
		}
	}
</style>
