/**
 * Notion sync card — the "push tracked games now" action and its result readout.
 * Disabled until connected with at least one tracked game.
 */
import { h, render } from '../../dom';
import type { CleanupDuplicatesResult, ExportResult, ImportResult, NotionStatus } from '../../../../src/shared/contract';
import { relTime } from '../../format';
import { bridge } from '../../bridge';
import { store } from '../../store';
import { toast } from '../../components/toast';
import { openModal } from '../../components/overlay';
import { button, card } from '../../components/primitives';

export function syncCard(s: NotionStatus | null): HTMLElement {
  const out = h('div', { style: { marginTop: '12px', minHeight: '18px' } });
  // Competitive games that still need a push (never-exported / changed-since-export),
  // not the whole history — see NotionStatus.unsyncedGames (spec E3).
  const count = s?.unsyncedGames ?? 0;
  const competitive = s?.competitiveGames ?? 0;
  const canSync = Boolean(s?.connected) && count > 0;

  const btn = button(canSync ? `Sync ${count} game${count === 1 ? '' : 's'} to Notion` : 'Sync to Notion', {
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
      : count > 0
        ? 'Pushes every tracked game to your database; matches already synced are skipped.'
        : competitive > 0
          ? 'All competitive games are synced — you’re up to date.'
          : 'No competitive games yet — play a game and they’ll appear here to sync.';

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
          if (res.merged) bits.push(`${res.merged} updated`);
          if (res.skipped) bits.push(`${res.skipped} skipped`);
          if (res.failed) bits.push(`${res.failed} failed`);
          if (res.accountsAdded) bits.push(`${res.accountsAdded} account${res.accountsAdded === 1 ? '' : 's'} added`);
          // The duplicates count must ride the toast too: the refresh below is
          // what tears down the in-card chip, and on a first import (imported
          // > 0) that happens almost immediately — the toast is the only
          // surface that durably tells the user to run the cleanup action.
          if (res.duplicates) bits.push(`${res.duplicates} duplicate row${res.duplicates === 1 ? '' : 's'} in Notion`);
          toast(`Notion import — ${bits.join(' · ')}`);
        }
        // New matches, merged updates, or accounts landed — re-pull so
        // dashboards/pickers/the pending-review queue reflect them. A merge-only
        // import (0 imported) still needs this: it can fill in bookkeeping
        // grades/mental on already-tracked matches, which the pending queue
        // reads live.
        if (res.imported || res.merged || res.accountsAdded) void store.refresh();
      } catch (err) {
        render(importOut, h('span', { class: 'is-loss' }, `Import failed — ${String(err)}`));
      }
      importBtn.disabled = false;
    },
  });

  // Clean up duplicates — opt-in, explicit-confirm action for the redundant
  // rows import can detect (hand row + re-created copy) but never deletes
  // itself. Same gating as import: needs a connected database.
  const cleanupOut = h('div', { style: { marginTop: '8px', minHeight: '18px' } });
  const cleanupBtn = button('Clean up duplicate rows…', {
    variant: 'ghost',
    disabled: !canImport,
    onClick: () => confirmCleanupDuplicates(cleanupBtn, cleanupOut),
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
    canImport
      ? h('div', { style: { marginTop: '10px' } }, cleanupBtn)
      : null,
    cleanupOut,
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

/**
 * Ask for confirmation before archiving duplicate Notion rows, mirroring
 * {@link confirmDeleteImported}'s modal → spin → toast → refresh flow. Nothing
 * local is touched; the archived copies live in Notion's trash (~30 days).
 */
function confirmCleanupDuplicates(cleanupBtn: HTMLButtonElement, cleanupOut: HTMLElement): void {
  openModal((close) =>
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '440px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, 'Clean up duplicate Notion rows?'),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'Keeps one row per match and moves redundant copies to Notion’s trash — restorable there for about 30 days. Nothing local is deleted.'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Clean up', {
          variant: 'primary',
          onClick: async () => {
            close();
            cleanupBtn.disabled = true;
            render(cleanupOut, h('span', { class: 'u-muted' }, 'Cleaning up…'));
            try {
              const res = await bridge.cleanupNotionDuplicates();
              render(
                cleanupOut,
                res.unavailable
                  ? h('span', { class: 'is-loss' }, 'Connect Notion first.')
                  : res.error
                    ? h('span', { class: 'is-loss' }, res.error)
                    : null,
              );
              if (!res.unavailable && !res.error) {
                toast(cleanupToastMessage(res));
                void store.refresh();
              }
            } catch (err) {
              render(cleanupOut, h('span', { class: 'is-loss' }, `Cleanup failed — ${String(err)}`));
              toast(`Cleanup failed — ${String(err)}`);
            }
            cleanupBtn.disabled = false;
          },
        }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    ),
  );
}

/** Phrases the cleanup toast, singular/plural-correct, noting failures and the no-op case. */
function cleanupToastMessage(res: CleanupDuplicatesResult): string {
  // "No duplicates found" only when the run truly had nothing to do — with
  // archived: 0 but failures, duplicates WERE found and the archives failed;
  // claiming a clean database would talk the user out of the retry they need.
  if (res.archived === 0 && res.failed === 0) return 'No duplicate rows found';
  let msg = `Archived ${res.archived} duplicate row${res.archived === 1 ? '' : 's'}`;
  if (res.failed) msg += `, ${res.failed} failed`;
  return msg;
}

function importResult(res: ImportResult): HTMLElement {
  const parts = [chipText(`${res.imported} imported`, 'win')];
  if (res.merged) parts.push(chipText(`${res.merged} updated`, 'win'));
  if (res.skipped) parts.push(chipText(`${res.skipped} skipped`, 'muted'));
  if (res.failed) parts.push(chipText(`${res.failed} failed`, 'loss'));
  if (res.accountsAdded) parts.push(chipText(`${res.accountsAdded} account${res.accountsAdded === 1 ? '' : 's'} added`, 'win'));
  if (res.duplicates) parts.push(chipText(`${res.duplicates} duplicate row${res.duplicates === 1 ? '' : 's'} in Notion`, 'loss'));
  return h('div', null,
    h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, ...parts),
    res.duplicates
      ? h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '6px' } },
          'Duplicate rows detected — use "Clean up duplicate rows" below.')
      : null,
  );
}

function syncResult(res: ExportResult): HTMLElement {
  const parts = [chipText(`${res.ok} synced`, 'win')];
  if (res.updated) parts.push(chipText(`${res.updated} updated`, 'win'));
  if (res.recreated) parts.push(chipText(`${res.recreated} recreated`, 'muted'));
  if (res.skipped) parts.push(chipText(`${res.skipped} skipped`, 'muted'));
  if (res.failed) parts.push(chipText(`${res.failed} failed`, 'loss'));
  return h('div', null,
    h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, ...parts),
    res.recreated
      ? h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '6px' } },
          `${res.recreated} row${res.recreated === 1 ? '' : 's'} recreated — the Notion page had been deleted or archived.`)
      : null,
  );
}

function chipText(text: string, kind: 'win' | 'loss' | 'muted'): HTMLElement {
  const cls = kind === 'win' ? 'is-win' : kind === 'loss' ? 'is-loss' : 'u-muted';
  return h('span', { class: `mono ${cls}`, style: { fontSize: '13px' } }, text);
}
