// Generates the app's runtime icons from the Vantage — Aurora brand (the same
// rounded-square badge with the white "V" mark as the store icon):
//
//   assets/appicon.png         512x512  → ow-electron-builder converts to launcher_icon.ico
//                                          (Windows installer / taskbar); also the window icon
//   assets/tray.png            32x32    → the Windows tray icon (no game / base)
//   assets/tray-connected.png  32x32    → GEP attached, waiting for events (grey dot)
//   assets/tray-live.png       32x32    → receiving data (green dot)
//   assets/tray-stale.png      32x32    → match running but feed silent (red dot)
//
// Pure Node built-ins (see scripts/lib/aurora-canvas.mjs), so no binaries are
// committed and the icons are reproducible via `npm run make-icon`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BG_DEEP, renderBadgeIcon } from './lib/aurora-canvas.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(assets, { recursive: true });

// Live-status dot colours (mirror renderer/styles/tokens.css semantics).
const DOT = {
  connected: [197, 197, 208], // --text-2: attached, idle — deliberately not green
  live: [87, 166, 132], // --win
  stale: [209, 104, 95], // --loss
};

// Bottom-right status dot with a dark ring so it reads at 16px in the tray.
function withStatusDot(canvas, size, color) {
  const cx = size * 0.72;
  const cy = size * 0.72;
  const rDot = size * 0.2;
  const rRing = rDot + Math.max(1, size * 0.09);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rRing) canvas.blend(x, y, BG_DEEP, clamp01(rRing - d));
      if (d <= rDot) canvas.blend(x, y, color, clamp01(rDot - d));
    }
  }
  return canvas;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

for (const [name, size] of [['appicon.png', 512], ['tray.png', 32]]) {
  writeFileSync(join(assets, name), renderBadgeIcon(size).toPngBuffer());
  console.log(`wrote assets/${name} (${size})`);
}

for (const [state, color] of Object.entries(DOT)) {
  const name = `tray-${state}.png`;
  writeFileSync(join(assets, name), withStatusDot(renderBadgeIcon(32), 32, color).toPngBuffer());
  console.log(`wrote assets/${name} (32)`);
}
