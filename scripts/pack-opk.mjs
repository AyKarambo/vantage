// Packs the built ow-electron app into an Overwolf OPK — the artifact you upload
// to the Developer Console (NOT the NSIS installer). Uses Overwolf's own CLI,
// `@overwolf/ow-cli opk pack`, on the electron-builder unpacked output.
//
//   npm run release     # produces release/win-unpacked/ (+ the NSIS installer)
//   npm run pack:opk    # → release/Vantage-<version>.opk
//
// The OPK is a ZIP of the runnable app (Vantage.exe + Electron runtime + resources/
// app.asar). ow-electron has no manifest.json; the app id/config comes from
// package.json inside the asar. Confirm the exact pack folder + upload flow with
// your Overwolf DevRel contact (their docs defer ow-electron packaging to DevRel).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appDir = join(root, 'release', 'win-unpacked');
const out = join(root, 'release', `${pkg.build?.productName ?? pkg.name}-${pkg.version}.opk`);

if (!existsSync(appDir)) {
  console.error('release/win-unpacked not found — run `npm run release` first (it builds the unpacked app).');
  process.exit(1);
}

console.log(`packing ${appDir} → ${out}`);
execSync(`npx --yes @overwolf/ow-cli opk pack "${appDir}" -o "${out}"`, { stdio: 'inherit', cwd: root });
console.log(`\n✓ OPK ready: ${out}\n  Upload this in the Developer Console (see docs/overwolf-submission.md §6).`);
