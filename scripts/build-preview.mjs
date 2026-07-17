// Bundles the browser preview harness (renderer/preview/preview.ts). Dev-only —
// this artifact is excluded from the packaged app.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateChangelogModule } from './build-changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// The preview bundles the same renderer views, so it needs the generated changelog too.
generateChangelogModule();

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'renderer', 'preview', 'preview.ts')],
  outfile: join(root, 'renderer', 'preview', 'preview.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome128',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-preview] watching…');
} else {
  await build(options);
  console.log('[build-preview] done → renderer/preview/preview.js');
}
