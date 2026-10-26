import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Vitest's 5s default is too tight for the store tests on CI. Several of
     * them are *synchronous* SQLite + temp-directory work (`stores.test.ts`,
     * `dataMigration.test.ts`, `masterDataStore.test.ts`); they run in ~180ms
     * on a dev machine, but `windows-latest` is a shared 2-core runner where
     * temp-dir I/O is slow and highly variable, and one of them once crossed
     * 5s and failed the build. A re-run of the same commit passed, so this is
     * throughput variance, not a hang.
     *
     * Raised rather than removed: a genuinely stuck test still fails the
     * build, just after a threshold that reflects the slowest machine we
     * actually run on instead of the fastest.
     */
    testTimeout: 20_000,
    // beforeEach/afterEach in the store tests do the same fs work (mkdtemp,
    // recursive rm), so the hook budget needs the same headroom.
    hookTimeout: 20_000,
    // The renderer bundles the changelog generated from CHANGELOG.md; the DOM
    // tests import the real renderer, so make sure it exists on a fresh checkout.
    globalSetup: ['test/globalSetup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['test/**/*.test.ts'], exclude: ['test/dom/**'] },
      },
      {
        // DOM characterization tests: the real renderer mounted over the real
        // data layer in happy-dom (see test/dom/appHarness.ts). Only here —
        // everything else stays on plain node.
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/dom/**/*.test.ts'],
          // Rendered dates and numbers are pinned text: UTC here, en-US in setup.ts.
          env: { TZ: 'UTC' },
          setupFiles: ['test/dom/setup.ts'],
        },
      },
    ],
  },
});
