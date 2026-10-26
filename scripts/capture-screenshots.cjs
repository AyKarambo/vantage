// Captures Vantage screens straight from the browser-preview harness — no game
// or Overwolf runtime needed. It serves renderer/ over a tiny loopback server,
// loads the preview in a fixed-size window and walks the app. Two modes:
//
//   npm run assets:screens
//     Overwolf store screenshots (1200x675 JPG, <=100KB) of the main views →
//     assets/store/screenshots/01-overview.jpg … (git-ignored).
//
//   npm run test:visual [-- --update]
//     Visual regression run: every sidebar screen plus the onboarding tour, the
//     Log Match dialog, a match's detail page and editor, and an expanded Review
//     card, captured as PNGs at the app's 1300x840 spec size and compared pixel
//     by pixel against the committed baselines in test/visual/baselines/. On a
//     mismatch the actual capture and a diff image land in test/visual/output/
//     (git-ignored) and the run exits non-zero. `--update` rewrites the
//     baselines (and drops ones no longer captured) instead of comparing.
//     Determinism: a pinned clock (?now=), the sample season (?demo=on), fresh
//     in-memory storage, UTC + en-US, scale factor 1, no animations or caret.
//
// Both run through ow-electron (they need Electron's capturePage); the npm
// scripts bundle the preview first.
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const VISUAL = process.argv.includes('--visual');
const UPDATE = process.argv.includes('--update');
const PORT = Number(process.env.SHOTS_PORT ?? 5179);

const STORE_OUT = path.join(ROOT, 'assets', 'store', 'screenshots');
const STORE_SIZE = { width: 1200, height: 675 };
const MAX_BYTES = 100 * 1024;
// The store set, by sidebar label.
const STORE_VIEWS = ['Overview', 'Review', 'Matches', 'Maps', 'Heroes', 'Focus', 'Mental', 'Trends', 'Targets', 'Notion sync'];

const BASELINES = path.join(ROOT, 'test', 'visual', 'baselines');
const VISUAL_OUT = path.join(ROOT, 'test', 'visual', 'output');
// The app's own spec size (the preview frame), so screens lay out as they ship.
const VISUAL_SIZE = { width: 1300, height: 840 };
// 2026-09-21 18:00 UTC. Every relative date in the sample season hangs off this.
const VISUAL_NOW = Date.UTC(2026, 8, 21, 18, 0, 0);
// pixelmatch's per-pixel colour tolerance (0..1); any pixel beyond it counts.
const PIXEL_THRESHOLD = 0.1;
// Differing pixels a screen may have and still pass (default: none).
const MAX_DIFF_PIXELS = Number(process.env.VISUAL_MAX_DIFF ?? 0);

