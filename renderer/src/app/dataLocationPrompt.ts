/**
 * First-run data-location choice. Shown once, before the demo-data prompt,
 * whenever `getDataLocation()` reports `needsFirstRunChoice` (see shell.ts's
 * `maybeFirstRun`). The default folder is preselected and shown up front;
 * "Use this folder" accepts it as-is (no dialog — just persists the choice so
 * the first-run flag self-clears per spec C5). "Choose folder…" opens the
 * native picker via `chooseFirstRunDataFolder`, which validates the target
 * (creatable + writable) and, if it already holds Vantage data, adopts it in
 * place — no migration, no overwrite. An invalid choice shows the specific
 * reason and re-prompts; nothing is written until a folder is confirmed.
 */
import { h, render } from '../dom';
import { button } from '../components/primitives';
import { bridge } from '../bridge';
import { store } from '../store';
import type { DataLocation } from '../../../src/shared/contract';

const SYNC_NOTE = 'Synced folders (OneDrive, Dropbox) are great for backup — use from one machine ' +
  'only, since editing the same files from two machines at once can corrupt them.';

export function openDataLocationPrompt(onDone: () => void): void {
  const panel = h('div', { class: 'modal-card', style: { width: '480px', maxWidth: '92vw' } });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  let settled = false;
  let busy = false;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    overlay.remove();
    onDone();
  };

  const paint = (loc: DataLocation | null, error?: string): void => {
    render(panel,
      h('div', { style: { padding: '22px 22px 8px' } },
        h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '17px', fontWeight: '600', marginBottom: '8px' } },
          'Where should Vantage keep your data?'),
        h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
          'Vantage stores your match history, targets, and screenshots in a single folder. By default ' +
          'that’s its app-data folder, shown below — or point it at a folder you manage, a good place ' +
          'for a cloud-synced backup. You can change this later in Settings.'),
        loc
          ? h('div', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all', marginTop: '10px' } }, loc.folder)
          : h('div', { class: 'hint', style: { marginTop: '10px' } }, 'Loading…'),
        h('div', { class: 'hint', style: { marginTop: '10px' } }, SYNC_NOTE),
        error ? h('div', { class: 'hint', style: { marginTop: '10px', color: 'var(--danger, #e5484d)' } }, `⚠ ${error}`) : null,
      ),
      h('div', { style: { display: 'flex', gap: '10px', padding: '14px 22px 22px' } },
        button('Use this folder', { variant: 'primary', disabled: busy || !loc, onClick: useDefault }),
        button('Choose folder…', { variant: 'soft', disabled: busy || !loc, onClick: chooseFolder }),
      ),
    );
  };

  let current: DataLocation | null = null;
  void bridge.getDataLocation().then((loc) => { current = loc; paint(current); });

  const useDefault = (): void => {
    if (busy || settled || !current) return;
    busy = true;
    paint(current);
    // The shown folder already holds the just-opened history store, so this
    // is a same-directory no-op move — `adopt: true` avoids the "already
    // contains Vantage data" refusal `setDataFolder` would otherwise return
    // for a target that (trivially) already has data. Persisting nothing here
    // would leave `needsFirstRunChoice` set forever (spec C5: the flag
    // self-clears only once a folder decision is recorded), so accepting the
    // shown default still commits it explicitly, without opening a dialog.
    void bridge.setDataFolder({ folder: current.folder, adopt: true }).then((res) => {
      busy = false;
      if (!res.ok) { paint(current, res.error); return; }
      finish();
    });
  };

  const chooseFolder = (): void => {
    if (busy || settled) return;
    busy = true;
    paint(current);
    void bridge.chooseFirstRunDataFolder().then((res) => {
      busy = false;
      if (!res.ok) { paint(current, res.error); return; }
      // The picked folder may already hold Vantage data (an in-place adopt),
      // so the dashboard snapshot can differ from what was showing — refresh
      // it, same as the Settings "adopt" success path.
      void store.refresh();
      finish();
    });
  };

  panel.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(overlay);
}
