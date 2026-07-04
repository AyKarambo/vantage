/**
 * Notion database card — pick an existing database the integration can see, or
 * have Vantage create a correctly-shaped one under a chosen parent page. Two
 * sub-flows (choose / create) share row/list rendering helpers, so they stay
 * in one file rather than splitting further.
 */
import { h, render } from '../../dom';
import type { NotionDatabaseSummary, NotionPageSummary, NotionStatus } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';

/**
 * The database picker: hidden until a token is saved. Offers two paths —
 * choose an existing database the integration can see, or have Vantage create
 * a correctly-shaped one under a chosen parent page. An empty search result
 * (nothing shared with the integration) renders as guidance, not an error,
 * mirroring the setup card's step list.
 */
export function databaseCard(s: NotionStatus | null, refresh: () => Promise<void>): HTMLElement {
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
