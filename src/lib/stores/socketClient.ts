import { io, type Socket } from 'socket.io-client';
import { gameState } from './gameState.svelte';
import { world } from '$lib/game/world';

let socket: Socket | null = null;

export function connectToServer(serverUrl: string = 'http://localhost:3001'): void {
	if (socket?.connected) return;

	try {
		socket = io(serverUrl, {
			transports: ['websocket'],
			autoConnect: true,
			reconnection: true,
			reconnectionAttempts: 3,
			timeout: 5000
		});

		socket.on('connect', () => {
			console.log('[Starspace] Connected to server:', socket?.id);
			gameState.mode = 'multiplayer';
		});

		socket.on('disconnect', () => {
			console.log('[Starspace] Disconnected from server');
			gameState.mode = 'solo';
		});

		socket.on('player-joined', (data: { id: string; count: number }) => {
			gameState.playerCount = data.count;
			gameState.npcCount = Math.max(0, 5 - (data.count - 1));
		});

		socket.on('player-left', (data: { id: string; count: number }) => {
			gameState.playerCount = data.count;
			gameState.npcCount = Math.max(0, 5 - (data.count - 1));
		});

		socket.on(
			'game-state',
			(data: { puzzleProgress?: number; wave?: number }) => {
				if (data.puzzleProgress !== undefined) {
					gameState.puzzleProgress = data.puzzleProgress;
				}
				if (data.wave !== undefined) {
					gameState.wave = data.wave;
				}
			}
		);

		socket.on(
			'player-position',
			(_data: {
				id: string;
				x: number;
				y: number;
				z: number;
				rx: number;
				ry: number;
				rz: number;
			}) => {
				// TODO: update other player ship positions for rendering
			}
		);

		socket.on('chat', (data: { sender: string; text: string }) => {
			gameState.messages = [...gameState.messages, { ...data, time: Date.now() }];
		});

		socket.on('connect_error', () => {
			console.log('[Starspace] Server not available, solo mode');
			gameState.mode = 'solo';
			socket?.disconnect();
		});
	} catch {
		console.log('[Starspace] Socket.io unavailable, solo mode');
		gameState.mode = 'solo';
	}
}

export function sendPosition(): void {
	if (!socket?.connected) return;
	socket.emit('position', {
		x: world.player.position.x,
		y: world.player.position.y,
		z: world.player.position.z,
		rx: world.player.rotation.x,
		ry: world.player.rotation.y,
		rz: world.player.rotation.z
	});
}

export function sendPuzzleAction(nodeId: string, action: string): void {
	if (!socket?.connected) return;
	socket.emit('puzzle-action', { nodeId, action });
}

export function sendChat(text: string): void {
	if (!socket?.connected) return;
	socket.emit('chat', { text });
}

export function disconnect(): void {
	socket?.disconnect();
	socket = null;
}
