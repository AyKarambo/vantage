// Bundles the renderer TypeScript (renderer/src) into a single CSP-friendly
// script, and the preload into a single self-contained file. One self-hosted
// bundle keeps the renderer's `script-src 'self'` CSP intact while letting us
// author the UI as real ES modules with shared types.
//
// The preload MUST be bundled: Electron sandboxes preload scripts by default,
// and a sandboxed preload's `require` can only load 'electron' — a relative
// `require('../shared/contract')` fails with "module not found", the bridge
// never mounts, and the whole renderer dies. Bundling inlines the contract so
// the emitted file only requires 'electron'. (This overwrites the unbundled
// preload.js that tsc emits.)
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateChangelogModule } from './build-changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// Compile CHANGELOG.md into the module graph before bundling: the renderer's CSP
// (`default-src 'none'`, no `connect-src`) forbids fetching anything at runtime, so
// "What's new" can only work if its content is inlined here.
generateChangelogModule();

/** @type {import('esbuild').BuildOptions} */
const rendererOptions = {
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

/** @type {import('esbuild').BuildOptions} */
const preloadOptions = {
  entryPoints: [join(root, 'src', 'main', 'preload.ts')],
  outfile: join(root, 'dist', 'main', 'preload.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['electron'], // the only require a sandboxed preload can resolve
  target: 'chrome128',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

if (watch) {
  const rendererCtx = await context(rendererOptions);
  const preloadCtx = await context(preloadOptions);
  await rendererCtx.watch();
  await preloadCtx.watch();
  console.log('[build-renderer] watching renderer + preload…');
} else {
  await build(rendererOptions);
  await build(preloadOptions);
  console.log('[build-renderer] done → renderer/dist/dashboard.js + dist/main/preload.js');
}
