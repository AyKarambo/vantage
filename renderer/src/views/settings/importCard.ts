import { h, render } from '../../dom';
import type { ImportFileResult } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { toast } from '../../components/toast';
import { store } from '../../store';

/**
 * Data import — bring match history in from a Vantage import file (JSON), e.g.
 * the one the Obsidian→Vantage script (`scripts/import-obsidian.ps1`) writes.
 * Imported matches are marked so "Remove imported matches" clears exactly this
 * set, leaving live-tracked, hand-logged, and Notion-imported games untouched —
 * so a friend can keep tracking elsewhere and re-import cleanly. A collapsible
 * help panel documents the file format for adapting other sources.
 */
export function importCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  let helpOpen = false;
  let count = 0;

  void bridge.fileImportedCount().then((c) => { count = c; paint(); });

  function paint(message?: string): void {
    render(body,
      h('div', { class: 'hint' },
        'Import matches from a Vantage import file (JSON). Imported matches are tagged so you can clear and ' +
        're-import them cleanly, without touching live-tracked, hand-logged, or Notion-imported games.'),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' } },
        button('Import from file…', { variant: 'primary', onClick: runImport }),
        count > 0 ? button('Remove imported matches', { variant: 'soft', onClick: confirmRemove }) : null,
      ),
      count > 0
        ? h('div', { class: 'hint' }, `${count} match${count === 1 ? '' : 'es'} currently imported from a file.`)
        : null,
      message ? h('div', { class: 'hint' }, message) : null,
      formatHelp(),
    );
  }

  /** Re-read the live count (after import/remove) and repaint, optionally with a status line. */
  function refreshCount(message?: string): void {
    void bridge.fileImportedCount().then((c) => { count = c; paint(message); });
  }

  function runImport(): void {
    void bridge.importFromFile().then((res) => {
      if (res.cancelled) return; // user dismissed the picker — nothing to report
      if (res.error) {
        toast(`Import failed: ${res.error}`);
        refreshCount(`⚠ ${res.error}`);
        return;
      }
      toast(summarize(res));
      // store.refresh() remounts the whole settings view (a fresh importCard that
      // re-reads the count), so the confirmation lives in the toast, not an inline
      // line that would be discarded. refreshCount() is the belt-and-suspenders path.
      refreshCount();
      void store.refresh(); // new games + a possible rank anchor changed the dataset
    });
  }

  function confirmRemove(): void {
    openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '420px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Remove imported matches?'),
      h('div', { class: 'hint' },
        `This deletes the ${count} match${count === 1 ? '' : 'es'} imported from a file. Live-tracked, hand-logged, ` +
        'and Notion-imported matches stay untouched — re-import the file any time to bring them back.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Remove them', { variant: 'primary', onClick: () => {
          void bridge.deleteFileImports().then((res) => {
            close();
            toast(`Removed ${res.deleted} imported match${res.deleted === 1 ? '' : 'es'}.`);
            refreshCount();
            void store.refresh();
          });
        } }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    ));
  }

  /** Collapsible reference for the import JSON format (toggled by a local flag + repaint). */
  function formatHelp(): HTMLElement {
    const toggle = button(helpOpen ? 'Hide import format' : 'Show import format', {
      variant: 'ghost', onClick: () => { helpOpen = !helpOpen; paint(); },
    });
    if (!helpOpen) return h('div', { style: { marginTop: '2px' } }, toggle);
    return h('div', { class: 'stack', style: { gap: '8px', marginTop: '2px' } },
      toggle,
      h('div', { class: 'hint' }, 'A Vantage import file is JSON with this shape:'),
      h('pre', { class: 'mono u-dim', style: { fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0' } }, IMPORT_FORMAT),
      h('div', { class: 'hint' },
        'Each game needs matchId, timestamp (epoch ms), map, and result (Win / Loss / Draw). ' +
        'account, role, and gameType default to the envelope account, "tank", and "Competitive". ' +
        'srDelta and performance (0–100) are optional; a stable matchId per source match makes re-imports skip duplicates. ' +
        'The optional anchor sets your current rank (tier one of Bronze…Champion, division 1 = highest … 5 = lowest, ' +
        'progressPct 0–100); it is applied at your most recent imported match, and earlier ranks are reconstructed ' +
        'backward from it, so rank-protection detail on older matches is approximate.'),
    );
  }

  return card({ title: 'Data import', sub: 'bring match history in from a file (Obsidian, another tracker, …)' }, body);
}

/** A one-line summary of an import result for the toast + status line. */
function summarize(res: ImportFileResult): string {
  const bits = [`${res.imported} imported`];
  if (res.skipped) bits.push(`${res.skipped} already present`);
  if (res.invalid) bits.push(`${res.invalid} invalid`);
  if (res.accountsAdded) bits.push(`${res.accountsAdded} account${res.accountsAdded === 1 ? '' : 's'} added`);
  if (res.anchorSet) bits.push('rank anchor set');
  return bits.join(' · ');
}

const IMPORT_FORMAT = `{
  "vantageImport": 1,
  "account": "Lampenlicht",
  "anchor": { "role": "tank", "tier": "Diamond", "division": 3, "progressPct": 45 },
  "games": [
    {
      "matchId": "manual-import-2026-07-05-18-42-busan",
      "timestamp": 1751733720000,
      "map": "Busan",
      "result": "Loss",
      "heroes": ["Winston", "Sigma"],
      "srDelta": -27,
      "performance": 75
    }
  ]
}`;
