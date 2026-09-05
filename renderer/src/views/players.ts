/**
 * Players — the browsable directory of everyone you have met, searchable and
 * sortable, scoped by the filter bar.
 *
 * The mirror image of `playerHistory`, which it opens: THIS screen answers "who
 * did I meet in this range?", the drill-down answers "what is my complete record
 * with this person?". The two counts legitimately differ, so both screens say
 * which they show, in the same words, before the user gets there.
 *
 * Sorting, searching and capping all happen on MAIN, over the full matched set
 * (see `core/playerIndex` selectPlayers). The renderer never re-sorts: sorting a
 * capped page would answer "the most recent among your 200 most-played-with",
 * with no visible tell that the row you wanted was cut before the sort ran.
 */
import { h, must, render } from '../dom';
import type { PlayerList, PlayerListRow, PlayerSortKey } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { pct, relTime, roleLabel } from '../format';
import { button, card, chip, emptyState } from '../components/primitives';
import { dataTable, type Column } from '../components/table';
import { prefs } from '../prefs';
import { wrColor } from '../theme';
import { viewHead, type ViewContext } from './view';

/** The minimum-games chip steps, mirroring the Heroes screen's idiom. */
const MIN_GAMES_STEPS = [1, 2, 5, 10] as const;
const SORT_KEYS: readonly PlayerSortKey[] = ['name', 'games', 'with', 'vs', 'lastSeen'];
/** How long typing must pause before a keystroke costs a round trip. */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * View-local state, deliberately module-level.
 *
 * Every other view is a pure function of `ctx`, and this one is not: `render()`
 * is `replaceChildren`, so routing a keystroke through `store.rerender()` would
 * destroy the focused `<input>` and the caret with it. The search box therefore
 * has to own its text and repaint only its own table host — the palette's
 * pattern. The cost is that two Players views could not coexist, which the
 * router makes impossible anyway.
 */
let search = '';
let payload: PlayerList | null = null;
let payloadKey = '';
/** Monotonic request id; only the newest response may paint. */
let seq = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;

/** The persisted sort, validated — localStorage is untrusted input. */
function restoreSort(): { key: PlayerSortKey; dir: 1 | -1 } {
  const saved = prefs.get('playerSort');
  const key = SORT_KEYS.find((k) => k === saved?.key);
  return key ? { key, dir: saved!.dir === 1 ? 1 : -1 } : { key: 'games', dir: -1 };
}

function minGamesPref(): number {
  const n = prefs.get('minPlayerGames');
  return MIN_GAMES_STEPS.find((s) => s === n) ?? 1;
}

/** "Damage · Season 15 · Karambo" — always names the filters, even at defaults,
 *  so a count on this screen is never mistaken for an all-time one. */
function scopeLabel(p: PlayerList, ctx: ViewContext): string {
  const s = p.scope;
  let season: string;
  if (typeof s.days === 'object') {
    const id = s.days.season;
    season = ctx.data.options.seasons.find((x) => x.id === id)?.label ?? 'one season';
  } else {
    season = s.days === 'all' ? 'all time' : `last ${s.days} days`;
  }
  return [
    s.role === 'all' ? 'all roles' : roleLabel(s.role),
    season,
    s.account === 'all' ? 'all accounts' : s.account,
  ].join(' · ');
}

const wl = (w: { wins: number; losses: number }): HTMLElement => {
  const n = w.wins + w.losses;
  if (!n) return h('span', { class: 'u-muted', title: 'No decided games on that side.' }, '–');
  return h('span', { style: { color: wrColor(w.wins / n) } }, `${w.wins}W ${w.losses}L`);
};

