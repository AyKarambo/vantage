/** Home / Overview — priority maps at a glance, the way you locked it in. */
import { h, render } from '../dom';
import type { DashboardData, Group, PlacementRunSummary, SessionDebrief } from '../../../src/shared/contract';
import { dayKey, dayPartAt, MAP_MIN_GAMES } from '../../../src/core/analytics';
import { COST_MIN_SAMPLE } from '../../../src/core/mentalAnalytics';
import { READINESS_TUNING } from '../../../src/core/readiness';
import { isStale } from '../../../src/core/staleness';
import { makeMapMode } from '../../../src/core/masterData/resolver';
import { dateLong, greeting, int, pct, relTime, roleLabel, signed, streakText } from '../format';
import { placementParts, rankParts } from '../../../src/core/rankDisplay';
import { PALETTE, wrColor, wrHsl, modeColor } from '../theme';
import { scatterChart, sparkline, type ScatterPoint } from '../charts/plots';
import { button, calendarHeatmap, card, chip, kpiCard, statBar, statBox, unlockHint } from '../components/primitives';
import { clickableRow } from '../components/clickableRow';
import { inlineLink } from '../components/inlineLink';
import { practiceTargetButton } from '../components/practiceTargetButton';
import { stopRuleLine } from '../components/stopRuleLine';
import { openPlacementComplete } from '../app/placementComplete';
import { openManageRanks } from './settings/accounts';
import { prefs } from '../prefs';
import { store } from '../store';
import { viewHead, shorten, type ViewContext } from './view';
import { coachHeadline } from '../coachHeadline';

export function overview(ctx: ViewContext): HTMLElement {
  const d = ctx.data;

  const head = viewHead(
    `${greeting()}, ${d.greetingName}`,
    headlineSub(ctx),
    button('Log match', { variant: 'primary', onClick: ctx.openLogMatch }),
  );

  return h('div', { class: 'view' },
    head,
    nextUpStrip(ctx),
    hiddenHistoryBanner(ctx),
    firstWeekUnlockCard(ctx),
    recapCard(ctx),
    kpiRow(ctx),
    roleStrip(ctx),
    scatterCard(ctx),
    bottomRow(ctx),
  );
}

/**
 * A per-role winrate strip under the KPIs (O4) — the default "All roles"
 * filter blends every role into one Winrate number, so "which role is
 * bleeding?" used to need a trip to Trends even though `byRole` was already
 * on the payload and the Role filter is one click away. Hidden with fewer
 * than 2 roles (nothing to compare). Labels stay plain text (not the
 * winrate-tinted colour Trends' breakdown uses) since `chip` — reused here
 * rather than a bespoke control — only takes a string label.
 */
function roleStrip(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  const roles = d.options.roles;
  if (roles.length < 2) return null;
  const byRole = new Map(d.byRole.map((g) => [g.key, g]));
  return h('div', { class: 'role-strip' },
    chip('All', d.filters.role === 'all', () => ctx.setFilter({ role: 'all' })),
    ...roles.map((role) => {
      const g = byRole.get(role);
      const label = g ? `${roleLabel(role)} ${pct(g.winrate)} · ${g.games}g` : roleLabel(role);
      return chip(label, d.filters.role === role, () => ctx.setFilter({ role }));
    }),
  );
}

/**
 * "What do I do next?" (O3) — the landing screen used to never say. Highest
 * urgency first: matches GEP delivered with no result (invisible everywhere
 * but Review until now), then the ungraded backlog, then a placement run
 * waiting on the player to confirm its outcome (reusing {@link placementKpi}'s
 * own CTA so there's only one place that wiring lives). Hidden entirely with
 * nothing pending — this is an alert strip, not a permanent fixture.
 */
function nextUpStrip(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  const items: HTMLElement[] = [];
  if (d.pendingMatches.length > 0) {
    const n = d.pendingMatches.length;
    items.push(nextUpItem(`${n} match${n === 1 ? '' : 'es'} need${n === 1 ? 's' : ''} a result`, () => ctx.navigate('review')));
  }
  if (d.pendingReviews > 0) {
    items.push(nextUpItem(`${d.pendingReviews} game${d.pendingReviews === 1 ? '' : 's'} to review`, () => ctx.navigate('review')));
  }
  const awaiting = d.placements.find((p) => p.awaitingRank);
  if (awaiting) {
    items.push(nextUpItem('Confirm your rank', () => openPlacementComplete({
      account: awaiting.account,
      role: awaiting.role,
      suggestion: awaiting.latestPrediction,
      onDone: () => ctx.refresh(),
    })));
  }
  if (!items.length) return null;
  return h('div', { class: 'next-up' }, ...items);
}

