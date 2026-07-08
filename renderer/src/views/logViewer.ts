/**
 * Logs — the in-app release-log viewer: live-tails the main process's entry
 * ring with level filtering and pause/follow. Reads the ring over IPC (never
 * the log file), so it works identically in release builds and the preview.
 */
import { h, render } from '../dom';
import type { LogEntry, LogLevel } from '../../../src/shared/contract';
import { formatLogLine, levelAdmits, pushRing } from '../../../src/core/logging';
import { bridge } from '../bridge';
import { button, card, emptyState, segmented } from '../components/primitives';
import { logLevelToggle } from '../components/logLevelToggle';
import { viewHead, type ViewContext } from './view';

// Module singletons: the feed subscription outlives view re-renders, entries
// keep accumulating while other screens are active, and the ring cap bounds
// memory. `activeList` points at the currently mounted list (if any).
let entries: LogEntry[] = [];
let minLevel: LogLevel = 'debug'; // 'debug' = show everything the main process kept
let follow = true;
let feedStarted = false;
let activeList: HTMLElement | null = null;
let redrawFollow: (() => void) | null = null;

/**
 * Pause the live tail without touching scroll position — for the shell's
 * Ctrl+Home/PageUp handling (spec #73): an upward jump on `.log-lines` would
 * otherwise be immediately undone by the next streamed entry re-pinning the
 * scroller to the bottom (`onLogEntry` below). A no-op if already paused or
 * the view isn't mounted.
 */
export function pauseFollow(): void {
  if (!follow) return;
  follow = false;
  redrawFollow?.();
}

function ensureFeed(): void {
  if (feedStarted) return;
  feedStarted = true;
  void bridge.getLogEntries().then((es) => {
    entries = es;
    repaint();
  });
  bridge.onLogEntry((e) => {
    pushRing(entries, e);
    if (activeList?.isConnected && levelAdmits(minLevel, e.level)) {
      activeList.append(lineEl(e));
      if (follow) activeList.scrollTop = activeList.scrollHeight;
    }
  });
}

function lineEl(e: LogEntry): HTMLElement {
  return h('div', { class: `log-line is-${e.level}` }, formatLogLine(e));
}

function repaint(): void {
  if (!activeList?.isConnected) return;
  const visible = entries.filter((e) => levelAdmits(minLevel, e.level));
  render(
    activeList,
    ...(visible.length ? visible.map(lineEl) : [emptyState('No log entries yet.')]),
  );
  if (follow) activeList.scrollTop = activeList.scrollHeight;
}

export function logViewer(_ctx: ViewContext): HTMLElement {
  ensureFeed();

  const list = h('div', { class: 'log-lines mono' });
  activeList = list;

  const followHost = h('span');
  const drawFollow = (): void => {
    render(followHost, button(follow ? '⏸ Pause' : '▶ Follow', {
      variant: 'soft',
      title: follow ? 'Stop auto-scrolling (entries keep arriving)' : 'Resume live tail',
      onClick: () => {
        follow = !follow;
        drawFollow();
        if (follow) list.scrollTop = list.scrollHeight;
      },
    }));
  };
  redrawFollow = drawFollow;
  drawFollow();

  const filter = segmented<LogLevel>({
    options: [
      { value: 'debug', label: 'All' },
      { value: 'info', label: 'Info+' },
      { value: 'warn', label: 'Warn+' },
      { value: 'error', label: 'Errors' },
    ],
    value: minLevel,
    onChange: (v) => {
      minLevel = v;
      repaint();
    },
  });

  const view = h('div', { class: 'view' },
    viewHead('Logs', 'The release debug log — live from this session (last 1000 entries).',
      [filter, logLevelToggle(), followHost]),
    card({ class: 'card--flush', style: { padding: '0' } }, list),
  );
  repaint();
  return view;
}
