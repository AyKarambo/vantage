/**
 * Notion sync — connect an internal integration token and push tracked games to
 * a Notion database. Status is fetched async from the bridge; the three cards
 * (state · setup · sync) re-render whenever it changes.
 */
import { h, render } from '../../dom';
import { bridge } from '../../bridge';
import type { NotionStatus } from '../../../../src/shared/contract';
import { viewHead, type ViewContext } from '../view';
import { statusCard } from './statusCard';
import { setupCard } from './setupCard';
import { databaseCard } from './databaseCard';
import { syncCard } from './syncCard';

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
