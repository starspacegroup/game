import * as esbuild from 'esbuild';
import { renameSync, existsSync, unlinkSync } from 'fs';

// After `vite build`, adapter-cloudflare outputs _worker.js + static assets
// Rename _worker.js so our custom worker.ts can import it, then esbuild
// bundles everything (SvelteKit app + GameRoom DO) into dist/_worker.js
const sveltekitOutput = '.svelte-kit/cloudflare/_worker.js';
const renamedOutput = '.svelte-kit/cloudflare/_sveltekit-app.js';

if (!existsSync(sveltekitOutput)) {
  console.error('ERROR: .svelte-kit/cloudflare/_worker.js not found. Run `vite build` first.');
  process.exit(1);
}

renameSync(sveltekitOutput, renamedOutput);
console.log('Renamed _worker.js → _sveltekit-app.js');

await esbuild.build({
  entryPoints: ['worker.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  format: 'esm',
  platform: 'browser', // Cloudflare Workers use browser-like environment
  target: 'es2022',
  external: ['*.wasm', 'cloudflare:*', 'node:*'], // Don't bundle WASM, Cloudflare built-ins, or Node built-ins
  minify: false,
  sourcemap: true,
});

// Clean up intermediate files from the assets directory
unlinkSync(renamedOutput);
// Remove Pages-specific files that shouldn't be in the assets dir
for (const f of ['_routes.json', '_headers', '_redirects']) {
  const p = `.svelte-kit/cloudflare/${f}`;
  if (existsSync(p)) unlinkSync(p);
}

console.log('Worker bundled successfully → dist/_worker.js');
