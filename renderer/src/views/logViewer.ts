/**
 * Logs — the in-app release-log viewer: live-tails the main process's entry
 * ring with level/scope/text filtering, copy/save, and pause/follow. Reads
 * the ring over IPC (never the log file), so it works identically in release
 * builds and the preview.
 */
import { h, render } from '../dom';
import type { LogEntry, LogLevel } from '../../../src/shared/contract';
import { formatLogLine, levelAdmits, matchesSearch, pushRing } from '../../../src/core/logging';
import { bridge } from '../bridge';
import { button, card, emptyState, segmented, select } from '../components/primitives';
import { logLevelToggle } from '../components/logLevelToggle';
import { toast } from '../components/toast';
import { viewHead, type ViewContext } from './view';

/** All scopes, unfiltered (W5). */
const ALL_SCOPES = 'all';

// Module singletons: the feed subscription outlives view re-renders, entries
// keep accumulating while other screens are active, and the ring cap bounds
// memory. `activeList` points at the currently mounted list (if any).
let entries: LogEntry[] = [];
let minLevel: LogLevel = 'debug'; // 'debug' = show everything the main process kept
let search = '';
let scope: string = ALL_SCOPES;
let localTime = false;
let follow = true;
let feedStarted = false;
let activeList: HTMLElement | null = null;
let redrawFollow: (() => void) | null = null;
let redrawHeader: (() => void) | null = null;

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

/** Set the level filter before opening Logs — the Diagnostics error pill (W5) jumps straight to `error`. */
export function presetMinLevel(level: LogLevel): void {
  minLevel = level;
}

// --- error/warning counter (W5) ---------------------------------------------

let errorCount = 0;
let warnCount = 0;
const statsListeners = new Set<(stats: LogStats) => void>();

export interface LogStats {
  errors: number;
  warnings: number;
}

/** Errors/warnings seen this session (since the feed started, not since Logs was last opened) — the Diagnostics card + sidebar dot (W5) subscribe here instead of polling. */
export function subscribeLogStats(fn: (stats: LogStats) => void): () => void {
  statsListeners.add(fn);
  fn(currentStats());
  return () => statsListeners.delete(fn);
}

function currentStats(): LogStats {
  return { errors: errorCount, warnings: warnCount };
}

function countEntry(e: LogEntry): void {
  if (e.level === 'error') errorCount++;
  else if (e.level === 'warn') warnCount++;
  else return;
  for (const fn of statsListeners) fn(currentStats());
}

/**
 * Starts the live feed subscription — called once at shell mount (W5), not on
 * the Logs view's first render, so the error/warning counter reflects the
 * WHOLE session rather than only what happened after the player first opened
 * Logs (the common case: they open it BECAUSE something already went wrong).
 */
export function ensureFeed(): void {
  if (feedStarted) return;
  feedStarted = true;
  void bridge.getLogEntries().then((es) => {
    entries = es;
    for (const e of es) countEntry(e);
    repaint();
  });
  bridge.onLogEntry((e) => {
    pushRing(entries, e);
    countEntry(e);
    if (activeList?.isConnected && passesFilters(e)) {
      activeList.append(lineEl(e));
      if (follow) activeList.scrollTop = activeList.scrollHeight;
    }
    redrawHeader?.();
  });
}

function passesFilters(e: LogEntry): boolean {
  return levelAdmits(minLevel, e.level) && (scope === ALL_SCOPES || e.scope === scope) && matchesSearch(e, search);
}

function lineEl(e: LogEntry): HTMLElement {
  return h('div', { class: `log-line is-${e.level}` }, formatLogLine(e, { localTime }));
}

function visibleEntries(): LogEntry[] {
  return entries.filter(passesFilters);
}

function repaint(): void {
  if (!activeList?.isConnected) return;
  const visible = visibleEntries();
  render(
    activeList,
    ...(visible.length ? visible.map(lineEl) : [emptyState('No log entries match the current filters.')]),
  );
  if (follow) activeList.scrollTop = activeList.scrollHeight;
  redrawHeader?.();
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

  const searchInput = h('input', {
    class: 'input', type: 'search', placeholder: 'Search…', value: search,
    style: { fontSize: '12px', padding: '4px 8px', width: '140px' },
    on: {
      input: (e) => {
        search = (e.target as HTMLInputElement).value;
        repaint();
      },
    },
  });

  const scopeHost = h('span');
  let knownScopeCount = -1; // forces the first draw
  const drawScope = (): void => {
    const scopes = [...new Set(entries.map((e) => e.scope))].sort();
    // The current scope stays selectable even if it just aged out of the
    // ring (e.g. a stale-gep burst scrolled off) — losing the filter mid-read
    // would be more surprising than an option with nothing behind it.
    if (scope !== ALL_SCOPES && !scopes.includes(scope)) scopes.push(scope);
    // Rebuilt only when a genuinely new scope shows up, not on every entry —
    // a live GEP burst can push many lines a second, and this is a <select>
    // a player may have mid-interaction with.
    if (scopes.length === knownScopeCount) return;
    knownScopeCount = scopes.length;
    render(scopeHost, select(
      [{ value: ALL_SCOPES, label: 'All scopes' }, ...scopes.map((s) => ({ value: s, label: s }))],
      scope,
      (v) => { scope = v; repaint(); },
    ));
  };
  drawScope();

  const countHost = h('span', { class: 'u-dim', style: { fontSize: '11px' } });
  const drawCount = (): void => {
    countHost.textContent = `${visibleEntries().length} of ${entries.length} shown`;
  };
  redrawHeader = () => { drawCount(); drawScope(); };
  drawCount();

  const copyVisible = (): void => {
    const text = visibleEntries().map((e) => formatLogLine(e, { localTime })).join('\n');
    void navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${visibleEntries().length} log line${visibleEntries().length === 1 ? '' : 's'}`),
      () => toast('Couldn’t copy — clipboard unavailable'),
    );
  };

  const saveLog = (): void => {
    void bridge.exportLogBundle().then((res) => {
      if ('path' in res) toast(`Debug log saved to ${res.path}`);
      else if ('error' in res) toast(res.error);
      // { cancelled: true } — backed out of the save dialog; no toast.
    });
  };

  const localTimeToggle = button(localTime ? 'Local time' : 'UTC', {
    variant: 'ghost',
    title: 'Toggle between UTC (the file log’s own format) and your local clock',
    onClick: () => {
      localTime = !localTime;
      localTimeToggle.textContent = localTime ? 'Local time' : 'UTC';
      repaint();
    },
  });

  // W5 added six more controls (scope, search, count, local-time, copy, save)
  // on top of the original three — crammed into viewHead's single-line,
  // never-shrinks actions slot, those squeezed the title/subtitle down to a
  // wrap-every-word sliver. A second toolbar row, wrapping freely on its own
  // line, keeps the header itself readable at any width.
  const toolbar = h('div', {
    class: 'log-toolbar',
    style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px 0' },
  },
    filter, scopeHost, searchInput, countHost, localTimeToggle,
    button('Copy visible', { variant: 'ghost', onClick: copyVisible }),
    button('Save debug log…', { variant: 'ghost', onClick: saveLog }),
  );

  const view = h('div', { class: 'view view--fill' },
    viewHead('Logs', 'The release debug log — live from this session (last 1000 entries).',
      [logLevelToggle(), followHost]),
    toolbar,
    card({ class: 'card--flush', style: { padding: '0' } }, list),
  );
  repaint();
  return view;
}