function nextUpItem(label: string, onClick: () => void): HTMLElement {
  return h('button', { class: 'next-up-item', on: { click: onClick } }, label, h('span', { class: 'next-up-arrow' }, '→'));
}

/**
 * The Overview subtitle (O1): the strongest computed coaching read in place
 * of the same "you're 51% — here's where the points are hiding" line every
 * day regardless of what's actually going on. A "Why →" jump follows it
 * straight to the screen that explains the number, when there is one.
 */
function headlineSub(ctx: ViewContext): Node {
  const headline = coachHeadline(ctx.data);
  const text = `${dateLong()} · ${headline.text}`;
  if (!headline.source) return document.createTextNode(text);
  const source = headline.source;
  const params = headline.params;
  return h('span', {},
    `${text} `,
    inlineLink('Why →', { onClick: () => ctx.navigate(source, params) }),
  );
}

/**
 * Safety net for a just-imported (or otherwise old) history: when the active
 * date window hides *every* game — filtered games 0 but all-time games > 0 —
 * the Overview would otherwise render a fully blank dashboard that reads as
 * "the import did nothing". Surface the count and a one-click way to see it.
 */
function hiddenHistoryBanner(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  if (d.overall.games > 0 || d.totalGamesAllTime === 0 || d.filters.days === 'all') return null;
  const n = d.totalGamesAllTime;
  return card({ variant: 'glow', title: 'Your history is outside this date range' },
    h('div', { class: 'hint', style: { lineHeight: '1.55', marginBottom: '12px' } },
      `You have ${int(n)} game${n === 1 ? '' : 's'} in your history, but none in the selected range — imported matches often carry older dates. View your full history to see them.`),
    button(`View all time (${int(n)} games)`, { variant: 'primary', onClick: () => ctx.setFilter({ days: 'all' }) }),
  );
}

/**
 * The first-week unlock ladder (F2) — appears once the demo season has
 * actually retired (shell.ts's `announceDemoRetired` resets the dismissed
 * pref) so a returning player who used to see 149 demo games, 4 demo
 * accounts and a handful of sample targets isn't left wondering where it all
 * went with nothing said about it. States the exact floors that gate Focus,
 * Mental's cost breakdowns and Readiness — reading the real constants those
 * screens themselves gate on, so this can never drift out of sync with what
 * actually unlocks. Auto-hides once the highest floor clears even without an
 * explicit dismiss — nothing left on the ladder to announce by then.
 */
function firstWeekUnlockCard(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  if (d.isSample || d.totalGamesAllTime === 0 || d.totalGamesAllTime >= READINESS_TUNING.minGames) return null;
  if (prefs.get('firstRealGameBannerDismissed') ?? false) return null;
  const dismiss = (): void => { prefs.set('firstRealGameBannerDismissed', true); store.rerender(); };
  return card({ variant: 'glow', title: 'A few things unlock as you play' },
    h('ul', { class: 'hint', style: { lineHeight: '1.7', margin: '0 0 12px', paddingLeft: '18px' } },
      h('li', null, `${MAP_MIN_GAMES} games on a map — Focus starts ranking it`),
      h('li', null, `${COST_MIN_SAMPLE} flagged games — Mental shows what tilt and comms actually cost you`),
      h('li', null, `${READINESS_TUNING.minGames} games over ${READINESS_TUNING.minSpanDays} days — Readiness starts reading your form`),
    ),
    button('Got it', { variant: 'ghost', onClick: dismiss }),
  );
}

/**
 * Last session's debrief (S3) — the trailing gap-based sitting, once it has
 * closed (a still-open one is the sidebar's live "Current session" card).
 * Dismissing COLLAPSES it to a one-line sub rather than removing it outright
 * — the reopen affordance stays visible instead of vanishing until the next
 * sitting closes — keyed by `endedAt` via the `recapShown` pref, so a new
 * sitting's debrief always starts expanded.
 */
