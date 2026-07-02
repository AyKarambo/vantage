// Generates the app's runtime icons from the Vantage — Aurora brand (the same
// rounded-square badge with the white "V" mark as the store icon):
//
//   assets/appicon.png  512x512  → ow-electron-builder converts to launcher_icon.ico
//                                   (Windows installer / taskbar); also the window icon
//   assets/tray.png     32x32    → the Windows tray icon
//
// Pure Node built-ins (see scripts/lib/aurora-canvas.mjs), so no binaries are
// committed and the icons are reproducible via `npm run make-icon`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBadgeIcon } from './lib/aurora-canvas.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(assets, { recursive: true });

for (const [name, size] of [['appicon.png', 512], ['tray.png', 32]]) {
  writeFileSync(join(assets, name), renderBadgeIcon(size).toPngBuffer());
  console.log(`wrote assets/${name} (${size})`);
}
