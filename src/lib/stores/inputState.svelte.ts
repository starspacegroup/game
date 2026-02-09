/** Input state — updated by keyboard/touch handlers every frame */
class InputStore {
	moveX = $state(0);
	moveY = $state(0);
	aimX = $state(0);
	aimY = $state(0);
	shooting = $state(false);
	boost = $state(false);
	interact = $state(false);
}

export const inputState = new InputStore();

const keys = new Set<string>();

function updateFromKeys(): void {
	let mx = 0;
	let my = 0;
	if (keys.has('w') || keys.has('arrowup')) my = 1;
	if (keys.has('s') || keys.has('arrowdown')) my = -1;
	if (keys.has('a') || keys.has('arrowleft')) mx = -1;
	if (keys.has('d') || keys.has('arrowright')) mx = 1;
	inputState.moveX = mx;
	inputState.moveY = my;
}

function clearAllInputs(): void {
	keys.clear();
	inputState.moveX = 0;
	inputState.moveY = 0;
	inputState.shooting = false;
	inputState.boost = false;
	inputState.interact = false;
}

export function setupKeyboardControls(): () => void {
	function onKeyDown(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		keys.add(key);
		updateFromKeys();
		if (e.key === ' ') {
			inputState.shooting = true;
			e.preventDefault();
		}
		if (key === 'e') inputState.interact = true;
		if (key === 'shift') inputState.boost = true;
	}

	function onKeyUp(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		keys.delete(key);
		updateFromKeys();
		if (e.key === ' ') inputState.shooting = false;
		if (key === 'e') inputState.interact = false;
		if (key === 'shift') inputState.boost = false;
	}

	function onBlur(): void {
		clearAllInputs();
	}

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);

	return () => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', onBlur);
		keys.clear();
	};
}

export function setupMouseControls(canvas: HTMLElement): () => void {
	function onMove(e: MouseEvent): void {
		const rect = canvas.getBoundingClientRect();
		inputState.aimX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		inputState.aimY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
	}

	function onDown(): void {
		inputState.shooting = true;
	}
	function onUp(): void {
		inputState.shooting = false;
	}

	canvas.addEventListener('mousemove', onMove);
	canvas.addEventListener('mousedown', onDown);
	canvas.addEventListener('mouseup', onUp);

	return () => {
		canvas.removeEventListener('mousemove', onMove);
		canvas.removeEventListener('mousedown', onDown);
		canvas.removeEventListener('mouseup', onUp);
	};
}
