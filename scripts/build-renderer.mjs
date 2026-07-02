// Bundles the renderer TypeScript (renderer/src) into a single CSP-friendly
// script. One self-hosted bundle keeps the renderer's `script-src 'self'` CSP
// intact while letting us author the UI as real ES modules with shared types.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'renderer', 'src', 'main.ts')],
  outfile: join(root, 'renderer', 'dist', 'dashboard.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // ow-electron 39 ships Chromium ~128 — target it so we can use modern syntax.
  target: 'chrome128',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-renderer] watching…');
} else {
  await build(options);
  console.log('[build-renderer] done → renderer/dist/dashboard.js');
}
