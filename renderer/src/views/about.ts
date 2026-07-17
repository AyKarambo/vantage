/**
 * About — the app's identity and version, the build/runtime facts (with a
 * one-click "Copy diagnostics" for bug reports), the account-safety & privacy
 * promises restated in-app, and support/legal info. Account-agnostic, so the
 * shell suppresses the global filter bar here.
 *
 * Version/build data comes from `getAppInfo()`; the on-screen rows and the
 * copyable diagnostics string share one pure source (`core/about`). Outbound
 * links go through `bridge.openExternal` — the renderer window blocks in-page
 * navigation, so a bare <a href> would be swallowed.
 */
import { h, render } from '../dom';
import type { AppInfo } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button, card } from '../components/primitives';
import { toast } from '../components/toast';
import { store } from '../store';
import { buildAboutRows, formatDiagnostics, type AboutRow } from '../../../src/core/about';
import { viewHead, type ViewContext } from './view';

const FALLBACK_EMAIL = 'timo.seikel@gmail.com';

/** The public repo — the preferred "Report a bug" target (an allowed `https:` URL). */
const REPO_URL = 'https://github.com/AyKarambo/vantage';

export function about(_ctx: ViewContext): HTMLElement {
  // Version-dependent nodes are created up front and filled once getAppInfo
  // resolves (same fetch-then-paint pattern the Settings cards use).
  const versionEl = h('span', { class: 'mono', style: { fontSize: '13px', color: 'var(--text-2)' } }, 'Version …');
  const buildBody = h('div', { class: 'stack', style: { gap: '2px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  const copyBtn = button('Copy diagnostics', { variant: 'soft', disabled: true, title: 'Copy version + build info for a bug report' });
  const reportBtn = button('Report a bug', {
    variant: 'soft', disabled: true,
    title: 'Open a prefilled GitHub issue with your version and build info attached',
  });

  let info: AppInfo | null = null;
  void bridge.getAppInfo().then((loaded) => {
    info = loaded;
    versionEl.textContent = `Version ${loaded.version}`;
    render(buildBody, ...buildAboutRows(loaded).map(infoRow));
    copyBtn.disabled = false;
    reportBtn.disabled = false;
  });

  copyBtn.addEventListener('click', () => {
    if (!info) return;
    void navigator.clipboard.writeText(formatDiagnostics(info)).then(
      () => toast('Diagnostics copied to clipboard'),
      () => toast('Couldn’t copy — clipboard unavailable'),
    );
  });

  reportBtn.addEventListener('click', () => {
    if (!info) return;
    void bridge.openExternal(bugReportUrl(info));
  });

  const emailSupport = (): void => {
    void bridge.openExternal(`mailto:${info?.supportEmail ?? FALLBACK_EMAIL}`);
  };

  const saveLog = (): void => {
    void bridge.exportLogBundle().then((res) => {
      if ('path' in res) toast(`Debug log saved to ${res.path}`);
      // Silence on a failed write would send someone who is already reporting a bug
      // off to hunt for a file that was never written.
      else if ('error' in res) toast(res.error);
      // { cancelled: true } — the user backed out of the save dialog; no toast.
    });
  };

  return h('div', { class: 'view' },
    viewHead('About', 'Version, build info, and what keeps Vantage account-safe'),
    identityCard(versionEl),
    h('div', { class: 'grid-2' },
      promiseCard(),
      card({ title: 'Build & runtime', sub: 'handy when reporting a bug', actions: copyBtn }, buildBody),
    ),
    supportCard(emailSupport, reportBtn, saveLog),
  );
}

/**
 * A prefilled `github.com/.../issues/new` link: a short "what happened / what
 * you expected" skeleton followed by the same diagnostics block "Copy
 * diagnostics" uses (one source, `core/about`'s `formatDiagnostics` — never
 * duplicated here). `https:` passes `bridge.openExternal`'s existing
 * scheme allowlist, so this needs no new IPC. Built with `URLSearchParams` so
 * the title/body are correctly percent-encoded; kept short to mind URL length.
 */
function bugReportUrl(info: AppInfo): string {
  const body = [
    'What happened?',
    '',
    'What did you expect instead?',
    '',
    '---',
    formatDiagnostics(info),
  ].join('\n');
  const params = new URLSearchParams({ title: 'Bug: ', body });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

/** Brand mark + wordmark + tagline, with the version aligned to the right. */
function identityCard(versionEl: HTMLElement): HTMLElement {
  return card({},
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      h('span', { class: 'brand-mark', style: { width: '38px', height: '38px', flex: '0 0 auto' } }),
      h('div', { style: { minWidth: '0' } },
        h('div', { style: { fontSize: '20px', fontWeight: '700', lineHeight: '1.1' } }, 'Vantage'),
        h('div', { class: 'u-muted', style: { fontSize: '12.5px', marginTop: '2px' } }, 'Account-safe Overwatch stats coach'),
      ),
      h('div', { style: { marginLeft: 'auto', textAlign: 'right' } }, versionEl),
    ),
  );
}

/** The two product promises the About screen is the permanent home for. */
function promiseCard(): HTMLElement {
  return card({ title: 'Account-safe & private' },
    h('div', { class: 'stack', style: { gap: '12px', marginTop: '4px' } },
      promiseItem('🛡', 'Sanctioned data source',
        'Live match data comes only from Overwolf’s Game Events Provider (GEP), a sanctioned game-data ' +
        'API. Vantage never reads game memory, never injects, and never exposes hidden information.'),
      promiseItem('🔒', 'Local-first',
        'Your match history, targets, and mental notes stay on this device. The only outbound path is ' +
        'Notion export — your own token, your explicit action.'),
    ),
  );
}

function promiseItem(icon: string, title: string, body: string): HTMLElement {
  return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
    h('span', { style: { fontSize: '16px', lineHeight: '1.3', flex: '0 0 auto' } }, icon),
    h('div', null,
      h('div', { style: { fontSize: '13px', fontWeight: '600' } }, title),
      h('div', { class: 'u-muted', style: { fontSize: '12px', marginTop: '1px' } }, body),
    ),
  );
}

/** Report-a-bug + support email (both opened via the sanctioned external-link
 *  path), the "Save debug log…" export with its review-before-attaching cue,
 *  license, and quick jumps to the related Settings/Logs surfaces. */
function supportCard(emailSupport: () => void, reportBtn: HTMLElement, saveLog: () => void): HTMLElement {
  return card({ title: 'Support & legal' },
    h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } },
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        reportBtn,
        button('Email support', { variant: 'soft', onClick: emailSupport }),
        button('Save debug log…', {
          variant: 'ghost', onClick: saveLog,
          title: 'Save a redacted copy of the in-app log, ready to attach to a report',
        }),
      ),
      h('div', { class: 'hint' },
        'The saved log has BattleTags and other identifying details stripped — but that’s best-effort, ' +
        'not a guarantee. Look it over before attaching it to a public issue.'),
      h('div', { class: 'hint' }, 'Free to use · MIT licensed · © Timo Seikel'),
      h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '2px' } },
        aboutLink('Data storage location →', () => store.setView('settings')),
        aboutLink('Open the debug log →', () => store.setView('logs')),
        aboutLink('FAQ →', () => store.setView('faq')),
      ),
    ),
  );
}

function aboutLink(label: string, onClick: () => void): HTMLElement {
  return h('button', {
    style: {
      background: 'none', border: 'none', padding: '0', cursor: 'pointer',
      font: 'inherit', fontSize: '12.5px', color: 'var(--accent)',
    },
    on: { click: onClick },
  }, label);
}

function infoRow(r: AboutRow): HTMLElement {
  return h('div', {
    style: {
      display: 'flex', justifyContent: 'space-between', gap: '12px',
      padding: '3px 0', fontSize: '12.5px', borderBottom: '1px solid var(--border)',
    },
  },
    h('span', { class: 'u-muted' }, r.label),
    h('span', { class: 'mono', style: { textAlign: 'right', wordBreak: 'break-all' } }, r.value),
  );
}
