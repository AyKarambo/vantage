// Captures Overwolf store screenshots (1200x675 JPG, <=100KB) of every Vantage
// view straight from the browser-preview harness — no game or Overwolf runtime
// needed. It serves renderer/ over a tiny loopback server, loads the preview at
// exactly the store screenshot size, walks each view, and writes a JPEG.
//
// Run it through ow-electron (it needs Electron's NativeImage / capturePage):
//     npm run assets:screens
// which first bundles the preview, then runs `ow-electron scripts/capture-screenshots.cjs`.
//
// Output: assets/store/screenshots/01-overview.jpg … 08-targets.jpg
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const OUT = path.join(__dirname, '..', 'assets', 'store', 'screenshots');
const PORT = Number(process.env.SHOTS_PORT ?? 5179);
const SIZE = { width: 1200, height: 675 };
const MAX_BYTES = 100 * 1024;

// The sidebar nav items, in DOM order (see renderer/src/app/shell.ts NAV).
const VIEWS = ['overview', 'review', 'matches', 'maps', 'heroes', 'focus', 'mental', 'trends', 'targets', 'notion'];

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
    server.listen(PORT, () => resolve(server));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Make the fixed 1300x840 preview frame fill the whole viewport so the capture
// is a clean, undistorted 1200x675 with no letterboxing.
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();

  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    useContentSize: true,
    backgroundColor: '#0b0b0f',
    paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, offscreen: process.env.SHOTS_OFFSCREEN === '1' },
  });

  await win.loadURL(`http://127.0.0.1:${PORT}/preview/preview.html`);
  await win.webContents.insertCSS(FILL_CSS);

  // Wait until the shell has mounted and the sample data has rendered a view.
  const ready = await poll(win, `document.querySelectorAll('.nav-item').length === ${VIEWS.length} && !!document.querySelector('.view')`, 8000);
  if (!ready) throw new Error('preview did not render in time (did you run `npm run build:preview`?)');

  // A never-shown window only paints its initial frame, so view-switches capture
  // blank. Showing it inactive (no focus steal) makes the compositor repaint on
  // every DOM change. It closes as soon as the run finishes.
  win.showInactive();

  const results = [];
  for (let i = 0; i < VIEWS.length; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[${i}].click(); true`);
    win.webContents.invalidate();
    await wait(500); // let charts/transitions settle
    const image = (await win.webContents.capturePage()).resize(SIZE);

    let quality = 84;
    let jpg = image.toJPEG(quality);
    while (jpg.length > MAX_BYTES && quality > 35) {
      quality -= 8;
      jpg = image.toJPEG(quality);
    }
    const file = `${String(i + 1).padStart(2, '0')}-${VIEWS[i]}.jpg`;
    fs.writeFileSync(path.join(OUT, file), jpg);
    results.push(`assets/store/screenshots/${file}  ${(jpg.length / 1024).toFixed(0)}KB  q${quality}`);
  }

  server.close();
  console.log('captured:\n' + results.map((r) => '  ' + r).join('\n'));
  console.log('\nPick your best 1–5 for the store listing (overview + heroes + maps + focus + trends is a strong set).');
  win.destroy();
  app.quit();
}

async function poll(win, expr, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await win.webContents.executeJavaScript(expr)) return true;
    } catch {
      /* page still loading */
    }
    await wait(150);
  }
  return false;
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch((err) => {
  console.error('screenshot capture failed:', err);
  app.exit(1);
});
