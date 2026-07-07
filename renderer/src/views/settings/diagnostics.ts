import { h } from '../../dom';
import { card } from '../../components/primitives';
import { logLevelToggle } from '../../components/logLevelToggle';
import { store } from '../../store';

export function diagnosticsCard(): HTMLElement {
  // Version + build facts + support live on the About screen (single source of
  // truth); this card just links there.
  return card({ title: 'Diagnostics', sub: 'the release debug log' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
      logLevelToggle(),
      h('button', {
        class: 'btn btn--soft',
        on: { click: () => store.setView('logs') },
      }, 'Open log viewer'),
    ),
    h('div', { class: 'hint', style: { marginTop: '8px' } },
      'Every build writes a rotating log — GEP lifecycle, match pipeline, sync results. Tokens are never logged.'),
    h('div', { style: { marginTop: '10px' } },
      h('button', {
        class: 'btn btn--ghost',
        on: { click: () => store.setView('about') },
      }, 'About Vantage →'),
    ),
  );
}
