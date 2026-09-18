import { h, render } from '../../dom';
import { card } from '../../components/primitives';
import { logLevelToggle } from '../../components/logLevelToggle';
import { store } from '../../store';
import { presetMinLevel, subscribeLogStats, type LogStats } from '../../views/logViewer';

/**
 * The error/warning count (W5) — otherwise a player whose live tracking
 * silently stopped got no cue the log even held an error; the only path was
 * to guess to go check Logs. Errors get an accent pill (click → Logs preset
 * to the `error` filter); warnings are routine (e.g. the startup "notion
 * shape validation skipped" warn) and stay plain text.
 */
function statsLine(): HTMLElement {
  const host = h('span');
  // `subscribeLogStats` calls back synchronously with the current value, so
  // the very first call happens before the caller has even appended `host` —
  // `subscribed` distinguishes that initial paint from every later one, when
  // the self-cleaning `isConnected` check actually applies.
  let subscribed = false;
  const unsubscribe = subscribeLogStats((stats: LogStats) => {
    // Self-cleaning: the card is rebuilt (not kept mounted) on every Settings
    // re-render and there is no unmount hook, so the subscription drops
    // itself once its host leaves the DOM — same idiom live.ts uses.
    if (subscribed && !host.isConnected) { unsubscribe(); return; }
    render(host, statsContent(stats));
  });
  subscribed = true;
  return host;
}

function statsContent(stats: LogStats): HTMLElement {
  const warnText = `${stats.warnings} warning${stats.warnings === 1 ? '' : 's'}`;
  if (stats.errors === 0) {
    return h('span', { class: 'u-dim', style: { fontSize: '11.5px' } }, `0 errors · ${warnText} this session`);
  }
  return h('span', {
    class: 'badge badge--hybrid', style: { cursor: 'pointer' },
    title: 'Open Logs, filtered to errors',
    on: { click: () => { presetMinLevel('error'); store.setView('logs'); } },
  }, `${stats.errors} error${stats.errors === 1 ? '' : 's'} · ${warnText} this session`);
}

export function diagnosticsCard(): HTMLElement {
  // Version + build facts + support live on the About screen (single source of
  // truth); this card just links there.
  return card({ title: 'Diagnostics', sub: 'the release debug log' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' } },
      logLevelToggle(),
      h('button', {
        class: 'btn btn--soft',
        on: { click: () => store.setView('logs') },
      }, 'Open log viewer'),
      statsLine(),
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
