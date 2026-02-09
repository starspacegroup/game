import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['worker.ts'],
  bundle: true,
  outfile: '.svelte-kit/cloudflare/worker.js',
  format: 'esm',
  platform: 'browser', // Cloudflare Workers use browser-like environment
  target: 'es2022',
  external: ['*.wasm'], // Don't bundle WASM files
  minify: false,
  sourcemap: true,
});

console.log('Worker bundled successfully');