if (VISUAL) {
  // Fixed rendering inputs: one device pixel per CSS pixel and an en-US UI,
  // whatever the machine's display scaling and language.
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('lang', 'en-US');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
        if (pathname === '/') pathname = '/preview/preview.html';
        const filePath = path.join(RENDERER, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
        if (!filePath.startsWith(RENDERER)) return res.writeHead(403).end('Forbidden');
        const body = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Make the fixed 1300x840 preview frame fill the whole viewport so the capture
// is clean and undistorted, with no letterboxing.
const FILL_CSS = `
  html, body { margin: 0 !important; padding: 0 !important; background: #0b0b0f !important; overflow: hidden !important; }
  #frame { width: 100vw !important; height: 100vh !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  #app { height: 100vh !important; }
  /* Force every mount fade/transition to its end state so captures are never
     caught mid-animation (the initial view mounts while the window is hidden). */
  *, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
  }
`;
// A blinking caret in a focused field would make a dialog capture flaky.
const VISUAL_CSS = `${FILL_CSS}
  *, *::before, *::after { caret-color: transparent !important; scroll-behavior: auto !important; }
`;

async function main() {
  const server = await startServer();
  const size = VISUAL ? VISUAL_SIZE : STORE_SIZE;
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    useContentSize: true,
    resizable: false,
    backgroundColor: '#0b0b0f',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: process.env.SHOTS_OFFSCREEN === '1',
      // Visual runs start from empty storage: an in-memory partition, unique to
      // this run, so nothing a previous run (or the store capture) wrote leaks in.
      ...(VISUAL ? { session: session.fromPartition(`visual-${process.pid}-${Date.now()}`) } : {}),
    },
  });

  if (VISUAL) {
    // Dates and numbers format per time zone and locale; pin both. The page
    // target only answers CDP once something is loaded, hence the blank page.
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await win.webContents.debugger.sendCommand('Emulation.setLocaleOverride', { locale: 'en-US' });
  }

  const query = VISUAL ? `?demo=on&now=${VISUAL_NOW}` : '';
  await win.loadURL(`http://127.0.0.1:${PORT}/preview/preview.html${query}`);
  await win.webContents.insertCSS(VISUAL ? VISUAL_CSS : FILL_CSS);

  // Wait until the shell has mounted and the sample data has rendered a view.
  const ready = await poll(win, `document.querySelectorAll('.nav-item').length > 0 && !!document.querySelector('.view')`, 8000);
  if (!ready) throw new Error('preview did not render in time (did you run `npm run build:preview`?)');
  await js(win, 'document.fonts.ready.then(() => true)');

  // A never-shown window only paints its initial frame, so view-switches capture
  // blank. Showing it inactive (no focus steal) makes the compositor repaint on
  // every DOM change. It closes as soon as the run finishes.
  win.showInactive();

  let failed = false;
  try {
    failed = VISUAL ? await runVisual(win) : await runStore(win);
  } finally {
    server.close();
    win.destroy();
  }
  app.exit(failed ? 1 : 0);
}

// --- store screenshots -----------------------------------------------------------

async function runStore(win) {
  fs.mkdirSync(STORE_OUT, { recursive: true });
  await dismissModal(win);
  const results = [];
  for (let i = 0; i < STORE_VIEWS.length; i++) {
    await nav(win, STORE_VIEWS[i]);
    await wait(500); // let charts/transitions settle
    const image = (await capture(win)).resize(STORE_SIZE);

    let quality = 84;
    let jpg = image.toJPEG(quality);
    while (jpg.length > MAX_BYTES && quality > 35) {
      quality -= 8;
      jpg = image.toJPEG(quality);
    }
    const file = `${String(i + 1).padStart(2, '0')}-${slug(STORE_VIEWS[i])}.jpg`;
    fs.writeFileSync(path.join(STORE_OUT, file), jpg);
    results.push(`assets/store/screenshots/${file}  ${(jpg.length / 1024).toFixed(0)}KB  q${quality}`);
  }
  console.log('captured:\n' + results.map((r) => '  ' + r).join('\n'));
  console.log('\nPick your best 1–5 for the store listing (overview + heroes + maps + focus + trends is a strong set).');
  return false;
}

// --- visual regression -------------------------------------------------------------

/**
 * The screens, in capture order. Each step leaves the app where the next one
 * expects it; a name is the PNG's file name under test/visual/baselines/.
 */
async function* visualShots(win) {
  // Fresh storage ⇒ the intro tour opens over the first screen.
  yield 'onboarding';
  await dismissModal(win);

  const labels = await js(win, `[...document.querySelectorAll('.nav-item .nav-label')].map((n) => n.textContent.trim())`);
  for (const label of labels) {
    await nav(win, label);
    yield `screen-${slug(label)}`;
  }

  await nav(win, 'Review');
  await js(win, `document.querySelector('.review-card').scrollIntoView({ block: 'start' }); true`);
  yield 'review-card-expanded';

  await clickSelector(win, '.titlebar-log');
  await waitFor(win, `!!document.querySelector('.modal-card')`);
  yield 'log-match';
  await dismissModal(win);

  await nav(win, 'Matches');
  await clickSelector(win, '.view .match-row.is-clickable');
  await waitFor(win, `!!document.querySelector('.detail-map')`);
  yield 'match-detail';
  await js(win, `[...document.querySelectorAll('.view button')].find((b) => b.textContent.includes('Edit match')).click(); true`);
  await waitFor(win, `!!document.querySelector('.modal-card')`);
  yield 'match-editor';
  await dismissModal(win);
}

