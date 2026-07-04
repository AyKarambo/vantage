/**
 * Notion sync — connect an internal integration token and push tracked games to
 * a Notion database. Status is fetched async from the bridge; the three cards
 * (state · setup · sync) re-render whenever it changes.
 */
import { h, render } from '../dom';
import { bridge } from '../bridge';
import type {
  ExportResult, NotionDatabaseSummary, NotionPageSummary, NotionStatus,
} from '../../../src/shared/contract';
import { button, card } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

export function notion(_ctx: ViewContext): HTMLElement {
  const statusRegion = h('div', { style: { marginBottom: '14px' } });
  const setupRegion = h('div', { style: { marginBottom: '14px' } });
  const databaseRegion = h('div', { style: { marginBottom: '14px' } });
  const syncRegion = h('div');
  let status: NotionStatus | null = null;

  const paint = (): void => {
    render(statusRegion, statusCard(status));
    render(setupRegion, setupCard(status, refresh));
    render(databaseRegion, databaseCard(status, refresh));
    render(syncRegion, syncCard(status));
  };
  async function refresh(): Promise<void> {
    status = await bridge.notionStatus();
    paint();
  }

  paint(); // placeholder while the first status loads
  void refresh();

  return h('div', { class: 'view', style: { maxWidth: '720px' } },
    viewHead(
      'Notion sync',
      'Connect a Notion database and push your tracked games to it — deduped, so re-syncing never doubles up.',
    ),
    statusRegion,
    setupRegion,
    databaseRegion,
    syncRegion,
  );
}

function statusCard(s: NotionStatus | null): HTMLElement {
  if (!s) {
    return card({ variant: 'raised' }, h('div', { class: 'u-muted' }, 'Checking connection…'));
  }
  const dot = (color: string) => h('span', { class: 'status-dot', style: { background: color } });

  if (s.connected && s.shapeValid === false) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--loss)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--loss-text)' } }, 'Database shape mismatch'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } },
            s.shapeIssues?.length ? `Missing: ${s.shapeIssues.join(', ')}` : 'One or more columns don’t match.'),
        ),
      ),
    );
  }

  if (s.connected) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--win)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--win-text)' } }, 'Connected to Notion'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } },
            s.databaseTitle
              ? `${s.databaseTitle} — ${s.trackedGames} tracked game${s.trackedGames === 1 ? '' : 's'} ready to sync`
              : `${s.trackedGames} tracked game${s.trackedGames === 1 ? '' : 's'} ready to sync`),
        ),
      ),
    );
  }
  const reason = !s.tokenSet
    ? 'No integration token yet — add one below.'
    : !s.databaseConfigured
      ? 'No database selected yet — pick one below or let Vantage create it.'
      : s.databaseSource === 'appsettings'
        ? 'Using database from appsettings.json (fallback) — pick one below to take over.'
        : 'Not ready.';
  return card({ variant: 'raised' },
    h('div', { class: 'notion-status' },
      dot('var(--dim)'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-name' }, 'Not connected'),
        h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } }, reason),
      ),
    ),
  );
}

function setupCard(s: NotionStatus | null, refresh: () => Promise<void>): HTMLElement {
  const msg = h('div', { class: 'hint', style: { minHeight: '16px', marginTop: '10px' } });
  const input = h('input', {
    class: 'target-name-input',
    type: 'password',
    placeholder: 'Paste token — ntn_… or secret_…',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const save = button('Save token', {
    variant: 'primary',
    onClick: async () => {
      const token = input.value.trim();
      if (!/^(ntn_|secret_)/.test(token) || token.length < 20) {
        setMsg(msg, '⚠ That doesn’t look like a Notion token (it starts with "ntn_" or "secret_").', 'loss');
        return;
      }
      save.disabled = true;
      const next = await bridge.setNotionToken(token);
      input.value = '';
      save.disabled = false;
      setMsg(
        msg,
        next.tokenSet ? '✓ Token saved and encrypted on this machine.' : '⚠ Could not save the token.',
        next.tokenSet ? 'win' : 'loss',
      );
      await refresh();
    },
  });

  const disconnect = s?.tokenSet
    ? button('Disconnect', { variant: 'ghost', onClick: async () => { await bridge.clearNotionToken(); await refresh(); } })
    : null;

  return card({ variant: 'raised', title: s?.tokenSet ? 'Update token' : 'Connect Notion', sub: 'internal integration' },
    stepList(),
    h('div', { class: 'field-label', style: { marginTop: '16px' } }, 'Integration token'),
    input,
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } }, save, disconnect),
    msg,
  );
}

