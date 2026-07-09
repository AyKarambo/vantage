// Captures Overwolf-review screenshots of the ACTUAL Vantage app — the real
// compiled main process + the real renderer bundle, loaded through a real
// frameless BrowserWindow with the same contextIsolation/sandbox/CSP the
// packaged app ships with. This is NOT the browser-preview harness
// (capture-screenshots.cjs): there is no HTTP server and no Electron-free
// stand-in — every screen is driven by the production DataProvider
// (dist/main/dataProvider.js) wired the same way src/main/index.ts wires it,
// just with the tray, live GEP sensor, and Notion network calls swapped for
// no-op stand-ins that don't affect anything on screen.
//
// Data: an isolated, disposable userData/data folder (deleted after the run)
// seeded with the same deterministic demo season (generateSampleGames) the
// app itself falls back to on a fresh install with "Show demo data" on — the
// exact in-app feature, not a fixture. Account names are the generator's own
// placeholders (Main/Smurf/Alt/Climb) — nothing personally identifying.
//
// Run via: npm run assets:app-screens
// Output:  docs/overwolf-review/screenshots/NN-name.png
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, nativeImage } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'overwolf-review', 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-appshot-'));

// Must happen before app.whenReady() — isolates this run from any real
// Vantage install's userData (no real match history is ever touched).
app.setPath('userData', TMP);

