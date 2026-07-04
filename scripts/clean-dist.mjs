// Removes stale tsc output before a build. tsc never deletes files for
// renamed/folderized modules, and Node resolves `require('./foo')` to a stale
// `dist/foo.js` BEFORE a fresh `dist/foo/index.js` (file beats directory) — so
// a half-refactored dist silently loads old code. Symptom that prompted this:
// the preload died on a shadowed stale contract module, leaving the whole
// renderer without `window.owstats`.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
rmSync(dist, { recursive: true, force: true });
console.log('[clean-dist] removed dist/');