/**
 * The database picker: hidden until a token is saved. Offers two paths —
 * choose an existing database the integration can see, or have Vantage create
 * a correctly-shaped one under a chosen parent page. An empty search result
 * (nothing shared with the integration) renders as guidance, not an error,
 * mirroring the setup card's step list.
 */
function databaseCard(s: NotionStatus | null, refresh: () => Promise<void>): HTMLElement {
  if (!s?.tokenSet) return h('div');
  const status: NotionStatus = s;

  const body = h('div');
  const mode = h('div', { style: { display: 'flex', gap: '10px', marginBottom: '14px' } },
    button('Choose database', { variant: 'soft', onClick: () => renderMode('choose') }),
    button('Create one for me', { variant: 'soft', onClick: () => renderMode('create') }),
  );

  function renderMode(kind: 'choose' | 'create'): void {
    render(body, kind === 'choose' ? chooseDatabasePanel(status, refresh) : createDatabasePanel(refresh));
  }
  renderMode('choose');

  return card({ variant: 'raised', title: 'Database', sub: 'gametracker target' }, mode, body);
}

function chooseDatabasePanel(s: NotionStatus, refresh: () => Promise<void>): HTMLElement {
  const out = h('div', { style: { marginTop: '10px' } }, h('span', { class: 'u-muted' }, 'Loading databases…'));

  void bridge.listNotionDatabases().then(({ databases, error }) => {
    render(out, renderDatabaseList(databases, error, s, refresh));
  });

  return h('div', null, out);
}

function renderDatabaseList(
  databases: NotionDatabaseSummary[],
  error: string | undefined,
  s: NotionStatus,
  refresh: () => Promise<void>,
): HTMLElement {
  if (error) {
    return h('div', { class: 'hint is-loss' }, error);
  }
  if (!databases.length) {
    return h('div', { class: 'hint' }, shareGuidance());
  }
  return h('div', { class: 'notion-db-list' },
    ...databases.map((db) => databaseRow(db, s, refresh)),
  );
}

function databaseRow(db: NotionDatabaseSummary, s: NotionStatus, refresh: () => Promise<void>): HTMLElement {
  const isCurrent = s.databaseId === db.id;
  const selectBtn = button(isCurrent ? 'Selected' : 'Select', {
    variant: isCurrent ? 'ghost' : 'primary',
    disabled: isCurrent,
    onClick: async () => {
      selectBtn.disabled = true;
      await bridge.selectNotionDatabase(db.id);
      await refresh();
    },
  });
  return h('div', { class: `notion-db-row${isCurrent ? ' is-current' : ''}` },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, db.title),
      db.url ? h('div', { class: 'u-dim', style: { fontSize: '11.5px' } }, db.url) : null,
    ),
    selectBtn,
  );
}

function createDatabasePanel(refresh: () => Promise<void>): HTMLElement {
  const out = h('div', { style: { marginTop: '10px' } }, h('span', { class: 'u-muted' }, 'Loading pages…'));

  void bridge.listNotionPages().then(({ pages, error }) => {
    render(out, renderPageList(pages, error, refresh));
  });

  return h('div', null,
    h('div', { class: 'hint', style: { marginBottom: '6px' } },
      'Creates a Maps database and a Gametracker database (matching the export schema) under the page you choose.'),
    out,
  );
}

function renderPageList(
  pages: NotionPageSummary[],
  error: string | undefined,
  refresh: () => Promise<void>,
): HTMLElement {
  if (error) {
    return h('div', { class: 'hint is-loss' }, error);
  }
  if (!pages.length) {
    return h('div', { class: 'hint' }, shareGuidance());
  }
  return h('div', { class: 'notion-db-list' },
    ...pages.map((page) => pageRow(page, refresh)),
  );
}