function columns(): Array<Column<PlayerListRow>> {
  // `get` is inert here — `onSort` bypasses dataTable's local sorting entirely —
  // but it still returns the same rank core orders by, so the two can't drift if
  // a future caller ever does sort locally.
  return [
    {
      key: 'name', label: 'Player', get: (r) => r.name,
      render: (r) => h('span', null,
        r.name,
        r.ambiguous
          ? h('span', {
              class: 'u-dim',
              style: { marginLeft: '6px' },
              title: 'More than one BattleTag is folded into this name — players are matched by the name before the #.',
            }, '⚠')
          : null,
      ),
    },
    { key: 'games', label: 'Games together', get: (r) => r.games },
    { key: 'with', label: 'With me', get: (r) => r.sameTeam.wins, render: (r) => wl(r.sameTeam) },
    { key: 'vs', label: 'Against me', get: (r) => r.enemyTeam.wins, render: (r) => wl(r.enemyTeam) },
    { key: 'lastSeen', label: 'Last seen', get: (r) => r.lastSeen, render: (r) => relTime(r.lastSeen) },
  ];
}

export function players(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });
  const tableHost = h('div', null, h('div', { class: 'hint' }, 'Loading players…'));
  const footNote = h('div', { class: 'hint', style: { marginTop: '8px' } });
  let sort = restoreSort();
  let minGames = minGamesPref();

  const searchInput = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Search a player…',
    value: search,
    'aria-label': 'Search players by name',
  }) as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (debounce) clearTimeout(debounce);
    void load();
  });

  const chipRow = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });
  function paintChips(): void {
    render(chipRow,
      h('span', { class: 'u-dim', style: { fontSize: '11px' } }, 'min. games'),
      ...MIN_GAMES_STEPS.map((n) => chip(`${n}+`, minGames === n, () => {
        minGames = n;
        prefs.set('minPlayerGames', n);
        paintChips();
        void load();
      })),
    );
  }
  paintChips();

  const head = viewHead('Players', 'Loading…', h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, chipRow, searchInput));
  const scopeNote = h('div', { class: 'hint', style: { margin: '0 0 12px' } });

  render(host, head, scopeNote, card({ class: 'card--flush', style: { padding: '4px 10px 10px' } }, tableHost, footNote));

  /**
   * Everything that changes what the list should contain. `generatedAt` is in
   * the key so a newly tracked match forces a refetch, while navigating away and
   * back on the same snapshot costs nothing.
   */
  const requestKey = (): string =>
    JSON.stringify([ctx.data.generatedAt, ctx.data.filters, search, minGames, sort.key, sort.dir]);

  async function load(): Promise<void> {
    const key = requestKey();
    const mine = ++seq;
    if (payload && payloadKey === key) { paint(payload); return; }
    // Dim rather than blank: typing must never flash an empty table.
    tableHost.style.opacity = payload ? '0.55' : '1';
    try {
      const p = await bridge.playerList({
        filters: ctx.data.filters, search, minGames, sort: sort.key, dir: sort.dir,
      });
      if (mine !== seq || !host.isConnected) return;
      payload = p;
      payloadKey = key;
      paint(p);
    } catch {
      if (mine !== seq || !host.isConnected) return;
      tableHost.style.opacity = '1';
      render(footNote, h('button', {
        class: 'stale-link',
        on: { click: () => void load() },
      }, "⚠ Couldn't refresh the player list — retry"));
    }
  }

  function paint(p: PlayerList): void {
    tableHost.style.opacity = '1';
    const scope = scopeLabel(p, ctx);
    must('.view-sub', head).textContent =
      `${p.totalInScope.toLocaleString()} ${p.totalInScope === 1 ? 'player' : 'players'} met in this filter scope · ${scope}`;
    scopeNote.textContent =
      `Counts on this screen are scoped to the filter bar: ${scope}. Opening a player shows their `
      + 'complete all-time record, which the filters never touch.';

    const empty = emptyBranch(p);
    if (empty) {
      render(tableHost, empty);
      render(footNote);
      return;
    }

    render(tableHost, dataTable({
      columns: columns(),
      rows: p.rows,
      // From the ECHO, never local state — the arrow cannot point at a column
      // the rows are not actually ordered by, not even for one frame.
      initialSort: { key: p.sort, dir: p.dir },
      onSort: (next) => {
        sort = { key: SORT_KEYS.find((k) => k === next.key) ?? 'games', dir: next.dir };
        prefs.set('playerSort', sort);
        void load();
      },
      onRowClick: (row) => ctx.navigate('playerHistory', { playerName: row.name }),
    }));
    render(footNote, h('span', null, p.matched > p.rows.length
      ? `Showing the top ${p.rows.length} of ${p.matched.toLocaleString()} matching players. The search, `
        + `the minimum and the sorting all run over all ${p.matched.toLocaleString()} — this is the real `
        + `top ${p.rows.length}, not the first ${p.rows.length}.`
      : `All ${p.matched.toLocaleString()} matching ${p.matched === 1 ? 'player' : 'players'} shown.`));
  }

  /**
   * The empty states, in order of what the user can do about them. Rendered into
   * `tableHost` only, so the search box and chips stay mounted and focused.
   */
  function emptyBranch(p: PlayerList): HTMLElement | null {
    if (p.rows.length) return null;
    const wrap = (...kids: Array<Node | string | null>): HTMLElement =>
      h('div', { style: { padding: '18px 4px' } }, ...kids);

    if (!ctx.data.hasRealHistory && !ctx.data.isSample) {
      return wrap(
        emptyState('No matches tracked yet.'),
        h('div', { class: 'hint', style: { margin: '8px 0' } },
          'Player names come from the scoreboard the game shows at the end of a match, so they appear '
          + 'once Vantage has tracked a live game.'),
        button('Log a match', { variant: 'soft', onClick: () => ctx.openLogMatch() }),
      );
    }
    if (p.scannedGames === 0) {
      return wrap(
        emptyState('No games in this filter scope.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          ctx.data.filters.days !== 'all'
            ? button('Show all time', { variant: 'soft', onClick: () => ctx.setFilter({ days: 'all' }) })
            : null,
          button('Reset filters', { variant: 'ghost', onClick: () => ctx.setFilter({ role: 'all', days: 'all' }) }),
        ),
      );
    }
    if (p.gamesWithRoster === 0) {
      // Must never read as "you've met nobody" — and there is nothing to click.
      return wrap(
        emptyState(`No player names in these ${p.scannedGames.toLocaleString()} games.`),
        h('div', { class: 'hint', style: { marginTop: '8px' } },
          'Rosters come from the live game feed — hand-logged matches, imports and older captures '
          + "don't carry one. Newly tracked matches will fill this in."),
      );
    }
    if (p.totalInScope === 0) {
      return wrap(emptyState('The games in this scope reported a scoreboard with no player names.'));
    }
    if (!p.appliedSearch) {
      return wrap(
        emptyState(`No player has ${p.appliedMinGames}+ games with you in this scope — `
          + `${p.totalInScope.toLocaleString()} met in total.`),
        h('div', { style: { marginTop: '10px' } },
          button('Show 1+', {
            variant: 'soft',
            onClick: () => { minGames = 1; prefs.set('minPlayerGames', 1); paintChips(); void load(); },
          })),
      );
    }
    return wrap(
      emptyState(`No player matching “${p.appliedSearch}” in this scope.`
        + (p.appliedMinGames > 1 ? ` The ${p.appliedMinGames}+ minimum is also applied.` : '')),
      h('div', { class: 'hint', style: { margin: '8px 0' } },
        'Search matches the name before the # — Nova#1111 and Nova#2222 are the same player here.'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        button('Clear search', {
          variant: 'soft',
          onClick: () => { search = ''; searchInput.value = ''; void load(); },
        }),
        p.appliedMinGames > 1
          ? button('Show 1+', {
              variant: 'ghost',
              onClick: () => { minGames = 1; prefs.set('minPlayerGames', 1); paintChips(); void load(); },
            })
          : null,
        // Never say "you've never met them" — they may well be outside the scope.
        ctx.data.filters.days !== 'all' || ctx.data.filters.role !== 'all'
          ? button('Search all time', {
              variant: 'ghost',
              onClick: () => ctx.setFilter({ role: 'all', days: 'all' }),
            })
          : null,
      ),
    );
  }

  void load();
  return host;
}
