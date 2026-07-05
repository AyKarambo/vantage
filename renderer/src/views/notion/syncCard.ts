/**
 * Notion sync card — the "push tracked games now" action and its result readout.
 * Disabled until connected with at least one tracked game.
 */
import { h, render } from '../../dom';
import type { ExportResult, ImportResult, NotionStatus } from '../../../../src/shared/contract';
import { relTime } from '../../format';
import { bridge } from '../../bridge';
import { store } from '../../store';
import { toast } from '../../components/toast';
import { openModal } from '../../components/overlay';
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

  // Import (pull) — the inverse of sync: read the Gametracker rows back into
  // local history (dedup by Match ID). Enabled once connected.
  const importOut = h('div', { style: { marginTop: '8px', minHeight: '18px' } });
  const canImport = Boolean(s?.connected);
  const importBtn = button('Import from Notion', {
    variant: 'soft',
    disabled: !canImport,
    onClick: async () => {
      importBtn.disabled = true;
      render(importOut, h('span', { class: 'u-muted' }, 'Importing…'));
      try {
        const res = await bridge.importNotion();
        render(
          importOut,
          res.unavailable
            ? h('span', { class: 'is-loss' }, 'Connect Notion first.')
            : res.error
              ? h('span', { class: 'is-loss' }, res.error)
              : importResult(res),
        );
        // Also confirm via a toast: store.refresh() below rebuilds this whole
        // view, tearing down the in-card chip, so the toast is the confirmation
        // that survives the re-render.
        if (!res.unavailable && !res.error) {
          const bits = [`${res.imported} imported`];
          if (res.skipped) bits.push(`${res.skipped} skipped`);
          if (res.failed) bits.push(`${res.failed} failed`);
          if (res.accountsAdded) bits.push(`${res.accountsAdded} account${res.accountsAdded === 1 ? '' : 's'} added`);
          toast(`Notion import — ${bits.join(' · ')}`);
        }
        // New matches or accounts landed — re-pull so dashboards/pickers reflect them.
        if (res.imported || res.accountsAdded) void store.refresh();
      } catch (err) {
        render(importOut, h('span', { class: 'is-loss' }, `Import failed — ${String(err)}`));
      }
      importBtn.disabled = false;
    },
  });

  return card({ variant: 'raised', title: 'Sync now', sub: 'push tracked games · pull them back' },
    h('div', { class: 'hint', style: { lineHeight: '1.5' } }, note),
    s?.lastSyncedAt
      ? h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '6px' } }, `Last synced ${relTime(s.lastSyncedAt)}`)
      : null,
    h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' } }, btn, importBtn),
    out,
    canImport
      ? h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '10px' } },
          'Import reads every Gametracker row into local history; matches already stored are skipped.')
      : null,
    importOut,
    deleteImportedSection(s?.importedMatches ?? 0),
  );
}

/**
 * Wipe-for-re-import affordance: shown only once an import has landed matches.
 * Removes ONLY Notion-imported matches (keeps hand-logged and live-tracked), so
 * a bad import can be corrected and re-run cleanly.
 */
function deleteImportedSection(importedMatches: number): HTMLElement | null {
  if (importedMatches <= 0) return null;
  const label = (n: number) => `${n} imported match${n === 1 ? '' : 'es'}`;
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line, rgba(255,255,255,0.08))' } },
    h('div', { class: 'u-dim', style: { fontSize: '11px', marginBottom: '8px', lineHeight: '1.5' } },
      `${label(importedMatches)} in your history. Wipe them to re-import cleanly — hand-logged and live-tracked matches are kept.`),
    button(`Delete ${label(importedMatches)}`, {
      variant: 'ghost',
      onClick: () => confirmDeleteImported(importedMatches),
    }),
  );
}

function confirmDeleteImported(count: number): void {
  const label = `${count} imported match${count === 1 ? '' : 'es'}`;
  openModal((close) =>
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '440px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, `Delete ${label}?`),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'This removes only matches pulled from Notion — your hand-logged and live-tracked matches stay. Use it to re-import cleanly after fixing your Notion data. Imported accounts are kept; a re-import repopulates everything.'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Delete imported', {
          variant: 'primary',
          onClick: async () => {
            close();
            try {
              const res = await bridge.deleteImportedMatches();
              toast(`Deleted ${res.deleted} imported match${res.deleted === 1 ? '' : 'es'}`);
              void store.refresh(); // updates dashboards + the Notion status (count → 0)
            } catch (err) {
              toast(`Delete failed — ${String(err)}`);
            }
          },
        }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    ),
  );
}

function importResult(res: ImportResult): HTMLElement {
  const parts = [chipText(`${res.imported} imported`, 'win')];
  if (res.skipped) parts.push(chipText(`${res.skipped} skipped`, 'muted'));
  if (res.failed) parts.push(chipText(`${res.failed} failed`, 'loss'));
  if (res.accountsAdded) parts.push(chipText(`${res.accountsAdded} account${res.accountsAdded === 1 ? '' : 's'} added`, 'win'));
  return h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, ...parts);
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
