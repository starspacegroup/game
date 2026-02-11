import * as esbuild from 'esbuild';
import { renameSync, existsSync, unlinkSync } from 'fs';

// After `vite build`, adapter-cloudflare outputs _worker.js
// Rename it so our custom worker.ts can import it, then esbuild
// bundles everything (SvelteKit app + GameRoom DO) into the final _worker.js
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
  outfile: '.svelte-kit/cloudflare/_worker.js',
  format: 'esm',
  platform: 'browser', // Cloudflare Workers use browser-like environment
  target: 'es2022',
  external: ['*.wasm', 'cloudflare:*', 'node:*'], // Don't bundle WASM, Cloudflare built-ins, or Node built-ins
  minify: false,
  sourcemap: true,
});

// Clean up the renamed intermediate file
unlinkSync(renamedOutput);

console.log('Worker bundled successfully → .svelte-kit/cloudflare/_worker.js');