function recapCard(ctx: ViewContext): HTMLElement | null {
  const r = ctx.data.recap;
  if (!r) return null;
  const key = String(r.endedAt);
  const host = h('div');
  const openMatches = (): void => ctx.navigate('matches', { day: dayKey(r.startedAt) });
  const titleText = `Last session · ${sessionLabel(r.endedAt)} · ${r.games} game${r.games === 1 ? '' : 's'}`;

  const drawCollapsed = (): void => {
    render(host, h('div', {
      class: 'hint', style: { margin: '-4px 0 12px', cursor: 'pointer', lineHeight: '1.5' },
      title: 'Show last session again',
      on: { click: () => { prefs.remove('recapShown'); drawExpanded(); } },
    }, `${titleText} — ${r.wins}–${r.losses}. `, h('span', { class: 'u-dim' }, 'Show again')));
  };

  const drawExpanded = (): void => {
    const dismiss = (): void => { prefs.set('recapShown', key); drawCollapsed(); };
    const boxes = [
      statBox(h('span', { class: r.net >= 0 ? 'is-win' : 'is-loss' }, `${r.wins}–${r.losses}`), `${signed(r.net)} net`),
      statBox(pct(r.winrate), 'winrate'),
      ...(r.srDelta !== undefined ? [statBox(`${signed(Math.round(r.srDelta))}%`, 'SR change')] : []),
      ...(r.bestMap ? [statBox(shorten(r.bestMap), 'best map')] : []),
      ...(r.targetHitRate !== undefined ? [statBox(pct(r.targetHitRate), 'targets hit')] : []),
    ].slice(0, 4);
    render(host, card({
      variant: 'glow',
      title: titleText,
      sub: recapLine(r),
      actions: button('✕', { variant: 'ghost', title: 'Collapse (shows the sitting again next time)', onClick: dismiss }),
    },
      h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${boxes.length}, 1fr)`, gap: '10px', marginTop: '4px' } }, ...boxes),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        r.ungradedMatchIds.length
          ? button(`Review these ${r.ungradedMatchIds.length} game${r.ungradedMatchIds.length === 1 ? '' : 's'} →`, { variant: 'soft', onClick: () => ctx.navigate('review') })
          : null,
        button('View games →', { variant: 'ghost', onClick: openMatches }),
      ),
    ));
  };

  (prefs.get('recapShown') === key ? drawCollapsed : drawExpanded)();
  return host;
}

/** "Tue evening" — the day-part bucket {@link dayPartAt} already uses elsewhere, so this never names a different window than the Trends time-of-day card would. */
function sessionLabel(endedAt: number): string {
  const d = new Date(endedAt);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${dayPartAt(d.getHours()).toLowerCase()}`;
}

function recapLine(r: SessionDebrief): string {
  const bits = [`${r.wins}–${r.losses}`];
  if (r.worstMap) bits.push(`toughest: ${r.worstMap}`);
  if (r.flags.tilt) bits.push(`tilt flagged ×${r.flags.tilt}`);
  return bits.join(' · ');
}

/**
 * The Streak KPI's secondary line (C7). "Reset it" used to fire on ANY loss
 * streak — even one loss read as an urgent nudge. Now it only fires once the
 * streak reaches the real break-reminder threshold (or 3, when the reminder
 * itself is off — still a real "maybe pause" number, just not user-tuned).
 * Below that, or with no streak at all, the line falls back to something
 * actually informative: the current sitting's tally, or how long ago the
 * last game was.
 */
function streakDelta(d: DashboardData): { text: string; dir?: 'up' | 'down' } {
  const s = d.streak;
  if (s.type === 'W') return { text: 'ride it', dir: 'up' };
  if (s.type === 'L') {
    const threshold = d.breakReminder.enabled ? d.breakReminder.afterLosses : 3;
    if (s.count >= threshold) return { text: 'reset it', dir: 'down' };
  }
  // Defensive against an empty-string role (seen from the filter bar in some
  // states) as well as the normal 'all' — either way, no suffix is the honest
  // "no role scope" read, not a dangling " · " with nothing after it.
  const roleSuffix = d.filters.role && d.filters.role !== 'all' ? ` · ${roleLabel(d.filters.role)}` : '';
  if (d.session) return { text: `${d.session.wins}–${d.session.losses} this session${roleSuffix}` };
  const last = d.matches[0]?.timestamp;
  return { text: last ? `last game ${relTime(last)}${roleSuffix}` : '—' };
}

function kpiRow(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const trendDelta = wrTrendDelta(d.trend, d.overall.winrate);
  // C4: `d.trend`'s own bucketing (matches dashboardData's `weekly` flag) — the
  // old "recent" label never said whether that meant days or weeks, or how many.
  const byWeek = d.filters.days === 'all' || (typeof d.filters.days === 'number' && d.filters.days > 90);
  const bucketWord = byWeek ? 'weeks' : 'days';
  // C3: a period-over-period read beside the existing smoothed delta — "is
  // this range up or down from the one before it", not just "is the last
  // few days up or down from this range's own average". Winrate needs
  // decided games on both sides to mean anything; the games count doesn't.
  const prev = d.previous;
  const prevDecided = prev ? prev.overall.wins + prev.overall.losses : 0;
  const curDecided = d.overall.wins + d.overall.losses;
  const winrateSub = prev && prevDecided && curDecided
    ? `vs ${prev.label}: ${signed(Math.round((d.overall.winrate - prev.overall.winrate) * 1000) / 10)} pts`
    : undefined;
  const gamesSub = prev ? `vs ${prev.label}: ${signed(d.overall.games - prev.overall.games)} games` : undefined;
  // O4: every KPI now drills down somewhere — the spec's old "no per-KPI
  // navigation" line predated the app-wide back-stack drill-down model the
  // scatter dot and every other cross-link already follow, and was stale
  // rather than protective.
  return h('div', { class: 'kpi-row' },
    kpiCard({
      label: 'Winrate',
      value: d.overall.games ? pct(d.overall.winrate) : '–',
      delta: trendDelta != null
        ? { text: `${trendDelta >= 0 ? '▴' : '▾'} ${Math.round(Math.abs(trendDelta))} pts · last 5 ${bucketWord}`, dir: trendDelta >= 0 ? 'up' : 'down' }
        : undefined,
      title: trendDelta != null ? `Mean winrate of your last 5 ${bucketWord} vs the range average` : undefined,
      sub: winrateSub,
      onClick: () => ctx.navigate('trends'),
    }),
    kpiCard({
      label: 'Games', value: int(d.overall.games),
      // The draws that WinLoss already carries were silently missing here.
      delta: { text: `${d.overall.wins}W · ${d.overall.losses}L${d.overall.draws > 0 ? ` · ${d.overall.draws}D` : ''}` },
      sub: gamesSub,
      onClick: () => ctx.navigate('matches'),
    }),
    rankKpi(ctx),
    kpiCard({
      label: 'Streak',
      value: streakText(d.streak),
      accent: true,
      delta: streakDelta(d),
      // C7: the "ride it"/"reset it" cue is the actionable read; best/worst
      // in range is real context that doesn't need to fight it for space.
      title: `Best W${d.extremes.longestWin} · worst L${d.extremes.longestLoss} in range`,
      onClick: () => ctx.navigate('matches'),
    }),
  );
}

/**
 * Rank KPI — the user's real anchored rank when set, else the winrate heuristic.
 * The anchored rank always wins, so setting a rank in Settings is reflected here.
 * This is the ONE surface that shows the anchor→now movement arrow (▴/▾/neutral),
 * so it's the only caller that passes `movement` to the shared rank renderer —
 * and the arrow is truthful (no more hard-coded `dir: 'up'`).
 *
 * While the anchored (account, role) track is in an OPEN placement run, none of
 * that applies — Overwatch shows no ±%, no protection and no movement during
 * placements — so this renders `Placements N/10` (+ the latest prediction, when
 * one exists) instead, via the shared {@link placementParts}. Once that run is
 * `awaitingRank`, {@link placementKpi} swaps the prediction for the "confirm
 * your rank" label and a `Confirm rank` CTA — Overview is the home screen, so
 * this is the main place the player meets it.
 */
function rankKpi(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const r = d.primaryRank;
  if (r) {
    const openRun = d.placements.find((p) => p.account === r.account && p.role === r.role && !p.completed);
    if (openRun) return placementKpi(openRun, ctx);
    // Short: the KPI value is 22px mono in a ~153px card at the 1040px minimum
    // window, where "Grandmaster 3" wraps to a second line and unbalances the row.
    const p = rankParts({ tier: r.tier, division: r.division, progressPct: r.progressPct, protected: r.protected, movement: r.movement, short: true });
    const arrow = p.movementDir === 'up' ? '▴ ' : p.movementDir === 'down' ? '▾ ' : '';
    // The magnitude itself, not just its direction (C1) — `r.movement` was
    // already computed and threaded through for exactly this, but the tile
    // used to reduce it to a bare arrow and show the UNRELATED in-division
    // buffer % next to it, so "how much" never actually appeared anywhere.
    const moved = p.movementDir !== 'neutral' ? `${signed(Math.round(r.movement))}% since anchor · ` : '';
    const context = r.protected ? `${p.bufferPctText} · rank protected` : `${p.bufferPctText} in division`;
    return kpiCard({
      label: 'Rank',
      // Short: 22px mono in a ~153px card at the 1040px minimum window, with
      // no room for "Grandmaster 3" on one line.
      value: `${p.rankLabel}${p.shield ? ' 🛡' : ''}`,
      delta: {
        text: `${arrow}${moved}${context}`,
        // Colour the arrow only when it actually points — neutral stays unstyled.
        ...(p.movementDir === 'up' ? { dir: 'up' as const } : p.movementDir === 'down' ? { dir: 'down' as const } : {}),
      },
      // O4: this branch has no action button of its own — the anchored
      // account is already known, so the drill-down skips the "which
      // account" guess the winrate-heuristic branch below needs.
      onClick: () => openManageRanks(r.account, () => ctx.refresh()),
    });
  }
  // No anchored rank — but check for an open run before falling back to the
  // winrate heuristic. An UNANCHORED track is the likeliest place to be placing
  // at all (a fresh account, a role never queued), and showing a winrate-derived
  // rank while the player is mid-placements is precisely the fabrication this
  // feature exists to remove. `primaryRank` is absent here, so the track comes
  // from the active filter scope instead.
  const scoped = d.placements.filter((p) =>
    !p.completed
    && (d.filters.account === 'all' || p.account === d.filters.account)
    && (d.filters.role === 'all' || p.role === d.filters.role));
  if (scoped.length === 1) return placementKpi(scoped[0], ctx);
  if (scoped.length > 1) {
    // Several tracks placing and nothing to disambiguate them: say that plainly
    // rather than picking one arbitrarily or reverting to the heuristic.
    return kpiCard({
      label: 'Rank', value: 'Placements', delta: { text: `${scoped.length} tracks in progress` },
      onClick: () => ctx.navigate('settings', { section: 'accounts' }),
    });
  }
  // Goes through `rankParts` like the anchored branch above rather than
  // composing the label by hand — the inline version bypassed the shared
  // renderer entirely and so was invisible to any change made there.
  const est = rankParts({
    tier: d.progression.tier, division: d.progression.division,
    progressPct: d.progression.progressPct, protected: false, short: true,
  });
  // C4: this used to glue a fake movement arrow (from `progression.delta`,
  // an unrelated recent-trend read) onto the in-division buffer %, with
  // nothing marking the whole tile as a winrate guess rather than ground
  // truth — the movement arrow stays anchored-branch-only now.
  const targetAccount = d.filters.account !== 'all' ? d.filters.account : d.options.accounts[0];
  return kpiCard({
    label: 'Rank',
    value: `${est.rankLabel} est.`,
    delta: { text: 'from winrate — no rank set' },
    ...(targetAccount
      ? { action: { label: 'Set rank', run: () => openManageRanks(targetAccount, () => ctx.refresh()) } }
      : {}),
  });
}

/**
 * The Rank KPI's shape for an OPEN placement run — shared by both of
 * {@link rankKpi}'s placement branches (the anchored track's own run, and the
 * "exactly one track placing" fallback) so the CTA is only wired once. Once
 * the run has counted out and is `awaitingRank`, the stale in-run prediction
 * is replaced with the "confirm your rank" label plus a `Confirm rank` button
 * that opens the same reveal-rank dialog every other surface uses (AC5).
 */
function placementKpi(run: PlacementRunSummary, ctx: ViewContext): HTMLElement {
  const pp = placementParts(run.counted, run.target, run.latestPrediction, run.awaitingRank);
  return kpiCard({
    label: 'Rank',
    value: pp.counter,
    delta: { text: pp.predictionLabel ?? pp.awaitingLabel ?? 'no prediction yet' },
    ...(run.awaitingRank
      ? {
          action: {
            label: 'Confirm rank',
            run: () => openPlacementComplete({
              account: run.account,
              role: run.role,
              suggestion: run.latestPrediction,
              onDone: () => ctx.refresh(),
            }),
          },
        }
      // Still placing (not yet awaiting a result): no action button of its
      // own, so the card itself drills down to where the run can be managed.
      : { onClick: () => ctx.navigate('settings', { section: 'accounts' }) }),
  });
}

/**
 * The Top-priority panel's empty state — same distinction Focus's own empty
 * state makes (F1): a genuinely clean season reads differently from a
 * first-week player whose maps just haven't reached the floor yet, which
 * the old "clean season" copy claimed either way.
 */
function scatterCalloutsEmpty(d: DashboardData): HTMLElement {
  const bestMapGames = Math.max(0, ...d.byMap.map((m) => m.games));
  if (bestMapGames < MAP_MIN_GAMES) {
    return h('div', { style: { paddingTop: '10px' } },
      unlockHint(`Unlocks at ${MAP_MIN_GAMES} games on a map`, [
        { have: bestMapGames, need: MAP_MIN_GAMES, label: 'games on your most-played map' },
      ]));
  }
  return h('div', { class: 'empty empty--good', style: { paddingTop: '10px' } }, 'No net-losing maps — clean season. 🎯');
}

function scatterCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const points = toScatter(d.byMap, makeMapMode(d.masterData.maps));
  const focus = d.focusMaps.filter((f) => f.net > 0).slice(0, 3);
  // H1: a map the master-data catalog marks out of the competitive pool still
  // gets a row (it happened, it stays in the picture) but is flagged — same
  // "Out of pool" read Focus's own map rows give it.
  const isActive = new Map(d.masterData.maps.map((m) => [m.name, m.isActive]));

  const callouts = h('div', { class: 'scatter-callouts' },
    h('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--loss-text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' } }, 'Top priority'),
    ...(focus.length
      ? focus.map((m) => h('div', {
          class: 'row', style: { cursor: 'pointer' },
          // O4: a real clickable row (keyboard-reachable, same as every other
          // row in the app) instead of a plain div with a click handler —
          // the obvious click, the map name, used to do nothing.
          ...clickableRow(() => ctx.navigate('matches', { map: m.key })),
        },
          h('span', { class: 'dot', style: { background: wrHsl(m.winrate) } }),
          h('div', { class: 'row-main' },
            h('div', { class: 'row-name', style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
              m.key,
              isActive.get(m.key) === false
                ? h('span', { class: 'tag', title: 'Not in the current competitive map pool' }, 'Out of pool')
                : null),
            h('div', { class: 'row-meta', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              `${m.games} games · net ${signed(m.wins - m.losses)}`,
              // O4: the same "＋ target" quick-create Focus gives every row —
              // the Overview tease used to make you go to Focus just to act on it.
              practiceTargetButton(ctx, 'map', m.key),
            ),
          ),
          h('span', { class: 'mono', style: { fontSize: '14px', color: wrColor(m.winrate) } }, pct(m.winrate)),
        ))
      : [scatterCalloutsEmpty(d)]),
    h('div', { style: { marginTop: 'auto', paddingTop: '12px' } },
      h('div', { class: 'hint', style: { lineHeight: '1.55' } }, 'These are dragging your season. Practice them before ranked and review one replay each.'),
      h('div', { style: { marginTop: '10px' } },
        button('Open Focus →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('focus') }),
      ),
    ),
  );

  return card(
    { title: 'Every map · winrate × volume', sub: 'Below the line = losing. Further right = you play it a lot. Fix the bottom-right first. Click a dot to open its matches.', style: { flex: '1' } },
    h('div', { class: 'overview-scatter' },
      h('div', { class: 'scatter-plot' },
        scatterChart(points, (name) => ctx.navigate('matches', { map: name })),
        scatterLegend(points)),
      callouts,
    ),
  );
}

/**
 * Legend of the game MODES in the scatter (O2), not the maps — dot colour
 * encodes mode, so a per-map legend entry would repeat the same swatch up to
 * a dozen times and couldn't identify anything at a full ~30-map pool. At
 * most 7 modes exist, so this never needs its own scroll/wrap handling the
 * old 33-item map legend did.
 */
function scatterLegend(points: ScatterPoint[]): HTMLElement {
  const byMode = new Map<string, { color: string; games: number }>();
  for (const p of points) {
    const m = byMode.get(p.mode) ?? { color: p.color, games: 0 };
    m.games += p.volume;
    byMode.set(p.mode, m);
  }
  const modes = [...byMode.entries()].sort((a, b) => b[1].games - a[1].games);
  return h('div', { class: 'chart-legend' },
    ...modes.map(([mode, m]) =>
      h('span', { class: 'legend-item', title: `${mode} · ${m.games} games` },
        h('span', { class: 'legend-dot', style: { background: m.color } }), mode),
    ),
  );
}

/**
 * Bottom row = Activity + Mental + Readiness + Active targets + Heroes (O3).
 * The old "Focus queue" card was removed deliberately (issue #71): the
 * scatter's "Top priority" callout above is the Overview's single Focus
 * tease — Focus itself is the hub. Active targets and Heroes are a
 * different tease: the coaching-loop and per-hero pictures TargetSummary and
 * byHero already carry on every payload, previously visible only after a
 * trip to Targets or Heroes.
 */
function bottomRow(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const m = d.mental;
  const r = d.breakReminder;
  const mental = card({ title: 'Mental', sub: 'two independent 0–100 reads, not a split', style: { flex: '1' } },
    h('div', { class: 'stack', style: { gap: '9px' } },
      statBar({
        label: 'Calm', frac: m.calm / 100, color: PALETTE.win, valueText: `${m.calm}%`,
        title: 'Calm — blends not-tilted games with positive-comms games',
      }),
      statBar({
        label: 'Tilted', frac: m.tilted / 100, color: PALETTE.loss, valueText: `${m.tilted}%`,
        title: `Tilted — ${m.flags.tilt} of ${d.overall.games} games flagged tilted`,
      }),
    ),
    h('div', { class: 'hint', style: { marginTop: '11px', lineHeight: '1.45' } },
      r.enabled
        ? h('span', null, 'Break reminder is ', h('span', { class: 'is-win' }, 'on'), ` after ${r.afterLosses} losses.`)
        : h('span', { class: 'u-dim' }, 'Break reminder is off — turn it on in Mental.')),
    stopRuleLine(ctx),
  );

  return h('div', { class: 'overview-bottom' },
    activityCard(ctx), mental, readinessCard(ctx), activeTargetsCard(ctx), overviewHeroesCard(ctx));
}

/**
 * "What am I actively grading?" (O3) — the coaching loop is improvement
 * targets, but the Overview used to only tease them as the recap's
 * "targets hit" box (usually just "—"). One row per active, non-archived
 * target: name, hit-rate sparkline (the same trend Targets' own screen
 * plots), and a stale tag when it's overdue for rotation — the same
 * {@link isStale} check the Targets active-set panel already gates its own
 * nudge on, so this can never disagree with it.
 */
function activeTargetsCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const active = d.targets.filter((t) => t.isActive && !t.archivedAt);
  if (!active.length) {
    return card({ title: 'Active targets', style: { flex: '1' } },
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'No active target — pick one from the library → ',
        inlineLink('Targets', { onClick: () => ctx.navigate('targets') })));
  }
  const now = Date.now();
  return card({ title: 'Active targets', style: { flex: '1' } },
    h('div', { class: 'stack', style: { gap: '8px' } },
      ...active.map((t) => {
        const stale = isStale(t.activatedAt, t.matchesSinceActive, now, d.staleness);
        return h('div', {
          style: { display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' },
          ...clickableRow(() => ctx.navigate('targetDetail', { targetId: t.id })),
        },
          h('span', {
            class: 'row-main', style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12.5px' },
          }, t.name),
          sparkline(t.spark, { width: 46, height: 16, color: wrColor(t.hitRate) }),
          h('span', { class: 'mono', style: { fontSize: '12.5px', color: wrColor(t.hitRate), flex: '0 0 auto' } }, pct(t.hitRate)),
          stale ? h('span', { style: { fontSize: '10px', color: 'var(--warn-text)', flex: '0 0 auto' }, title: 'Overdue for rotation' }, 'stale') : null,
        );
      }),
    ),
  );
}

/**
 * "How am I doing on the heroes I actually play?" (O3) — the scatter and
 * Focus tease are maps-only, so hero form ("Hazard 40% over 5 games") was
 * only ever visible on the Heroes screen even though `byHero` rides on every
 * payload. Top 5 by games; clicking one flashes its row on Heroes (same
 * cross-link pattern Maps' mode cards use for the ranking below them).
 */
function overviewHeroesCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const top = [...d.byHero].sort((a, b) => b.games - a.games).slice(0, 5);
  if (!top.length) {
    return card({ title: 'Heroes', style: { flex: '1' } }, h('div', { class: 'hint' }, 'No hero data in this range yet.'));
  }
  return card({ title: 'Heroes', style: { flex: '1' } },
    h('div', { class: 'stack', style: { gap: '5px' } },
      ...top.map((hs) => h('div', {
        style: { cursor: 'pointer' },
        ...clickableRow(() => ctx.navigate('heroes', { highlight: hs.key })),
      },
        statBar({ label: hs.key, frac: hs.winrate, color: wrColor(hs.winrate), valueText: `${pct(hs.winrate)} · ${hs.games}g` }),
      )),
    ),
  );
}

