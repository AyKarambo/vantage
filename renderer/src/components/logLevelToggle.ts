/**
 * The session debug-detail toggle: flips the main-process log level between
 * `info` and `debug` (resets to info on app restart). Shared by the Logs
 * screen header and the Settings screen's Diagnostics card.
 */
import { h, render } from '../dom';
import type { LogLevel } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { toggleSwitch } from './primitives';

export function logLevelToggle(): HTMLElement {
  const host = h('span', {
    class: 'toggle-inline',
    title: 'Log verbose GEP detail for this session (resets on restart)',
  });
  void bridge.getLogLevel().then(draw);

  function draw(level: LogLevel): void {
    // K3: a fixed "Debug detail" label beside a real switch — this was the
    // one boolean in the app with no on/off cue at all beyond a colour tint,
    // not even the inconsistent label-text suffix every other chip had.
    render(host,
      h('span', { class: 'toggle-inline-label' }, 'Debug detail'),
      toggleSwitch({
        on: level === 'debug',
        ariaLabel: 'Debug detail',
        onChange: () => {
          const next: LogLevel = level === 'debug' ? 'info' : 'debug';
          void bridge.setLogLevel(next).then(draw);
        },
      }),
    );
  }
  return host;
}
