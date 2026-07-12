import { h, render } from '../../dom';
import type { DataLocation } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { store } from '../../store';

/**
 * Data storage — where *all* Vantage data files live (`history.db`,
 * `manual.json`, `outbox.json`, `rankAnchors.json`, plus a legacy
 * `history.json` backup when present). Point it at a cloud-synced
 * folder for off-machine backup. "Change…" migrates everything with a
 * copy-verify-then-delete guarantee: originals are removed only after the
 * switch is committed, and a target that already holds Vantage data is
 * offered as adopt-or-cancel rather than ever being overwritten.
 */
export function dataLocationCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '8px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  void bridge.getDataLocation().then((loc) => paint(loc));

  function paint(loc: DataLocation, message?: string): void {
    render(body,
      h('div', { style: { fontSize: '12px', fontWeight: '600' } }, loc.isDefault ? 'Default location' : 'Custom folder'),
      h('div', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, loc.folder),
      message ? h('div', { class: 'hint' }, message) : null,
      h('div', { style: { marginTop: '2px' } }, button('Change…', { variant: 'soft', onClick: choose })),
      h('div', { class: 'hint', style: { marginTop: '6px' } },
        'All match history and targets move together. Point this at a cloud-synced folder ' +
        '(OneDrive, Dropbox) for off-machine backup — use from one machine only, since editing the synced ' +
        'files from two machines at once can corrupt them. Notion export stays a separate, portable backup.'),
    );
  }

  function choose(): void {
    void bridge.chooseDataFolder().then((res) => {
      if (!res.ok) {
        void bridge.getDataLocation().then((loc) => paint(loc, `⚠ Couldn't change the data folder: ${res.error}`));
        return;
      }
      if (res.requiresAdopt) {
        confirmAdopt(res.location, () => void bridge.getDataLocation().then((loc) => paint(loc)));
        return;
      }
      paint(res.location, leftoverNote(res.leftovers));
    });
  }

  /** The chosen folder already holds Vantage data — offer adopt (repoint, no
   *  copy/delete of either side) or cancel (stay on the current folder). */
  function confirmAdopt(location: DataLocation, onCancel: () => void): void {
    openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Folder already has Vantage data'),
      h('div', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, location.folder),
      h('div', { class: 'hint' },
        'This folder already contains Vantage data. Adopting it switches to that data as-is — your ' +
        'current data stays intact in its old location, untouched. Nothing is copied or overwritten.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Adopt this folder', { variant: 'primary', onClick: () => {
          void bridge.setDataFolder({ folder: location.folder, adopt: true }).then((res) => {
            close();
            if (!res.ok) {
              void bridge.getDataLocation().then((loc) => paint(loc, `⚠ Couldn't adopt the folder: ${res.error}`));
              return;
            }
            paint(res.location);
            // The adopted folder's data (games, targets, ranks) differs from
            // whatever was showing — refresh the dashboard snapshot, same as
            // every other data-changing settings action (rank anchors, Notion
            // import/clear).
            void store.refresh();
          });
        } }),
        button('Cancel', { variant: 'ghost', onClick: () => { close(); onCancel(); } }),
      ),
    ));
  }

  return card({ title: 'Data storage', sub: 'where your match history and targets are stored' }, body);
}

/** The migration succeeded but some originals in the old folder couldn't be
 *  removed (Windows file locks) — surface the count rather than staying silent. */
function leftoverNote(leftovers?: number): string | undefined {
  if (!leftovers) return undefined;
  return `⚠ ${leftovers} file${leftovers === 1 ? '' : 's'} couldn't be removed from the old folder — safe to delete manually.`;
}