/** Games/day activity heatmap, moved here from Trends (issue #116) — an
 *  at-a-glance read belongs on the landing screen, not the momentum screen. */
function activityCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  return card(
    // The window now follows the active filter (O5) rather than a fixed 35 —
    // saying the real span here is the honest "what am I looking at" answer.
    { title: 'Activity', sub: `last ${d.calendar.length} days`, style: { flex: '1' } },
    calendarHeatmap(d.calendar, (date) => ctx.navigate('matches', { day: date })),
    h('div', { class: 'hint', style: { marginTop: '11px', lineHeight: '1.45' } },
      'games/day · colour = winrate · click a day to open its matches'),
  );
}

const READINESS_META: Record<string, { label: string; color: string }> = {
  fresh: { label: 'Fresh', color: PALETTE.win },
  steady: { label: 'Steady', color: PALETTE.win },
  loaded: { label: 'Loaded', color: PALETTE.mid },
  'in-the-hole': { label: 'In the hole', color: PALETTE.loss },
  recovering: { label: 'Recovering', color: PALETTE.accentBright },
  rusty: { label: 'Rusty', color: PALETTE.info },
  'insufficient-data': { label: 'Not enough data', color: PALETTE.muted },
};

/** Compact readiness teaser — only when the feature is on; deep-links to the
 *  screen. Exported for the Live screen's idle "before you queue" briefing (S1). */
