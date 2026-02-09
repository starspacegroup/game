import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 4201
	},
	preview: {
		port: 4201
	},
	ssr: {
		noExternal: ['three', '@threlte/core', '@threlte/extras']
	}
});
