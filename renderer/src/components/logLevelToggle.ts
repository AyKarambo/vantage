/**
 * The session debug-detail toggle: flips the main-process log level between
 * `info` and `debug` (resets to info on app restart). Shared by the Logs
 * screen header and the Settings screen's Diagnostics card.
 */
import { h, render } from '../dom';
import type { LogLevel } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { chip } from './primitives';

export function logLevelToggle(): HTMLElement {
  const host = h('span', { title: 'Log verbose GEP detail for this session (resets on restart)' });
  void bridge.getLogLevel().then(draw);

  function draw(level: LogLevel): void {
    render(host, chip('Debug detail', level === 'debug', () => {
      const next: LogLevel = level === 'debug' ? 'info' : 'debug';
      void bridge.setLogLevel(next).then(draw);
    }));
  }
  return host;
}