function pageRow(page: NotionPageSummary, refresh: () => Promise<void>): HTMLElement {
  const status = h('div', { class: 'hint', style: { marginTop: '8px', minHeight: '16px' } });
  const createBtn = button('Create here', {
    variant: 'primary',
    onClick: async () => {
      createBtn.disabled = true;
      render(status, h('span', { class: 'u-muted' }, 'Creating database — this takes ~15s…'));
      try {
        await bridge.createNotionDatabase(page.id);
        await refresh();
      } catch (err) {
        createBtn.disabled = false;
        render(status, h('span', { class: 'is-loss' }, `Could not create database — ${String(err)}`));
      }
    },
  });
  return h('div', { class: 'notion-db-row-wrap' },
    h('div', { class: 'notion-db-row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-name' }, page.title),
        page.url ? h('div', { class: 'u-dim', style: { fontSize: '11.5px' } }, page.url) : null,
      ),
      createBtn,
    ),
    status,
  );
}

/** Guidance shown when the integration search returns nothing — not an error. */
function shareGuidance(): string {
  return 'Share a page with your integration in Notion, then retry — ••• → Connections → add your integration.';
}

function stepList(): HTMLElement {
  const step = (n: number, text: string) =>
    h('li', { class: 'notion-step' }, h('span', { class: 'notion-step-n' }, String(n)), h('span', null, text));
  return h('ol', { class: 'notion-steps' },
    step(1, 'Create an internal integration at notion.so/my-integrations and copy its secret.'),
    step(2, 'In Notion, open your Overwatch page → ••• → Connections → add that integration so it can write rows.'),
    step(3, 'Paste the token below and save — then sync with one click.'),
  );
}

function syncCard(s: NotionStatus | null): HTMLElement {
  const out = h('div', { style: { marginTop: '12px', minHeight: '18px' } });
  const count = s?.trackedGames ?? 0;
  const canSync = Boolean(s?.connected) && count > 0;

  const btn = button(canSync ? `Sync ${count} games to Notion` : 'Sync to Notion', {
    variant: 'primary',
    disabled: !canSync,
    onClick: async () => {
      btn.disabled = true;
      render(out, h('span', { class: 'u-muted' }, 'Syncing…'));
      try {
        const res = await bridge.exportNotion({});
        render(
          out,
          res.unavailable
            ? h('span', { class: 'is-loss' }, 'Connect Notion first.')
            : res.error
              ? h('span', { class: 'is-loss' }, res.error)
              : syncResult(res),
        );
      } catch (err) {
        render(out, h('span', { class: 'is-loss' }, `Sync failed — ${String(err)}`));
      }
      btn.disabled = false;
    },
  });

  const note = !s
    ? 'Checking…'
    : !s.connected
      ? 'Connect above to enable syncing.'
      : count === 0
        ? 'No tracked games yet — play a game and they’ll appear here to sync.'
        : 'Pushes every tracked game to your database; matches already synced are skipped.';

  return card({ variant: 'raised', title: 'Sync now', sub: 'push tracked games' },
    h('div', { class: 'hint', style: { lineHeight: '1.5' } }, note),
    h('div', { style: { marginTop: '12px' } }, btn),
    out,
  );
}

function syncResult(res: ExportResult): HTMLElement {
  const parts = [chipText(`${res.ok} synced`, 'win')];
  if (res.skipped) parts.push(chipText(`${res.skipped} skipped`, 'muted'));
  if (res.failed) parts.push(chipText(`${res.failed} failed`, 'loss'));
  return h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, ...parts);
}

function chipText(text: string, kind: 'win' | 'loss' | 'muted'): HTMLElement {
  const cls = kind === 'win' ? 'is-win' : kind === 'loss' ? 'is-loss' : 'u-muted';
  return h('span', { class: `mono ${cls}`, style: { fontSize: '13px' } }, text);
}

function setMsg(el: HTMLElement, text: string, kind: 'win' | 'loss' | 'muted'): void {
  el.className = `hint${kind === 'win' ? ' is-win' : kind === 'loss' ? ' is-loss' : ''}`;
  el.textContent = text;
}
