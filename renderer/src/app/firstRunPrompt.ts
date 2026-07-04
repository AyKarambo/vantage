/**
 * First-run demo-data choice. Shown once, before the intro tour, whenever the
 * persisted preference is still 'unset'. Blocking and explicit: there is no
 * silent dismissal into fabricated data — closing without choosing defaults to
 * 'off' (start fresh). The preference is main-process-backed via setAppSettings,
 * so the choice survives restarts without a separate renderer flag.
 */
import { h, render } from '../dom';
import { button } from '../components/primitives';
import { bridge } from '../bridge';
import { store } from '../store';

export function openFirstRunPrompt(onDone: () => void): void {
  const panel = h('div', { class: 'modal-card', style: { width: '480px', maxWidth: '92vw' } });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  let settled = false;

  const choose = (pref: 'on' | 'off'): void => {
    if (settled) return;
    settled = true;
    void bridge.setAppSettings({ demoPreference: pref })
      .then(() => store.refresh())
      .then(() => {
        window.removeEventListener('keydown', onKey);
        overlay.remove();
        onDone();
      });
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') choose('off');
  };

  // No backdrop-click dismissal — the user must make an explicit choice.
  panel.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);

  render(panel,
    h('div', { style: { padding: '22px 22px 8px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '17px', fontWeight: '600', marginBottom: '8px' } },
        'Welcome to Vantage'),
      h('div', { style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } },
        'Want to explore with demo data, or start fresh? Vantage can preload a realistic sample season so ' +
        'you can look around first, or begin with a clean slate and track your own games. You can change ' +
        'this anytime in Settings.'),
    ),
    h('div', { style: { display: 'flex', gap: '10px', padding: '14px 22px 22px' } },
      button('Show me demo data', { variant: 'primary', onClick: () => choose('on') }),
      button('Start fresh', { variant: 'soft', onClick: () => choose('off') }),
    ),
  );
  document.body.appendChild(overlay);
}
