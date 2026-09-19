/**
 * The Ctrl+K command palette: fuzzy-matched navigation, actions, and data
 * search (maps, heroes, targets, players, recent matches — the current
 * snapshot). Keyboard driven: type to filter, ↑/↓ to move, Enter to run,
 * Escape to close.
 *
 * A query the snapshot comes up thin on (M5) also reaches into FULL history —
 * `bridge.searchMatches`, debounced — appended under its own 'All history'
 * group once it resolves; every other group stays synchronous over `ctx.data`.
 */
import { h, render } from '../dom';
import type { ViewId } from '../store';
import { fuzzyRank } from '../fuzzy';
import { relTime, roleLabel } from '../format';
import { openModal } from '../components/overlay';
import type { ViewContext } from '../views/view';
import { openHeroDrawer } from '../views/heroes';
import { bridge } from '../bridge';

interface PaletteItem {
  label: string;
  /** A free-text note (e.g. a game count, a current-state read). */
  hint?: string;
  /** A literal keyboard shortcut, rendered as `.kbd` instead of plain text (e.g. 'Ctrl L', 'Ctrl 4'). */
  kbd?: string;
  group: string;
  /** Extra match text beyond the label (e.g. hero names on a match row). */
  keywords?: string;
  /** A Screen row's own sidebar icon (K6) — a fresh Node per row, never the sidebar's own instance. */
  icon?: Node;
  run: () => void;
}

export interface PaletteNav {
  id: ViewId;
  label: string;
  /** Pre-formatted digit shortcut ('Ctrl 4'), when this screen has one. */
  kbd?: string;
  /** The same inline-SVG icon the sidebar shows for this screen (K6), reused so a Screen row is recognizable at a glance instead of relying on the label alone. */
  icon?: Node;
}

export interface PaletteExtras {
  nav: PaletteNav[];
  /** Extra actions the shell contributes (log match, tour, settings toggles, …). */
  actions: Array<{ label: string; hint?: string; kbd?: string; run: () => void }>;
}

/** Query length + snapshot-hit floor that triggers the async history reach (M5). */
const HISTORY_SEARCH_MIN_QUERY = 3;
const HISTORY_SEARCH_MAX_SNAPSHOT_HITS = 12;
const HISTORY_SEARCH_DEBOUNCE_MS = 200;
const HISTORY_SEARCH_LIMIT = 8;

