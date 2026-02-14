import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const WORKER_URL = 'http://127.0.0.1:4202';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 4201,
		proxy: {
			// Proxy WebSocket (and HTTP) requests to the game-worker so
			// Durable Object connections work in local dev.
			'/api/game/lobby': {
				target: WORKER_URL,
				ws: true,
				rewrite: () => '/lobby'
			},
			'/api/game/ws': {
				target: WORKER_URL,
				ws: true,
				rewrite: (path) => path.replace('/api/game', '')
			},
			'/api/game/admin-ws': {
				target: WORKER_URL,
				ws: true,
				rewrite: () => '/admin-ws'
			}
		}
	},
	preview: {
		port: 4201
	},
	ssr: {
		noExternal: ['three', '@threlte/core', '@threlte/extras']
	}
});
