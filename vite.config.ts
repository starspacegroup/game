import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite plugin that rebundles _worker.js with GameRoom DO export
 * after adapter-cloudflare finishes. This lets Pages host the DO
 * class from a single `vite build` command.
 */
function injectDurableObjects(): Plugin {
	return {
		name: 'inject-durable-objects',
		apply: 'build',
		enforce: 'post',
		async closeBundle() {
			const outDir = resolve('.svelte-kit/cloudflare');
			const workerPath = resolve(outDir, '_worker.js');
			if (!existsSync(workerPath)) return;

			// Check if GameRoom is already exported
			const existing = readFileSync(workerPath, 'utf-8');
			if (existing.includes('GameRoom')) return;

			// Rename the adapter's output so our wrapper can import it
			const appPath = resolve(outDir, '_sveltekit-app.js');
			renameSync(workerPath, appPath);

			// Create a wrapper that re-exports SvelteKit + GameRoom
			const wrapperPath = resolve(outDir, '_worker-wrapper.mjs');
			writeFileSync(wrapperPath, [
				`export { GameRoom } from '../../src/lib/server/GameRoom';`,
				`import worker from './_sveltekit-app.js';`,
				`export default worker;`,
			].join('\n'));

			// Bundle with esbuild (already a dependency of adapter-cloudflare)
			const esbuild = await import('esbuild');
			await esbuild.build({
				entryPoints: [wrapperPath],
				bundle: true,
				outfile: workerPath,
				format: 'esm',
				platform: 'browser',
				target: 'es2022',
				external: ['*.wasm', 'cloudflare:*', 'node:*'],
				minify: false,
				sourcemap: true,
			});

			// Clean up temp files
			unlinkSync(appPath);
			unlinkSync(wrapperPath);

			console.log('✓ Injected GameRoom DO export into _worker.js');
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), injectDurableObjects()],
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