export function readinessCard(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  if (!d.readinessSettings.enabled) return null;
  const r = d.readiness;
  const meta = READINESS_META[r.band] ?? READINESS_META['insufficient-data'];
  const showScore = r.score !== null && r.confidence !== 'low';
  return card({ title: 'Readiness', style: { flex: '1' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', marginTop: '2px' } },
      h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: meta.color, flex: '0 0 auto' } }),
      h('span', { style: { fontSize: '15px', fontWeight: '600' } }, meta.label),
      showScore ? h('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '15px', color: meta.color } }, String(r.score)) : null,
    ),
    h('div', { class: 'hint', style: { marginTop: '9px', lineHeight: '1.45' } }, r.recommendationText || r.headline),
    h('div', { style: { marginTop: '10px' } },
      button('Open readiness →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('readiness') }),
    ),
  );
}

// --- helpers ----------------------------------------------------------------

function toScatter(byMap: Group[], mapModeOf: (name: string) => string): ScatterPoint[] {
  // Most-played first, so the legend leads with the most-relevant modes.
  return [...byMap]
    .sort((a, b) => b.games - a.games)
    .map((m) => {
      const net = m.losses - m.wins;
      const mode = mapModeOf(m.key);
      return {
        name: m.key,
        short: shorten(m.key),
        mode,
        // O2: dot colour encodes the game MODE (7 stable hues), not a
        // per-map index — the old CATEGORICAL[i % 11] repeated every 11
        // maps, so with a full ~30-map pool every colour was shared by
        // three unrelated maps and the legend couldn't identify a dot.
        color: modeColor(mode),
        winrate: m.winrate,
        volume: m.games,
        net,
        focus: net >= 3,
      };
    });
}

/**
 * Recent form vs the range average, in winrate points. Uses the mean of the last
 * few buckets rather than a single bucket, so it doesn't swing on one good day.
 */
function wrTrendDelta(trend: Group[], baseline: number): number | null {
  if (trend.length < 3) return null;
  const recent = trend.slice(-5);
  const mean = recent.reduce((sum, b) => sum + b.winrate, 0) / recent.length;
  return (mean - baseline) * 100;
}
