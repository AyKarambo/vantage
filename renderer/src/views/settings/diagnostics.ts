import { h, render } from '../../dom';
import { bridge } from '../../bridge';
import { card } from '../../components/primitives';
import { logLevelToggle } from '../../components/logLevelToggle';
import { store } from '../../store';

export function diagnosticsCard(): HTMLElement {
  const about = h('div', { class: 'hint', style: { marginTop: '10px' } }, '');
  void bridge.getAppInfo().then((info) => {
    render(about, `Vantage ${info.version} · support: ${info.supportEmail}`);
  });
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
    about,
  );
}
