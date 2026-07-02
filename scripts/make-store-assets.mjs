// Generates the Overwolf store graphic assets from the Vantage — Aurora brand,
// using only Node built-ins (see scripts/lib/aurora-canvas.mjs). Written as PNG:
//
//   assets/store/icon-55.png        55x55    app icon (PNG, dark+light safe)
//   assets/store/tile-258x198.png   258x198  appstore tile        (convert to JPG/WebP)
//   assets/store/hero-1920x560.png  1920x560 hero background       (PNG accepted)
//   assets/store/creator-400x320.png 400x320 "About the creator"  (PNG accepted)
//
// See docs/overwolf-submission.md for how each maps to the console.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Canvas, SS, ACCENT, ACCENT_BRIGHT, ACCENT_DEEP, INK,
  drawChevron, drawStatsMotif, auroraBase, renderBadgeIcon,
} from './lib/aurora-canvas.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'store');

function makeTile() {
  const cv = new Canvas(258 * SS, 198 * SS);
  auroraBase(cv);
  cv.glow(cv.w * 0.12, -cv.h * 0.1, cv.w * 0.8, ACCENT, 0.5);
  cv.glow(cv.w * 0.95, cv.h * 1.05, cv.w * 0.6, ACCENT_DEEP, 0.35);
  drawStatsMotif(cv, cv.w * 0.12, cv.h * 0.5, cv.w * 0.76, cv.h * 0.34, ACCENT_BRIGHT, 0.5);
  const bs = 62 * SS;
  cv.gradientRoundRect(cv.w * 0.12, cv.h * 0.14, bs, bs, 16 * SS, 135, [[0, ACCENT_BRIGHT], [1, ACCENT_DEEP]]);
  drawChevron(cv, cv.w * 0.12 + bs / 2, cv.h * 0.14 + bs / 2, 30 * SS, 8 * SS, INK);
  return cv.downsample(SS);
}

function makeHero() {
  const cv = new Canvas(1920, 560); // large enough to render at 1x with soft gradients
  auroraBase(cv);
  cv.glow(cv.w * 0.16, -cv.h * 0.2, cv.w * 0.5, ACCENT, 0.55);
  cv.glow(cv.w * 0.9, cv.h * 1.15, cv.w * 0.45, ACCENT_DEEP, 0.4);
  drawStatsMotif(cv, cv.w * 0.42, cv.h * 0.32, cv.w * 0.5, cv.h * 0.5, ACCENT_BRIGHT, 0.4);
  const bs = 190;
  cv.gradientRoundRect(cv.w * 0.1, cv.h * 0.5 - bs / 2, bs, bs, 44, 135, [[0, ACCENT_BRIGHT], [1, ACCENT_DEEP]]);
  drawChevron(cv, cv.w * 0.1 + bs / 2, cv.h * 0.5, 92, 24, INK);
  return cv;
}

function makeCreator() {
  const cv = new Canvas(400 * SS, 320 * SS);
  auroraBase(cv);
  cv.glow(cv.w * 0.5, cv.h * 0.28, cv.w * 0.7, ACCENT, 0.45);
  const bs = 120 * SS;
  cv.gradientRoundRect(cv.w / 2 - bs / 2, cv.h * 0.34 - bs / 2, bs, bs, 30 * SS, 135, [[0, ACCENT_BRIGHT], [1, ACCENT_DEEP]]);
  drawChevron(cv, cv.w / 2, cv.h * 0.34, 58 * SS, 15 * SS, INK);
  return cv.downsample(SS);
}

mkdirSync(OUT, { recursive: true });
const assets = [
  ['icon-55.png', renderBadgeIcon(55)],
  ['tile-258x198.png', makeTile()],
  ['hero-1920x560.png', makeHero()],
  ['creator-400x320.png', makeCreator()],
];
for (const [name, cv] of assets) {
  writeFileSync(join(OUT, name), cv.toPngBuffer());
  console.log(`wrote assets/store/${name} (${cv.w}x${cv.h})`);
}
console.log('done — see docs/overwolf-submission.md for how each asset maps to the console.');