async function runVisual(win) {
  const { PNG } = require('pngjs');
  const { default: pixelmatch } = await import('pixelmatch');
  fs.rmSync(VISUAL_OUT, { recursive: true, force: true });
  fs.mkdirSync(BASELINES, { recursive: true });

  const captured = new Set();
  const failures = [];
  for await (const name of visualShots(win)) {
    await settle(win);
    const png = (await capture(win)).toPNG();
    const file = `${name}.png`;
    captured.add(file);
    const baselinePath = path.join(BASELINES, file);

    if (UPDATE) {
      fs.writeFileSync(baselinePath, png);
      console.log(`  updated  ${file}`);
      continue;
    }
    if (!fs.existsSync(baselinePath)) {
      writeOutput(file, png);
      failures.push(`${file}: no baseline (run \`npm run test:visual -- --update\` to create it)`);
      continue;
    }
    const actual = PNG.sync.read(png);
    const expected = PNG.sync.read(fs.readFileSync(baselinePath));
    if (actual.width !== expected.width || actual.height !== expected.height) {
      writeOutput(file, png);
      failures.push(`${file}: size ${actual.width}x${actual.height}, baseline ${expected.width}x${expected.height}`);
      continue;
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const pixels = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: PIXEL_THRESHOLD });
    if (pixels > MAX_DIFF_PIXELS) {
      writeOutput(file, png);
      writeOutput(`${name}.diff.png`, PNG.sync.write(diff));
      failures.push(`${file}: ${pixels} pixels differ`);
    } else {
      console.log(`  ok       ${file}`);
    }
  }

  // A baseline nothing captures any more is a screen that silently left the net.
  for (const file of fs.readdirSync(BASELINES).filter((f) => f.endsWith('.png') && !captured.has(f))) {
    if (UPDATE) {
      fs.rmSync(path.join(BASELINES, file));
      console.log(`  removed  ${file}`);
    } else {
      failures.push(`${file}: baseline exists but the screen was not captured`);
    }
  }

  if (UPDATE) {
    console.log(`\n${captured.size} baselines written to test/visual/baselines/`);
    return false;
  }
  if (failures.length) {
    console.error(`\nvisual regression: ${failures.length} of ${captured.size} screens failed\n` +
      failures.map((f) => `  ✗ ${f}`).join('\n') +
      '\nActual captures and diffs: test/visual/output/. If the change is intended, re-run with `-- --update`.');
    return true;
  }
  console.log(`\nvisual regression: all ${captured.size} screens match`);
  return false;
}

function writeOutput(file, buffer) {
  fs.mkdirSync(VISUAL_OUT, { recursive: true });
  fs.writeFileSync(path.join(VISUAL_OUT, file), buffer);
}

// --- driving the page --------------------------------------------------------------

function js(win, expr) {
  return win.webContents.executeJavaScript(expr);
}

async function capture(win) {
  win.webContents.invalidate();
  return win.webContents.capturePage();
}

/** Two animation frames (layout + paint) plus a beat for async view loads. */
async function settle(win) {
  await wait(400);
  await js(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
}

async function nav(win, label) {
  const ok = await js(win, `(() => {
    const item = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.querySelector('.nav-label')?.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  if (!ok) throw new Error(`no sidebar item labelled "${label}"`);
  await settle(win);
}

async function clickSelector(win, selector) {
  const ok = await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.click(); return !!el; })()`);
  if (!ok) throw new Error(`nothing matches ${selector}`);
}

/**
 * Close the open modal (onboarding, a dialog) the way a player would: Escape.
 * Only when one is open — on a bare screen Escape means Back.
 */
async function dismissModal(win) {
  await js(win, `!!document.querySelector('.modal-card')
    && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(win, `!document.querySelector('.modal-card')`);
}

async function waitFor(win, expr) {
  if (!(await poll(win, expr, 5000))) throw new Error(`timed out waiting for: ${expr}`);
}

async function poll(win, expr, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await js(win, expr)) return true;
    } catch {
      /* page still loading */
    }
    await wait(150);
  }
  return false;
}

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch((err) => {
  console.error('screenshot capture failed:', err);
  app.exit(1);
});
