/**
 * Notion sync card — the "push tracked games now" action and its result readout.
 * Disabled until connected with at least one tracked game.
 */
import { h, render } from '../../dom';
import type { ExportResult, NotionStatus } from '../../../../src/shared/contract';
import { relTime } from '../../format';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';

export function syncCard(s: NotionStatus | null): HTMLElement {
  const out = h('div', { style: { marginTop: '12px', minHeight: '18px' } });
  const count = s?.trackedGames ?? 0;
  const canSync = Boolean(s?.connected) && count > 0;

  const btn = button(canSync ? `Sync ${count} games to Notion` : 'Sync to Notion', {
    variant: 'primary',
    disabled: !canSync,
    onClick: async () => {
      btn.disabled = true;
      render(out, h('span', { class: 'u-muted' }, 'Syncing…'));
      // Live per-game progress while the export runs.
      const unsub = bridge.onSyncProgress((p) => {
        render(out, h('span', { class: 'mono u-muted' }, `Syncing ${p.done} / ${p.total}…`));
      });
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
      unsub();
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
    s?.lastSyncedAt
      ? h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '6px' } }, `Last synced ${relTime(s.lastSyncedAt)}`)
      : null,
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
