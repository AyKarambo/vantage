/**
 * Compile-time constants injected by esbuild's `define` (scripts/build-renderer.mjs,
 * scripts/build-preview.mjs) and vitest's (vitest.config.ts).
 *
 * `__DEV_TOOLS__` is `false` only in the release bundle (`npm run release` →
 * `build-renderer.mjs --release`). Code behind `if (__DEV_TOOLS__)` is then dead
 * and esbuild drops it from the bundle — Settings › Developer never ships.
 */
declare const __DEV_TOOLS__: boolean;