const { HistoryStore } = require(path.join(ROOT, 'dist', 'store', 'history'));
const { ManualStore } = require(path.join(ROOT, 'dist', 'store', 'manualLog'));
const { RankAnchorStore } = require(path.join(ROOT, 'dist', 'store', 'rankAnchors'));
const { MasterDataStore } = require(path.join(ROOT, 'dist', 'store', 'masterData'));
const { generateSampleGames } = require(path.join(ROOT, 'dist', 'core', 'sampleData'));
const { DEFAULT_MASTER_DATA, mergeMasterData } = require(path.join(ROOT, 'dist', 'core', 'masterData'));
const { createDataProvider } = require(path.join(ROOT, 'dist', 'main', 'dataProvider'));
const { registerDashboardIpc, registerWindowControls } = require(path.join(ROOT, 'dist', 'main', 'dashboard', 'ipcHandlers'));
const { hardenWebContents } = require(path.join(ROOT, 'dist', 'main', 'dashboard', 'webContentsSecurity'));
const { createLogger } = require(path.join(ROOT, 'dist', 'main', 'logger'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Kill transitions so every capture is a clean end-state frame, never mid-animation.
const KILL_ANIM_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
  }
`;

// Sidebar order — must match renderer/src/app/shell.ts's NAV flattened order.
const NAV = ['overview', 'review', 'matches', 'maps', 'heroes', 'focus', 'mental', 'trends', 'readiness', 'targets', 'notion', 'logs', 'settings', 'about'];

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

async function main() {
  const dataDir = path.join(TMP, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const history = new HistoryStore(dataDir);
  const manual = new ManualStore(dataDir);
  const rankAnchors = new RankAnchorStore(dataDir);
  const masterDataStore = new MasterDataStore(dataDir);

  const config = {
    accounts: { Main: 'Main', Smurf: 'Smurf', Alt: 'Alt', Climb: 'Climb' },
    ui: { closeToTray: true, demoPreference: 'on' },
    runAtLogin: false,
    breakReminder: {},
    staleness: {},
    readiness: { enabled: false },
    sessionSettings: {},
  };

  const log = createLogger({ dir: path.join(TMP, 'logs'), getSecrets: () => [], mirrorToConsole: false });
  log.info('main', 'Vantage started', { version: '0.1.0-screenshots' });
  log.info('gep', 'No game running — feed idle');
  log.info('store', 'demo season loaded', { games: 180 });

  const activeMapNames = () =>
    mergeMasterData(DEFAULT_MASTER_DATA, masterDataStore.all()).maps.filter((m) => m.isActive).map((m) => m.name);

  // Notion is opt-in and network-backed — stubbed disconnected (the real,
  // common first-launch state) rather than faked "connected".
  const notionStub = {
    export: async () => ({ ok: 0, failed: 0, unavailable: true }),
    import: async () => ({ imported: 0, skipped: 0, failed: 0, unavailable: true }),
    status: () => ({
      tokenSet: false, databaseConfigured: false, connected: false,
      trackedGames: history.count(), databaseSource: 'none', importedMatches: 0,
    }),
    setToken: () => notionStub.status(),
    clearToken: () => notionStub.status(),
    listDatabases: async () => ({ databases: [] }),
    listPages: async () => ({ pages: [] }),
    selectDatabase: async () => notionStub.status(),
    createDatabase: async () => notionStub.status(),
    clearExports: () => {},
    cleanupDuplicates: async () => ({ archived: 0, kept: 0, failed: 0, unavailable: true }),
  };

  const provider = createDataProvider({
    history, manual, rankAnchors, masterDataStore,
    fetchMasterDataUpdate: async () => ({ heroes: [], maps: [], seasons: [] }),
    notion: notionStub,
    getConfig: () => config,
    persistAccounts: (accounts) => { config.accounts = accounts; },
    importFile: { pick: async () => undefined },
    persistBreakReminder: (s) => { config.breakReminder = s; },
    persistStaleness: (s) => { config.staleness = s; },
    persistReadiness: (s) => { config.readiness = s; },
    persistSessionSettings: (s) => { config.sessionSettings = s; },
    recordGame: () => true,
    notify: () => {},
    sampleGames: () => generateSampleGames(180, 42, activeMapNames()),
    logger: log,
    gepStatus: () => ({
      state: 'no-game', sensor: 'gep', attachedAt: null, lastEventAt: null,
      eventsThisSession: 0, matchInProgress: false,
    }),
    appSettings: {
      get: () => ({ closeToTray: config.ui.closeToTray, runAtLogin: config.runAtLogin, demoPreference: config.ui.demoPreference }),
      apply: (patch) => {
        Object.assign(config.ui, patch);
        return { closeToTray: config.ui.closeToTray, runAtLogin: config.runAtLogin, demoPreference: config.ui.demoPreference };
      },
    },
    appInfo: () => ({
      version: '0.1.0', supportEmail: 'timo.seikel@gmail.com',
      electron: process.versions.electron, chromium: process.versions.chrome,
      node: process.versions.node, v8: process.versions.v8,
      platform: process.platform, osRelease: os.release(), packaged: false,
    }),
    openExternal: async () => {},
    dataLocation: {
      get: () => ({ folder: dataDir, isDefault: true }),
      choose: async () => ({ ok: true, changed: false, location: { folder: dataDir, isDefault: true } }),
      set: async () => ({ ok: true, changed: false, location: { folder: dataDir, isDefault: true } }),
      chooseFirstRun: async () => ({ ok: true, changed: false, location: { folder: dataDir, isDefault: true } }),
    },
  });

  // Mirrors DashboardWindow.open() (src/main/dashboard/dashboardWindow.ts) but
  // with explicit ROOT-relative paths — this script isn't launched as `ow-electron .`
  // (that would boot the real composition root instead), so `app.getAppPath()`
  // resolves to this script's own directory, not the project root. Same
  // BrowserWindow config, same preload, same renderer bundle, same IPC/hardening
  // as the packaged app.
  registerDashboardIpc(provider);
  registerWindowControls({ minimize: () => {}, toggleMaximize: () => {}, close: () => {} });
  const iconPath = path.join(ROOT, 'assets', 'tray.png');
  const win = new BrowserWindow({
    width: 1300, height: 840, minWidth: 1040, minHeight: 640,
    title: 'Vantage',
    frame: false,
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWebContents(win.webContents);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  const ready = await poll(win, `document.querySelectorAll('.nav-item').length === ${NAV.length} && !!document.querySelector('.view')`, 15000);
  if (!ready) throw new Error('dashboard did not render in time (did you run `npm run build`?)');
  await win.webContents.insertCSS(KILL_ANIM_CSS);
  await wait(300);

  const results = [];
  let n = 0;
  const capture = async (name) => {
    await wait(550);
    const image = await win.webContents.capturePage();
    let quality = 92;
    let jpg = image.toJPEG(quality);
    while (jpg.length > 350 * 1024 && quality > 50) {
      quality -= 8;
      jpg = image.toJPEG(quality);
    }
    const file = `${String(n).padStart(2, '0')}-${name}.jpg`;
    n++;
    fs.writeFileSync(path.join(OUT, file), jpg);
    results.push(`${file}  ${(jpg.length / 1024).toFixed(0)}KB`);
  };
  const click = (selector) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click(); true`);
  const clickAll = (selector, index) =>
    win.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.click(); true`);
  const escape = () => win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);

  // 1. First-run intro tour — shows automatically once (demoPreference is
  // pre-set, so this is the only modal that appears unprompted).
  const sawOnboarding = await poll(win, `!!document.querySelector('.overlay--center')`, 4000);
  if (sawOnboarding) {
    await capture('onboarding-tour');
    await escape(); // dismisses via the same Escape-to-finish path a real user has
    await wait(300);
  }

  // 2. Every sidebar screen, in nav order.
  for (let i = 0; i < NAV.length; i++) {
    await clickAll('.nav-item', i);
    if (NAV[i] === 'settings') {
      await capture('settings-general');
      await clickAll('.segmented-opt', 1);
      await capture('settings-master-data');
      continue;
    }
    await capture(NAV[i]);
    if (NAV[i] === 'matches') {
      const hasMatch = await click('.match-row.is-clickable');
      await capture('match-detail');
    }
  }

  // 3. Command palette + Log Match modal (Ctrl+K entry points).
  await clickAll('.nav-item', 0); // back to Overview for a clean base state
  await wait(300);
  await click('.titlebar-search');
  await capture('command-palette');
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.palette-item')].find(el => el.querySelector('.palette-label')?.textContent === 'Log match')?.click(); true`,
  );
  await capture('log-match');
  await escape();

  console.log('captured:\n' + results.map((r) => '  ' + r).join('\n'));
  win.destroy();
  // Best-effort: Chromium's disk cache can still hold file handles right after
  // the window closes, so a locked-file EBUSY here is expected sometimes —
  // it's an OS temp dir either way, harmless to leave for the OS to reclaim.
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* see above */ }
  app.quit();
}

app.whenReady().then(main).catch((err) => {
  console.error('app screenshot capture failed:', err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(1);
});