export function openPalette(ctx: ViewContext, extras: PaletteExtras): void {
  const items = buildItems(ctx, extras);

  openModal((close) => {
    const input = h('input', {
      class: 'palette-input',
      type: 'text',
      placeholder: 'Jump to a screen, run an action, find a map / hero / target / player / match…',
      'aria-label': 'Command palette',
    }) as HTMLInputElement;
    const list = h('div', { class: 'palette-list' });

    let ranked: PaletteItem[] = [];
    let selected = 0;

    // The full-history reach (M5): keyed to the query it answered, so a stale
    // response from a since-edited query never paints, and a repeated query
    // (arrow-up through what you just typed) doesn't cost a second round trip.
    let historyQuery = '';
    let historyHits: PaletteItem[] = [];
    let historySeq = 0;
    let historyDebounce: ReturnType<typeof setTimeout> | undefined;

    const scheduleHistorySearch = (q: string): void => {
      if (historyDebounce) clearTimeout(historyDebounce);
      historyDebounce = setTimeout(() => {
        const mine = ++historySeq;
        void bridge.searchMatches({ filters: ctx.data.filters, q, limit: HISTORY_SEARCH_LIMIT })
          .then((rows) => {
            // Stale if superseded, the query moved on, or the palette closed
            // (openModal's `close()` detaches `list` from the document).
            if (mine !== historySeq || input.value.trim() !== q || !list.isConnected) return;
            historyQuery = q;
            historyHits = rows.map((m) => ({
              label: `${m.result} · ${m.map}`,
              hint: relTime(m.timestamp),
              group: 'All history',
              keywords: `${m.heroes.join(' ')} ${m.gameType} ${m.account}`,
              run: () => ctx.navigate('matchDetail', { matchId: m.matchId }),
            }));
            paint();
          })
          .catch(() => {});
      }, HISTORY_SEARCH_DEBOUNCE_MS);
    };

    const paint = (): void => {
      const q = input.value.trim();
      // Empty query: curated default order (actions first — Enter = log match).
      const snapshotHits = q
        ? fuzzyRank(q, items, (i) => `${i.label} ${i.keywords ?? ''}`).slice(0, 12)
        : items.slice(0, 12);
      // The cheap first step (M5): for ANY non-empty query, a direct path to
      // the Players screen's own full search — it reaches players this
      // snapshot's small `recentPlayers` slice doesn't cover at all.
      const findPlayer: PaletteItem[] = q
        ? [{ label: `Find player "${q}" on Players`, group: 'Player', run: () => ctx.navigate('players', { search: q }) }]
        : [];
      const history = q && q === historyQuery ? historyHits : [];
      ranked = [...snapshotHits, ...findPlayer, ...history];
      selected = Math.min(selected, Math.max(0, ranked.length - 1));
      render(list,
        ranked.length
          ? ranked.map((item, i) =>
              h('div', {
                class: `palette-item${i === selected ? ' is-selected' : ''}`,
                on: {
                  click: () => {
                    close();
                    item.run();
                  },
                  mousemove: () => {
                    if (selected !== i) {
                      selected = i;
                      paint();
                    }
                  },
                },
              },
                h('span', { class: 'palette-group' }, item.group),
                item.icon ? h('span', { class: 'palette-icon' }, item.icon) : null,
                h('span', { class: 'palette-label' }, item.label),
                item.kbd
                  ? h('span', { class: 'kbd' }, item.kbd)
                  : item.hint ? h('span', { class: 'palette-hint' }, item.hint) : null,
              ),
            )
          : [h('div', { class: 'empty', style: { padding: '14px' } }, 'No matches.')],
      );

      // A snapshot answer under 12 hits (this screen's own reach, past the
      // "Find player" fallback and any earlier history group) is worth
      // reaching into full history for — the box used to have nothing past
      // the current filtered range's most recent 30 matches.
      if (q.length >= HISTORY_SEARCH_MIN_QUERY && snapshotHits.length < HISTORY_SEARCH_MAX_SNAPSHOT_HITS && q !== historyQuery) {
        scheduleHistorySearch(q);
      }
    };

    input.addEventListener('input', () => {
      selected = 0;
      paint();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        selected = (selected + d + ranked.length) % Math.max(1, ranked.length);
        paint();
      } else if (e.key === 'Enter' && ranked[selected]) {
        e.preventDefault();
        close();
        ranked[selected].run();
      }
    });

    paint();
    setTimeout(() => input.focus(), 0);
    return h('div', { class: 'palette' }, input, list);
  });
}

function buildItems(ctx: ViewContext, extras: PaletteExtras): PaletteItem[] {
  const d = ctx.data;
  const items: PaletteItem[] = [];

  for (const a of extras.actions) {
    items.push({ label: a.label, hint: a.hint, kbd: a.kbd, group: 'Action', run: a.run });
  }
  for (const n of extras.nav) {
    items.push({ label: n.label, kbd: n.kbd, icon: n.icon, group: 'Screen', run: () => ctx.navigate(n.id) });
  }
  for (const m of d.byMap) {
    items.push({
      label: m.key,
      hint: `${m.games} games`,
      group: 'Map',
      run: () => ctx.navigate('matches', { map: m.key }),
    });
  }
  for (const hs of d.heroStats) {
    items.push({
      label: hs.hero,
      hint: `${roleLabel(hs.role ?? '')} · ${hs.games} games`,
      group: 'Hero',
      run: () => openHeroDrawer(ctx, hs.hero),
    });
  }
  // The Targets and Players screens both exist, searchable, but the palette
  // never reached them — "did I play with Pixel?" meant Ctrl+K → Players →
  // click the search box → type (M5).
  for (const t of d.targets) {
    items.push({
      label: t.name,
      hint: `${t.mode === 'measured' ? '⚡ measured' : '◎ self'}${t.archivedAt ? ' · archived' : !t.isActive ? ' · inactive' : ''}`,
      group: 'Target',
      run: () => ctx.navigate('targetDetail', { targetId: t.id }),
    });
  }
  for (const p of d.recentPlayers) {
    items.push({
      label: p.name,
      hint: `${p.games} game${p.games === 1 ? '' : 's'} together`,
      group: 'Player',
      run: () => ctx.navigate('playerHistory', { playerName: p.name }),
    });
  }
  for (const m of d.matches.slice(0, 30)) {
    items.push({
      label: `${m.result} · ${m.map}`,
      hint: relTime(m.timestamp),
      group: 'Match',
      keywords: `${m.heroes.join(' ')} ${m.gameType} ${m.account}`,
      run: () => ctx.navigate('matchDetail', { matchId: m.matchId }),
    });
  }
  return items;
}
