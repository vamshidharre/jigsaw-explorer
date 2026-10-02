// Bundles the server (and the shared modules it imports) into a single ESM file.
// Runtime dependencies stay external and are resolved from node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: 'info',
});
