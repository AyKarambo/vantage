/**
 * Match detail — the parameterized drill-down behind a Matches row click.
 * Every section renders only when its data exists, so the page degrades
 * tier-by-tier: a minimal legacy record still gets a full header, richer
 * records add scoreboard, tabs, progress, and player history.
 * No share/publish affordance anywhere (spec: Share URL is out of scope).
 */
import { applyStyle, h, render } from '../dom';
import type { MatchDetail, MatchDetailHeroStat, MatchMental, MatchRow, PlacementRunSummary, PlayerEncounter, RankEntryPreview, RankSummary, Role, TargetGrade, TargetSummary, UsualPer10 } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { dateLong, fmt, fmt1, isToday, prettyDay, rankLabel, relTime, roleLabel, signed, time, toDatetimeLocal, RELATION_LABEL } from '../format';
import { rankParts } from '../../../src/core/rankDisplay';
import { badge, button, card, confirmButton, pill, RESULT_LETTER, RESULT_STATE, segmented, statBar, statBox } from '../components/primitives';
import { openModal } from '../components/overlay';
import { maybeConfirmPlacementRank } from '../app/placementComplete';
import { openManageRanks } from './settings/accounts';
import { srEntryMode } from '../../../src/core/placements';
import { GRADES, targetGradeRow, bindTargetGradeKeys, mentalFlagChips, commsToneSwitch } from '../components/reviewControls';
import { resultChooser, bindResultKeys, bindSaveKeys } from '../components/resultChooser';
import { dialogHeader } from '../components/dialogHeader';
import { performanceSlider } from '../components/performanceSlider';
import { paintHeroChips } from '../components/heroPicker';
import { mapPicker, resolveMapName, notKnownMapHint, type MapPickerEntry } from '../components/mapPicker';
import { field, optionalLabel } from '../components/formField';
import { srModeToggle, srDeltaInput, rankEntry, placementPicker, suggestedSrDelta, type SrMode } from '../components/srControls';
import { prefs, DEFAULT_SUGGESTED_HEROES } from '../prefs';
import { toast } from '../components/toast';
import { inlineLink } from '../components/inlineLink';
import { clickableRow } from '../components/clickableRow';
import { scoreboard } from '../components/scoreboard';
import { store } from '../store';
import { gradedThisSession } from '../reviews';
import { deleteMatch } from '../matchActions';
import { leaverFlags } from '../../../src/core/leaver';
import { commsTone } from '../../../src/core/comms';
import { classifyGameType } from '../../../src/core/matchFilter';
import { heroLines, combinedHeroLine, type PerTen } from '../../../src/core/perHero';
import { matchInTargetScope } from '../../../src/core/targets';
import { groupByDay } from '../../../src/core/analytics';
import { PALETTE, wrHsl } from '../theme';
import { openHeroDrawer } from './heroes';
import { backControl, type ViewContext } from './view';

const ROLE_OPTS: Array<{ value: Role; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' }, { value: 'openQ', label: 'Open Q' },
];
/**
 * The editor's map pool: every known map, plus the match's `current` map even
 * when master data no longer knows it (shown muted) — so opening an old match
 * on a rotated-out or renamed map never blanks or silently changes it (spec AC 25).
 */
function editorMapPool(ctx: ViewContext, current: string): MapPickerEntry[] {
  const maps = ctx.data.masterData.maps;
  if (!current || maps.some((m) => m.name === current)) return maps;
  return [...maps, { name: current, isActive: false }];
}

const RESULT_TEXT: Record<string, string> = { Win: 'Victory', Loss: 'Defeat', Draw: 'Draw' };

/**
 * Subtle marker for an auto-tracked match whose game facts were hand-corrected
 * in the editor — the record keeps its ⚡ auto provenance. Presence of
 * `factsEditedAt` (only ever set on GEP records) is the signal.
 */
function editedPill(): HTMLElement {
  const p = pill('edited');
  p.title = 'Game facts hand-corrected — this match was auto-tracked from the game feed.';
  return p;
}

export function matchDetail(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });
  const matchId = ctx.params.matchId;
  if (!matchId) {
    render(host, backRow(ctx), card({}, h('div', { class: 'empty' }, 'No match selected.')));
    return host;
  }
  render(host, backRow(ctx), card({}, h('div', { class: 'hint' }, 'Loading match…')));
  bridge.matchDetail(matchId, ctx.data.filters).then((d) => {
    if (!d) {
      // Self-healing net for an out-of-band delete (the MCP server, another
      // window): tell the back stack so every later Back skips this entry.
      store.noteMatchDeleted(matchId);
      render(host, backRow(ctx), card({}, h('div', { class: 'empty' }, 'This match is no longer in your history.')));
      return;
    }
    render(host, backRow(ctx), ...sections(d, ctx));
  });
  return host;
}

/** Back control + prev/next steppers through the filtered match list (also ←/→). */
function backRow(ctx: ViewContext): HTMLElement {
  const matches = ctx.data.matches;
  const matchId = ctx.params.matchId;
  const idx = matches.findIndex((m) => m.matchId === matchId);
  const older = idx >= 0 ? matches[idx + 1] : undefined;
  const newer = idx >= 0 ? matches[idx - 1] : undefined;
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
    // The shared ← — where it leads depends on how you got here, which is the
    // whole point; the old fixed "← Matches" lied on a player → match chain.
    backControl(),
    h('span', { style: { flex: '1' } }),
    button('‹ Older', {
      variant: 'ghost', disabled: !older, title: 'Previous match (←)',
      onClick: () => older && ctx.navigate('matchDetail', { matchId: older.matchId }),
    }),
    idx >= 0 && matchId ? dayStrip(ctx, matches, matchId) : null,
    button('Newer ›', {
      variant: 'ghost', disabled: !newer, title: 'Next match (→)',
      onClick: () => newer && ctx.navigate('matchDetail', { matchId: newer.matchId }),
    }),
  );
}

/**
 * Session-aware stepper (M4): the plain "n / 150" over the whole filtered
 * list gave no sense of where this game sat in its OWN sitting — game 2 of 7?
 * third loss in a row? — and reaching game 5 of yesterday meant five blind
 * "Older" clicks. Renders the current match's day group (always by calendar
 * day, renderer-only — independent of the Matches screen's own by-day/by-
 * sitting pref) as a strip of small W/L/D letters, oldest first, the current
 * one outlined and every other one clickable straight to that match. The
 * global "n / N [loaded]" stays underneath as smaller, secondary text.
 */
function dayStrip(ctx: ViewContext, matches: MatchRow[], matchId: string): HTMLElement | null {
  const group = groupByDay(matches).find((g) => g.items.some((m) => m.matchId === matchId));
  if (!group) return null;
  const chronological = [...group.items].sort((a, b) => a.timestamp - b.timestamp);
  const gameNumber = chronological.findIndex((m) => m.matchId === matchId) + 1;
  const wl = group.draws > 0 ? `${group.wins}–${group.losses}–${group.draws}` : `${group.wins}–${group.losses}`;
  const idx = matches.findIndex((m) => m.matchId === matchId);
  const loaded = idx >= 0 && ctx.data.matchesTotal > matches.length;
  return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
    h('div', { style: { display: 'flex', gap: '3px' } },
      ...chronological.map((m) => {
        const isCurrent = m.matchId === matchId;
        return h('span', {
          class: `match-result match-result--sm is-${RESULT_STATE[m.result]}${isCurrent ? ' is-current' : ''}`,
          title: isCurrent ? 'This match' : `${RESULT_TEXT[m.result] ?? m.result} · ${relTime(m.timestamp)} ago`,
          ...(isCurrent ? {} : clickableRow(() => ctx.navigate('matchDetail', { matchId: m.matchId }))),
        }, RESULT_LETTER[m.result]);
      }),
    ),
    h('div', { class: 'mono u-dim', style: { fontSize: '10.5px' } },
      `Game ${gameNumber} of ${chronological.length} · ${prettyDay(group.label)} · ${wl}`),
    idx >= 0
      ? h('div', { class: 'mono u-dim', style: { fontSize: '9.5px', opacity: '0.7' } },
          `${idx + 1} / ${matches.length}${loaded ? ' loaded' : ''}`)
      : null,
  );
}

function sections(d: MatchDetail, ctx: ViewContext): Node[] {
  return [
    header(d, ctx),
    scoreboardSection(d, ctx),
    perHeroSection(d.perHero, d.playedMinutes, d.playedSource),
    competitiveSection(d.competitive, d.account, ctx, d.srDelta, d.rankAtStart),
    gradesSection(d, ctx),
    playerHistorySection(d, ctx),
  ].filter((n): n is HTMLElement => n != null);
}

// --- header (always renders — derives from fields every record has) ----------

function header(d: MatchDetail, ctx: ViewContext): HTMLElement {
  const state = RESULT_STATE[d.result];
  // Vantage is competitive-only, so the mode reads "RANKED" on every match —
  // pure noise. Only surface it for the rare non-competitive record (e.g. a
  // legacy import), never for the competitive norm.
  const showMode = classifyGameType(d.gameType) !== 'competitive';
  const meta = h('div', { class: 'detail-meta' },
    pill(d.mapType, 'accent'),
    showMode ? h('span', null, d.gameType) : null,
    showMode ? h('span', null, '·') : null,
    h('span', null, roleLabel(d.role), ' · ', accountLink(d.account, ctx)),
    h('span', null, '·'),
    // The absolute date and time (M4), not just a relative age — a match from
    // three weeks ago used to never state WHEN it was played; the relative
    // age still lives in the title for a quick hover.
    h('span', { title: `${relTime(d.timestamp)} ago` }, `${dateLong(d.timestamp)} · ${time(d.timestamp)}`),
    d.factsEditedAt != null ? editedPill() : null,
  );
  return card({ class: 'detail-head' },
    h('div', { class: 'detail-head-main' },
      h('div', { class: `detail-result is-${state}` }, RESULT_TEXT[d.result] ?? d.result),
      // The richest page about a match used to have fewer exits than its own
      // row — the row already links the map and every hero (M4).
      h('h1', { class: 'detail-map' },
        inlineLink(d.map, {
          strong: true,
          title: `Find ${d.map} on the Maps screen`,
          onClick: () => ctx.navigate('maps', { highlight: d.map }),
        }),
      ),
      meta,
      mentalFlags(d),
      h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
        button('✎ Edit match', {
          variant: 'soft',
          title: 'Edit this match — result, map, role, heroes, SR %, flags, and target grades',
          onClick: () => openMatchEditor(ctx, d),
        }),
        // Only offered while ungraded (R4) — once a review exists, the Grades
        // card below already shows it; re-opening Review from here would just
        // land on an "all caught up" inbox that no longer has this match.
        d.review == null
          ? button('Grade on Review', {
              variant: 'ghost',
              title: 'Grade this match on the Review screen',
              onClick: () => ctx.navigate('review', { matchId: d.matchId }),
            })
          : null,
        confirmButton({
          label: 'Delete match',
          confirmLabel: "Delete permanently — can't be undone",
          variant: 'ghost',
          title: 'Remove this match from your history',
          confirmTitle: `Permanently deletes your ${d.map} ${d.result.toLowerCase()} — this can't be undone`,
          onConfirm: (reset) => {
            void deleteMatch(d, reset).then((deleted) => {
              // Only leave the page on an actual delete — a failed/no-op
              // attempt (see deleteMatch) already told the player why via
              // its own toast, and this page is still perfectly valid.
              if (deleted) store.goBack();
            });
          },
        }),
      ),
    ),
    h('div', { class: 'detail-head-side' },
      d.finalScore ? statBox(h('span', { class: 'mono' }, d.finalScore), 'Round score') : null,
      // Duration is the wall clock (match start → end); Played is the time the
      // player could actually fight — the divisor behind every per-10 stat.
      d.durationMinutes != null ? statBox(`${d.durationMinutes}m`, 'Duration') : null,
      d.playedMinutes != null ? statBox(`${d.playedMinutes.toFixed(1)}m`, d.playedSource === 'estimated' ? 'Played (est.)' : 'Played') : null,
      d.heroes.length
        ? h('div', { class: 'detail-heroes' },
            h('div', { class: 'stat-box-label' }, 'Heroes played'),
            h('div', { class: 'detail-hero-pills' }, ...d.heroes.map((name) => heroPillLink(name, ctx))),
          )
        : null,
    ),
  );
}

/** The account name as a click-through to filter the whole app to it (M4) — mirrors the map/hero links right beside it. */
function accountLink(account: string, ctx: ViewContext): HTMLElement {
  return inlineLink(account, {
    title: `Filter to ${account}`,
    onClick: (e) => { e.stopPropagation(); ctx.setFilter({ account }); },
  });
}

/** A heroes-played pill that opens that hero's drill-down (M4) — same pill styling, now clickable like the row's own hero links. */
function heroPillLink(name: string, ctx: ViewContext): HTMLElement {
  return h('span', {
    class: 'pill',
    title: `Open ${name}'s drill-down`,
    ...clickableRow(() => openHeroDrawer(ctx, name)),
  }, name);
}

/**
 * The feel/leaver pill row for a match, reading the merged manual layer —
 * the quick-log self-report (`d.mental`) overlaid key-by-key with the saved
 * Review flags (`d.review.flags`), the same seed the match editor builds —
 * so flags graded only on the Review screen show up too. Null when nothing
 * is flagged. Rendered read-only in the Grades card.
 */
function mentalFlags(d: MatchDetail): HTMLElement | null {
  const m: MatchMental = { ...(d.mental ?? {}), ...(d.review?.flags ?? {}) };
  const lv = leaverFlags(m);
  const flags: Node[] = [];
  if (m.tilt) flags.push(pill('Tilt', 'loss'));
  if (m.toxicMates) flags.push(pill('Toxic mates', 'loss'));
  if (lv.myTeam) flags.push(pill('Leaver — my team', 'draw'));
  if (lv.enemyTeam) flags.push(pill('Leaver — enemy', 'draw'));
  const tone = commsTone(m);
  if (tone === 'positive') flags.push(pill('Positive comms', 'win'));
  else if (tone === 'banter') flags.push(pill('Banter', 'draw'));
  else if (tone === 'abusive') flags.push(pill('Abusive comms', 'loss'));
  return flags.length ? h('div', { class: 'detail-flags' }, ...flags) : null;
}

// --- scoreboard (roster tier → full board; per-hero tier → your rows only) ---

function scoreboardSection(d: MatchDetail, ctx: ViewContext): HTMLElement | null {
  if (!d.scoreboard?.length) return null;
  const localOnly = d.scoreboard.every((e) => e.isLocal);
  return card(
    {
      title: 'Scoreboard',
      sub: localOnly ? 'only your own line was recorded for this match' : 'as reported by the game feed',
      class: 'card--flush detail-scoreboard',
    },
    scoreboard(d.scoreboard, (name) => ctx.navigate('playerHistory', { playerName: name }), { totals: true }),
  );
}

// --- per-hero tabs ------------------------------------------------------------

/** One counting stat's presentation rules (H8): the "more/less" wording, the value format, and which delta direction reads as an improvement. */
const STAT_META: Record<keyof UsualPer10, { label: string; more: string; less: string; compact: boolean; invert: boolean }> = {
  eliminations: { label: 'Elims/10', more: 'more eliminations', less: 'fewer eliminations', compact: false, invert: false },
  deaths: { label: 'Deaths/10', more: 'more deaths', less: 'fewer deaths', compact: false, invert: true },
  assists: { label: 'Assists/10', more: 'more assists', less: 'fewer assists', compact: false, invert: false },
  damage: { label: 'DMG/10', more: 'more damage', less: 'less damage', compact: true, invert: false },
  healing: { label: 'HEAL/10', more: 'more healing', less: 'less healing', compact: true, invert: false },
  mitigation: { label: 'MIT/10', more: 'more mitigation', less: 'less mitigation', compact: true, invert: false },
};
const STAT_KEYS = Object.keys(STAT_META) as Array<keyof UsualPer10>;

/** `fmt`/`fmt1`-formatted, always signed with the app's U+2212 minus (`signed`'s own glyph) — the small `.stat-box-delta` line's own format, distinct from `signed()` itself (which doesn't round or compact-format). */
function signedFmt(delta: number, compact: boolean): string {
  const rounded = compact ? Math.round(delta) : Math.round(delta * 10) / 10;
  const abs = compact ? fmt(Math.abs(rounded)) : fmt1(Math.abs(rounded));
  return rounded > 0 ? `+${abs}` : rounded < 0 ? `−${abs}` : abs;
}

/** A statBox with an optional small "vs your usual" delta line under the label (H8) — a local variant of the shared `statBox`, since that component has no third slot. */
function heroStatBox(value: string, key: keyof UsualPer10, actual: number | undefined, usual: UsualPer10 | null): HTMLElement {
  const meta = STAT_META[key];
  const delta = actual != null && usual != null ? actual - usual[key] : null;
  const rounded = delta == null ? null : meta.compact ? Math.round(delta) : Math.round(delta * 10) / 10;
  const state = rounded == null || rounded === 0 ? 'u-dim' : (meta.invert ? rounded < 0 : rounded > 0) ? 'is-win' : 'is-loss';
  return h('div', { class: 'stat-box' },
    h('div', { class: 'stat-box-value' }, value),
    h('div', { class: 'stat-box-label' }, meta.label),
    rounded == null
      ? null
      : h('div', { class: `mono stat-box-delta ${state}` }, `vs usual ${signedFmt(rounded, meta.compact)}`),
  );
}

/**
 * "vs your usual on `<hero>`: fewer deaths (5.6 vs 6.8), less healing (11k vs
 * 12.4k)" — the up-to-two most notable deltas (H8), so the card leads with
 * what actually stands out instead of making the player scan all six boxes.
 * `null` when there's no baseline, or nothing moved enough to be worth saying.
 */
function usualSummaryLine(hero: string, per10: PerTen | null, usual: UsualPer10 | null): HTMLElement | null {
  if (!per10 || !usual) return null;
  const entries = STAT_KEYS.map((key) => {
    const meta = STAT_META[key];
    const actual = per10[key];
    const base = usual[key];
    const delta = actual - base;
    const rounded = meta.compact ? Math.round(delta) : Math.round(delta * 10) / 10;
    // Relative to the baseline, not the raw point delta — a raw sort would
    // always crown DMG/HEAL/MIT (thousands) over Elims/Deaths/Assists
    // (single digits) regardless of which one actually stands out for THIS hero.
    const relative = base !== 0 ? Math.abs(delta) / Math.abs(base) : (delta !== 0 ? Infinity : 0);
    return { key, meta, actual, base, delta: rounded, relative };
  }).filter((e) => e.delta !== 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b.relative - a.relative);
  const fmtVal = (n: number, compact: boolean): string => (compact ? fmt(n) : fmt1(n));
  const clauses = entries.slice(0, 2).map((e) =>
    `${e.delta > 0 ? e.meta.more : e.meta.less} (${fmtVal(e.actual, e.meta.compact)} vs ${fmtVal(e.base, e.meta.compact)})`);
  return h('div', { class: 'hint', style: { marginTop: '10px' } }, `vs your usual on ${hero}: ${clauses.join(', ')}`);
}

function perHeroSection(
  perHero: MatchDetailHeroStat[],
  playedMinutes: number | undefined,
  playedSource: MatchDetail['playedSource'],
): HTMLElement | null {
  if (!perHero.length) return null;
  // Counting stats are per-10 minutes PLAYED on that hero (real swap-timed
  // minutes when available, else an equal split of the match's played time);
  // KDA stays a raw ratio. A match with no usable played time dashes the per-10
  // stats but still shows KDA. The rows arrive with their minutes already on the
  // played-time basis, so this stays presentation-only.
  const lines = heroLines(perHero, playedMinutes);
  // With more than one hero, lead with an "All" tab combining every hero's stats
  // (per-10 over the whole played time); a single-hero match already IS its own total.
  const all = combinedHeroLine(perHero, playedMinutes);
  const tabLines = all && lines.length > 1 ? [all, ...lines] : lines;
  // usual isn't carried through heroLines (it's not a HeroStat field, and
  // combining it across heroes for the "All" tab wouldn't mean anything) —
  // looked up directly against the original per-hero rows instead (H8).
  const usualByHero = new Map(perHero.map((s) => [s.hero, s.usual]));
  const body = h('div', { class: 'stat-grid stat-grid--wide' });
  const summaryHost = h('div');
  const draw = (hero: string): void => {
    const s = tabLines.find((x) => x.hero === hero) ?? tabLines[0];
    const p = s.per10;
    const usual = usualByHero.get(s.hero) ?? null;
    render(body,
      heroStatBox(fmt1(p?.eliminations), 'eliminations', p?.eliminations, usual),
      heroStatBox(fmt1(p?.assists), 'assists', p?.assists, usual),
      heroStatBox(fmt1(p?.deaths), 'deaths', p?.deaths, usual),
      statBox(s.kda.toFixed(1), 'KDA'),
      heroStatBox(fmt(p?.damage), 'damage', p?.damage, usual),
      heroStatBox(fmt(p?.healing), 'healing', p?.healing, usual),
      heroStatBox(fmt(p?.mitigation), 'mitigation', p?.mitigation, usual),
    );
    render(summaryHost, usualSummaryLine(s.hero, p, usual));
  };
  draw(tabLines[0].hero);
  // Minutes on the hero, right on the tab (H8) — a 1.5-minute swap and a
  // 12-minute main used to read identically ("Kiriko" either way).
  const tabs = tabLines.length > 1
    ? segmented({
        options: tabLines.map((s) => ({ value: s.hero, label: s.minutes != null ? `${s.hero} · ${s.minutes.toFixed(1)}m` : s.hero })),
        value: tabLines[0].hero,
        onChange: draw,
      })
    : null;
  // An older capture without round events had its played time estimated from
  // the wall clock — say so, quietly, next to the numbers it scales.
  const basis = playedSource === 'estimated' ? 'per 10 minutes played (est.)' : 'per 10 minutes played';
  return card(
    { title: 'Per hero', sub: `${basis} · KDA is a ratio · vs your last 30 games on each hero (5+ needed)`, actions: tabs },
    body, summaryHost,
  );
}


// --- competitive progress (calculated from your rank anchor + logged SR) ------

const NOTE_LABEL: Record<string, string> = {
  calculated: 'Calculated', reconstructed: 'Reconstructed', estimate: 'Estimated from winrate', reported: 'Reported',
  // 'pre-reset' (C4) used to fall through to the raw code as its own pill
  // text — reuses playerHistory's own wording for the same case.
  'pre-reset': 'Before reset',
};
const NOTE_SUB: Record<string, string> = {
  calculated: 'from the rank you set + logged SR — the game feed does not report rank',
  reconstructed: 'reconstructed backward from the rank you set — best-effort, may drift on missing SR',
  estimate: 'a winrate-based guess, not a measured number',
  reported: 'reported by the game feed',
  'pre-reset': 'Before your last placement reset — the ladder is discontinuous there.',
};

function competitiveSection(
  c: MatchDetail['competitive'],
  account: string,
  ctx: ViewContext,
  srDelta?: number,
  rankAtStart?: MatchDetail['rankAtStart'],
): HTMLElement | null {
  if (!c) return null;
  const isEstimate = c.note === 'estimate';
  const withinDivision = !isEstimate && c.progressPct != null ? c.progressPct / 100 : null;
  // Shared rank parts (no movement arrow on match detail). A reconstructed
  // (backward) match flattens protection, so never draw the 🛡 there even if a
  // stray flag leaked through — it would imply a live buffer it doesn't have (G5).
  const parts = c.tier != null && c.division != null
    ? rankParts({
        tier: c.tier, division: c.division, progressPct: c.progressPct ?? 0,
        protected: (c.protected ?? false) && c.note !== 'reconstructed',
      })
    : null;
  return card(
    {
      title: 'Competitive progress',
      sub: NOTE_SUB[c.note] ?? c.note,
      actions: pill(NOTE_LABEL[c.note] ?? c.note, 'accent'),
    },
    h('div', { class: 'detail-progress' },
      parts
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            // C4: a winrate heuristic drawn in the exact same typography as a
            // real calculated rank read as a measured number — muted text and
            // no shield says plainly this is a guess, not ground truth.
            h('span', { class: isEstimate ? 'detail-rank u-muted' : 'detail-rank' }, parts.rankLabel),
            parts.shield ? pill('🛡 Rank protected', 'draw') : null,
          )
        : null,
      isEstimate
        // C4: a full division bar at a precise-looking "45%" implied a
        // measured number too — dropped along with the "over the range"
        // delta below (not a quantity the game ever shows), replaced with a
        // direct path to the real thing.
        ? button('Set your rank…', {
            variant: 'soft',
            title: 'Open Manage ranks for this account',
            onClick: () => { ctx.navigate('settings'); openManageRanks(account, () => ctx.refresh()); },
          })
        : parts?.shield
          // Protected = a negative carry; a clamped division bar labelled "-19%"
          // reads as broken, so show the buffer state as a hint instead.
          ? h('div', { class: 'hint' },
              `Holding the division — ${parts.bufferPctText} into the rank-protection buffer.`)
          : withinDivision != null
            ? statBar({ label: 'Division', frac: withinDivision, valueText: `${Math.round(c.progressPct!)}%`, color: PALETTE.accent })
            : null,
      // The SR change logged for this specific match — always shown when set
      // (typed or back-computed), regardless of whether a rank anchor exists.
      srDelta != null
        ? h('span', {
            class: 'mono',
            style: { fontSize: '12px', color: srDelta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' },
          }, `${signed(Math.round(srDelta))}% this match`)
        : (!isEstimate && c.delta != null)
          ? h('span', {
              class: 'mono',
              style: { fontSize: '12px', color: c.delta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' },
            }, `${signed(Math.round(c.delta))}% over the range`)
          : null,
    ),
    // Where the track stood going INTO this match — the STORED snapshot, not a
    // recomputed one, so it keeps saying what you actually saw at the time even
    // after an older match's ±% is corrected. Only ever present alongside a ±%.
    rankAtStart
      ? h('div', { class: 'hint', style: { marginTop: '6px' } },
          `Started this match at ${rankLabel(rankAtStart.tier, rankAtStart.division)} · ${Math.round(rankAtStart.progressPct)}%.`)
      : null,
  );
}

// --- grades (the manual layer, read-only — grading itself lives in the editor) --

/**
 * Read-only view of how the match was tracked: one row per graded active
 * target, the 0-100 performance rating, and the merged feel/leaver pills.
 * Null when none of the three exist, so an ungraded match skips the card
 * entirely — same degrade-by-section pattern as the rest of the page.
 */
function gradesSection(d: MatchDetail, ctx: ViewContext): HTMLElement | null {
  const selfGrades = d.review?.grades ?? {};
  const measured = d.measuredGrades ?? {};
  const rows = ctx.data.targets
    .filter((t) => t.isActive && !t.archivedAt)
    .flatMap((t) => {
      // Mode-aware: measured (⚡) targets show their auto-calculated grade (skipped
      // when the match can't measure them), self (◎) targets your stored grade.
      if (t.mode === 'measured') {
        const mg = measured[t.id];
        return mg && mg !== 'no-stat' ? [gradeRow(t, mg.grade)] : [];
      }
      // A self grade stored before the target picked up a scope that now
      // excludes this match no longer counts — mirrors the Review screen.
      const grade = selfGrades[t.id];
      return grade && matchInTargetScope(d, t) ? [gradeRow(t, grade)] : [];
    });
  const perf = d.performance != null
    ? statBar({
        label: 'Performance',
        frac: d.performance / 100,
        valueText: String(d.performance),
        color: wrHsl(d.performance / 100),
      })
    : null;
  const flags = mentalFlags(d);
  if (!rows.length && !perf && !flags) return null;
  return card(
    { title: 'Grades', sub: 'measured targets auto-graded from stats · self targets your manual read (✎ Edit match)' },
    h('div', { class: 'stack', style: { gap: '12px' } },
      rows.length ? h('div', { class: 'stack', style: { gap: '11px' } }, ...rows) : null,
      perf,
      flags,
    ),
  );
}

/** One graded target, read-only: name + rule left, its Hit/Partial/Missed pill right. */
function gradeRow(t: TargetSummary, grade: TargetGrade): HTMLElement {
  const spec = GRADES.find((o) => o.v === grade);
  const gradePill = pill(spec?.label ?? grade);
  if (spec) applyStyle(gradePill, { background: spec.bg, color: spec.fg });
  return h('div', { class: 'review-target' },
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, t.name),
      h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
    ),
    gradePill,
  );
}

// --- edit tracking (re-open the manual read for any match, graded or not) -----

/**
 * Fold a legacy `leaver` boolean into the my-team flag so its chip pre-selects.
 * The comms tone is left untouched — the shared three-state comms switch
 * (`commsToneSwitch`, see reviewControls) reads/writes it through `commsTone`,
 * so banter/abusive survive an unrelated edit.
 */
function normalizeFlags(m: MatchMental): MatchMental {
  const out: MatchMental = { ...m };
  if (out.leaver && !out.leaverMyTeam) out.leaverMyTeam = true;
  delete out.leaver;
  return out;
}

/**
 * Modal to edit a match: the game facts (result/role/map/heroes) and the manual
 * layer (SR %, mental flags incl. leaver-team, target grades) are all editable
 * on every match — an auto-tracked (GEP) result the feed got wrong can be
 * hand-corrected. Such a correction keeps the record's ⚡ auto provenance and
 * gains an "edited" marker (main stamps `factsEditedAt`). Saves go through
 * `editMatch`; `ctx.refresh()` re-pulls the detail so every dependent view
 * reflects the change.
 */
// Guards the async preload below: a rapid double-click on "Edit match" (or a
// second click before the first IPC round-trip resolves) would otherwise fire
// two preload chains and stack two independently-mounted editor modals — the
// buried one seeded with the pre-edit detail, able to silently revert a save.
let editorOpening = false;

function openMatchEditor(ctx: ViewContext, d: MatchDetail): void {
  if (editorOpening) return;
  editorOpening = true;
  // Preload mirrors the log card: current ranks feed the Set-current re-seed
  // on a role switch; per-account most-played heroes feed the picker shortlist.
  // Placement runs are fetched rather than read off ctx.data, which is a frozen
  // snapshot from when the ViewContext was minted: a run started elsewhere (the
  // Settings controls, or the offer after a logged match) would otherwise be
  // invisible here and the editor would offer ±% entry for a placement match.
  void Promise.all([bridge.getRanks(), bridge.mostPlayedHeroes(), bridge.getPlacements()]).then(
    ([ranks, mostPlayed, placements]) => {
      editorOpening = false;
      buildMatchEditor(ctx, d, ranks, mostPlayed, placements);
    },
    (err) => {
      editorOpening = false;
      throw err;
    },
  );
}

/**
 * {@link openMatchEditor} for a caller that only has a `matchId`, not an
 * already-fetched `MatchDetail` — the Matches row menu's "Edit match…" (R4),
 * which used to make the player open the row THEN click Edit inside it.
 * `editorOpening` still guards this path (shared with the detail page's own
 * button), so a rapid double-click here can't stack two editors either.
 */
export function openMatchEditorById(ctx: ViewContext, matchId: string): void {
  if (editorOpening) return;
  void bridge.matchDetail(matchId, ctx.data.filters).then((d) => {
    if (d) openMatchEditor(ctx, d);
  });
}

function buildMatchEditor(
  ctx: ViewContext,
  d: MatchDetail,
  ranks: RankSummary[],
  mostPlayed: Record<string, Partial<Record<Role, string[]>>>,
  placements: PlacementRunSummary[],
): void {
  // Self-rated targets scoped away from this match's hero/role aren't offered
  // here either — mirrors the Review screen; measured targets are unaffected
  // (their own read-only grade already skips out-of-scope matches).
  const active = ctx.data.targets.filter((t) =>
    t.isActive && !t.archivedAt && (t.mode === 'measured' || matchInTargetScope(d, t)));
  const grades: Record<string, TargetGrade> = { ...(d.review?.grades ?? {}) };
  const flags: MatchMental = normalizeFlags({ ...(d.mental ?? {}), ...(d.review?.flags ?? {}) });
  const isComp = classifyGameType(d.gameType) === 'competitive';
  const state = { result: d.result, role: d.role, map: d.map };
  // Full hero set (a hand-logged match can have several) — a role-filtered chip
  // grid, so editing never collapses the list to just the first hero.
  const heroes = new Set<string>(d.heroes);
  // SR entry pre-fills a suggested ±25 (Win/Loss) the player fine-tunes with the
  // wheel — GEP never reports SR. A stored value, or a manual edit, takes precedence.
  let srEdited = d.srDelta != null;
  let srDelta: number | undefined =
    d.srDelta ?? (isComp && state.result !== 'Draw' ? Number(suggestedSrDelta(state.result)) : undefined);
  let performance: number | undefined = d.performance;
  // Played time (L5) — editable only for a hand-logged match; a GEP capture's
  // timestamp is the instant the game itself ended, not something correctable
  // after the fact (the same "facts stay locked" rule the header note states).
  const isManual = d.source === 'manual';
  let playedAt = d.timestamp;
  // SR entry mirrors the log card: nudge the change, or set the rank you ended
  // at (main back-computes the %). The Set-current fields seed from the rank shown
  // on the card (reconstructed as of this match), so a drift-correction starts
  // from where you actually are.
  let srMode: SrMode = 'change';
  /** Latest translation of the picked rank into a ±%; see {@link rankEntry}. */
  let rankPreview: RankEntryPreview | undefined;
  let anchorTier = d.competitive?.tier ?? 'Gold';
  let anchorDivision = d.competitive?.division ?? 3;
  let anchorPct = d.competitive?.progressPct != null ? String(Math.round(d.competitive.progressPct)) : '';

  /**
   * Re-seed the Set-current picker (mirrors the log card's seedAnchorFromRanks,
   * so a role switch never leaves a stale prefilled rank): the match's own role
   * seeds from the rank reconstructed as of this match (the card's read); another
   * role seeds from that (account, role)'s current tracked rank; with nothing
   * tracked, the Gold / Div 3 / blank defaults stand.
   */
  const seedAnchor = (): void => {
    if (state.role === d.role) {
      anchorTier = d.competitive?.tier ?? 'Gold';
      anchorDivision = d.competitive?.division ?? 3;
      anchorPct = d.competitive?.progressPct != null ? String(Math.round(d.competitive.progressPct)) : '';
      return;
    }
    const r = ranks.find((x) => x.account === d.account && x.role === state.role);
    if (!r) {
      anchorTier = 'Gold';
      anchorDivision = 3;
      anchorPct = '';
      return;
    }
    anchorTier = r.tier;
    anchorDivision = r.division;
    anchorPct = String(Math.round(r.progressPct));
  };

  // A track is "in an open run" when the freshly fetched `placements` list
  // carries an uncompleted summary for it — mirrors log-match's
  // openRun/predictionFor exactly, except the account is always the match's OWN
  // account (d.account — this editor edits an existing match, there's no
  // account picker here). Not ctx.data.placements: see the fetch above.
  const openRun = (account: string, role: Role): PlacementRunSummary | undefined =>
    placements.find((p) => p.account === account && p.role === role && !p.completed);

  /**
   * Seed the predicted-rank tier/division for (d.account, role): the open
   * run's own latest prediction when it has one, else the (account, role)'s
   * currently recorded rank, else the hardcoded Gold/3 default — mirrors
   * log-match's predictionFor.
   */
  const predictionFor = (role: Role): { tier: string; division: number } => {
    const pred = openRun(d.account, role)?.latestPrediction;
    if (pred) return { tier: pred.tier, division: pred.division };
    const r = ranks.find((x) => x.account === d.account && x.role === role);
    return r ? { tier: r.tier, division: r.division } : { tier: 'Gold', division: 3 };
  };
  const initialPrediction = predictionFor(state.role);
  let predTier = initialPrediction.tier;
  let predDivision = initialPrediction.division;

  /** Re-seed predTier/predDivision via {@link predictionFor} for the current role. */
  const seedPrediction = (): void => {
    const p = predictionFor(state.role);
    predTier = p.tier;
    predDivision = p.division;
  };

  openModal((close) => {
    const rows = active.map((t) => targetGradeRow(t, grades[t.id], (g) => { grades[t.id] = g; }));

    // Multi-hero picker with the log card's shortlist + search: most-played for
    // this match's account and the selected role, the rest reachable via search.
    const heroEditHost = h('div');
    const paintEditorHeroes = (): void => {
      const limit = prefs.get('suggestedHeroCount') ?? DEFAULT_SUGGESTED_HEROES;
      const shortlist = mostPlayed[d.account]?.[state.role] ?? [];
      paintHeroChips(heroEditHost, heroes, state.role, ctx.data.masterData.heroes, { shortlist, shortlistLimit: limit, search: true });
    };
    paintEditorHeroes();

    // The same strict map combobox as the log card, with the same save guard:
    // the field can only commit a known map, and Save stays disabled while the
    // text resolves to none. The match's current map is always in the pool.
    const maps = editorMapPool(ctx, d.map);
    const resolveMap = (): string | null => resolveMapName(state.map, maps);
    const mapError = h('div', { class: 'hint hidden', style: { color: 'var(--loss-text, #d18a84)', marginTop: '4px' } });
    const updateSaveEnabled = (): void => {
      saveBtn.disabled = resolveMap() == null;
    };

    const resultRow = resultChooser({ value: state.result, keys: true, onChange: (v) => {
      state.result = v;
      // Re-suggest the SR change for the new result unless the player set it themselves.
      if (isComp && !srEdited) {
        srDelta = v !== 'Draw' ? Number(suggestedSrDelta(v)) : undefined;
        paintSr();
      }
    } });
    const mapField = field('Map',
      mapPicker({
        value: state.map,
        maps,
        recentMaps: ctx.data.matches.map((m) => m.map),
        onChange: (v) => { state.map = v; mapError.classList.add('hidden'); updateSaveEnabled(); },
        // L4: same hint as the log card, shown the moment the field can't
        // resolve rather than only after a failed Save.
        onInvalid: (typed) => {
          mapError.textContent = notKnownMapHint(typed);
          mapError.classList.remove('hidden');
        },
      }),
    );
    mapField.append(mapError);

    // Played time (L5) — a hand-logged match only; honest correction of a
    // backfill chip picked in a hurry (or too generously) on the log card.
    // A GEP capture's timestamp is the instant the game itself ended, so it
    // stays locked like every other auto-tracked fact does.
    const playedInput = h('input', {
      type: 'datetime-local',
      class: 'vt-input',
      max: toDatetimeLocal(Date.now()),
      value: toDatetimeLocal(playedAt),
    }) as HTMLInputElement;
    playedInput.addEventListener('change', () => {
      if (!playedInput.value) return;
      const ms = new Date(playedInput.value).getTime();
      if (Number.isNaN(ms)) return;
      playedAt = Math.min(ms, Date.now());
      paintTimeBadge();
    });
    const playedField = isManual
      ? field(optionalLabel('Played', '— when this match actually ended'), playedInput)
      : null;

    // The header badge (L5, shared layout with the log card via dialogHeader)
    // — reflects a live played-time edit immediately, the same way the log
    // card's own badge tracks its Played chip.
    const timeBadgeHost = h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    const paintTimeBadge = (): void => {
      const ts = isManual ? playedAt : d.timestamp;
      const when = isToday(ts) ? time(ts) : `${dateLong(ts)} · ${time(ts)}`;
      render(timeBadgeHost,
        badge(`${d.source === 'gep' ? '⚡ auto' : '◎ manual'} · ${when}`, d.source === 'gep' ? 'auto' : 'manual'),
        d.factsEditedAt != null ? editedPill() : null,
      );
    };
    paintTimeBadge();

    // Canonical field order shared with the log card: Result, Map, Role, Played, Heroes.
    // Every match is editable now — an auto-tracked result the feed got wrong can
    // be hand-corrected (the record keeps its ⚡ auto provenance + gains an
    // "edited" marker); nothing about the match is locked.
    const factsBlock = h('div', { class: 'stack', style: { gap: '12px' } },
      field('Result', resultRow),
      mapField,
      field('Role', segmented({
        // Role filters the hero grid and keys the Set-current rank seed —
        // repaint the heroes, and re-seed + repaint the picker if it's active.
        options: ROLE_OPTS, value: state.role, fill: true,
        onChange: (v) => {
          state.role = v;
          paintEditorHeroes();
          if (isComp) {
            if (srMode === 'set-current') seedAnchor();
            seedPrediction();
            paintSr();
          }
        },
      })),
      playedField,
      field(optionalLabel('Heroes', '— tap all you played'), heroEditHost),
      // No Mode control — Vantage is competitive-only (spec D1); matches stay
      // competitive, mirroring the quick-log's removed mode picker.
    );

    // SR block from the shared srControls, with the log card's labels. Change
    // mode → the raw signed SR % (wheel-nudged); Set-current mode → the
    // tier/division/% picker the app back-computes the SR % from on save.
    const srHost = h('div');
    const paintSr = (): void => {
      // A COUNTED placement match pre-empts the whole SR block: the game shows
      // no ±%, no rank protection, and there's nothing to toggle between
      // "change" and "set current" during placements — only a predicted rank.
      // Per MATCH (see core/placements/entryMode): editing placement match four
      // must still offer the picker after the run has reached ten, or its
      // prediction becomes uncorrectable.
      const run = openRun(d.account, state.role);
      const mode = srEntryMode(run, d.matchId);
      if (mode === 'placement' && run) {
        render(srHost,
          field(optionalLabel('Predicted rank', '— placements show no ±%'), placementPicker({
            tier: predTier,
            division: predDivision,
            onTier: (v) => (predTier = v),
            onDivision: (v) => (predDivision = v),
          })),
          h('div', { class: 'hint', style: { marginTop: '4px' } },
            `Placements (${run.counted}/${run.target}) for ${roleLabel(state.role)} on ${d.account} — the game shows a predicted rank after each match, no ±% and no rank protection.`));
        return;
      }
      // On the track but outside the counted ten. The ±% is editable here — and
      // this is the only place a match that lost its ±% to the old gate can have
      // it filled back in by hand.
      if (mode === 'delta-only') {
        render(srHost,
          field(optionalLabel('Skill rating', '— the ± the game showed'),
            srDeltaInput(srDelta != null ? String(srDelta) : '', (v) => {
              srDelta = v.trim() === '' ? undefined : Number(v);
            })),
          h('div', { class: 'hint', style: { marginTop: '4px' } },
            'Outside this track\'s ten placement matches — the game showed a ±% for it.'));
        return;
      }

      const toggleRow = field(
        optionalLabel('Skill rating', '— nudge the change or set your rank'),
        srModeToggle(srMode, (v) => {
          srMode = v;
          if (v === 'set-current') seedAnchor();
          paintSr();
        }),
      );
      if (srMode === 'set-current') {
        render(srHost, toggleRow,
          field(optionalLabel('Rank after this match', '— negative % means in rank protection'), rankEntry({
            account: d.account,
            role: state.role,
            timestamp: d.timestamp,
            tier: anchorTier,
            division: anchorDivision,
            pct: anchorPct,
            onTier: (v) => (anchorTier = v),
            onDivision: (v) => (anchorDivision = v),
            onPct: (v) => (anchorPct = v),
            onResolved: (p) => (rankPreview = p),
          })));
        return;
      }
      render(srHost, toggleRow,
        field(optionalLabel('Skill rating change (%)'),
          srDeltaInput(srDelta != null ? String(srDelta) : '', (v) => {
            srDelta = v.trim() === '' ? undefined : Number(v);
            srEdited = true;
          })));
    };
    if (isComp) paintSr();
    const srBlock = isComp ? srHost : null;

    const save = (): void => {
      // Same guard as the log card: only a resolved, known map may save.
      const resolved = resolveMap();
      if (!resolved) {
        mapError.textContent = notKnownMapHint(state.map);
        mapError.classList.remove('hidden');
        return;
      }
      state.map = resolved;
      // A COUNTED placement match pre-empts the whole rank payload: no setRank,
      // no srDelta (the game reports neither during placements) — the predicted
      // rank instead, sent separately below (mirrors log-match's persist()).
      const run = isComp ? openRun(d.account, state.role) : undefined;
      const mode = isComp ? srEntryMode(run, d.matchId) : 'full';
      const edited = bridge.editMatch({
        matchId: d.matchId,
        result: state.result, role: state.role, map: state.map, heroes: [...heroes],
        mental: flags,
        // Competitive rank is always a plain ±%. Set-current mode differs only in
        // how the number was arrived at: rankEntry already translated the picked
        // rank into it. An unanchored track is the one case with no delta to
        // send — that entry sets the anchor instead, handled after the save.
        //
        // 'delta-only' sends the key so the value is editable AND clearable:
        // omitting it left a surplus match's ±% frozen at whatever it had.
        ...(isComp && mode !== 'placement'
          ? (mode === 'full' && srMode === 'set-current'
              ? (rankPreview?.anchored ? { srDelta: rankPreview.srDelta } : {})
              : { srDelta: srDelta ?? null })
          : {}),
        // number sets, null clears — performance applies to any match, comp or not.
        performance: performance ?? null,
        grades,
        // Manual only (isManual gates the field's very existence); main also
        // re-gates it, so this can never move a GEP capture's locked instant.
        ...(isManual && playedAt !== d.timestamp ? { playedAt } : {}),
      });
      // A track with no anchor yet: the entered rank defines where tracking
      // starts, since there is no rank-before for it to be a change from.
      const anchoring = mode === 'full' && srMode === 'set-current' && rankPreview?.anchored === false;
      const saved = mode === 'placement'
        ? Promise.all([edited, bridge.setPlacementPrediction({
            account: d.account,
            role: state.role,
            matchId: d.matchId,
            prediction: { tier: predTier, division: predDivision },
          })]).then(([e]) => e)
        : anchoring
          ? Promise.all([edited, bridge.setRankAnchor({
              account: d.account,
              role: state.role,
              tier: anchorTier,
              division: anchorDivision,
              progressPct: Number(anchorPct) || 0,
            })]).then(([e]) => e)
          : edited;
      void saved.then(({ saved }) => {
        close();
        ctx.refresh();
        // A demo match (F3) is never actually persisted — say so instead of
        // claiming an update that didn't happen.
        if (!saved) {
          toast(`Not saved — "${state.map}" is a demo match. Log or track a real game to edit it for real.`);
          return;
        }
        gradedThisSession.add(d.matchId);
        toast(`Match updated — ${state.map}`);
        // Opened AFTER this modal's own close, never nested inside it. An edit
        // can pull a tenth match onto a track's counted set (e.g. correcting
        // the role/account onto one with an open run) — only worth asking when
        // this save actually touched such a track.
        if (run) {
          void maybeConfirmPlacementRank({ account: d.account, role: state.role, onDone: () => ctx.refresh() });
        }
      });
    };
    const clear = (): void => {
      void bridge.clearReview(d.matchId).then(() => {
        gradedThisSession.delete(d.matchId);
        close();
        ctx.refresh();
        toast(`Tracking cleared — ${d.map}`);
      });
    };

    const saveBtn = button('Save', { variant: 'primary', onClick: save });
    updateSaveEnabled();

    // L2: its own sticky footer (bottom: 0 within the scrolling .modal-card),
    // same treatment as the log card's Save row — root carries no padding of
    // its own now (L5, dialogHeader), so this sits flush without a negative-
    // margin hack to cancel it.
    const actions = h('div', {
      style: {
        display: 'flex', gap: '10px', alignItems: 'center', padding: '14px 18px',
        borderTop: '1px solid var(--border)', position: 'sticky', bottom: '0', background: 'var(--card)',
      },
    },
      saveBtn,
      button('Cancel', { variant: 'ghost', onClick: close }),
      h('span', { style: { flex: '1' } }),
      d.review ? button('Clear grades', { variant: 'ghost', onClick: clear }) : null,
    );

    // tabindex -1: focusable via script (for the mount-time focus below) but not
    // part of the natural Tab order — mirrors the log card's keyboard handling.
    // Field order and label convention are the log card's (its Account/Played
    // fields are log-only): Result, Map, Role, Played, Heroes, Skill rating,
    // Performance, Comms, Flags, Targets.
    //
    // Header and footer sit OUTSIDE the padded content (L5, matching the log
    // card's own form structure) rather than the old single stack-with-padding
    // root a negative-margin hack had to cancel just for the footer.
    const root = h('div', { tabindex: '-1', style: { outline: 'none' } },
      dialogHeader({
        title: 'Edit match',
        extra: [h('span', { class: 'u-muted', style: { fontSize: '12px' } }, `${d.map} · ${roleLabel(d.role)}`)],
        badge: timeBadgeHost,
        onClose: close,
      }),
      h('div', { style: { padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' } },
        // Two columns mirroring the log card: match facts + Skill rating on the
        // left, the manual self-report (Performance / Comms / Flags / Targets) on
        // the right. Collapses to one column on a narrow viewport (shared .log-grid).
        h('div', { class: 'log-grid' },
          h('div', { class: 'log-col' },
            factsBlock,
            srBlock,
          ),
          h('div', { class: 'log-col' },
            field(optionalLabel('Performance', '— how did you play?'),
              performanceSlider(performance, (v) => (performance = v))),
            field(optionalLabel('Comms', '— how team comms felt'), commsToneSwitch(flags)),
            field(optionalLabel('Flags', "— manual, the game doesn't report these"), mentalFlagChips(flags)),
            field(optionalLabel('Targets', '— grade now or later on Review'),
              h('div', { class: 'stack', style: { gap: '11px' } },
                ...(rows.length
                  ? rows.map((r) => r.el)
                  : [h('div', { class: 'hint' }, 'No active targets — add some on the Targets page.')]),
              )),
          ),
        ),
      ),
      actions,
    );

    // W/L/D drive the result chooser (every match is editable now) — the same
    // shared binding as the log card. Enter/Ctrl+Enter save (L5, bindSaveKeys
    // — no "save & next" here, so Ctrl+Enter falls back to plain save), and
    // ↑/↓ + H/P/M grade the focused target row (L5, bindTargetGradeKeys —
    // Review's own keyboard grading model). openModal appends the panel after
    // build returns, so defer the focus to the next frame once it's actually
    // in the DOM.
    bindResultKeys(root, resultRow);
    bindSaveKeys(root, { save });
    bindTargetGradeKeys(root, rows);
    requestAnimationFrame(() => root.focus());
    return root;
  }, { panelClass: 'modal-card--wide' });
}

// --- player history -------------------------------------------------------------

function playerHistorySection(d: MatchDetail, ctx: ViewContext): HTMLElement {
  const hasRoster = Boolean(d.scoreboard?.some((e) => !e.isLocal));
  if (!d.playerHistory.length) {
    return card({ title: 'Player history', sub: PLAYER_HISTORY_SUB },
      h('div', { class: 'hint' },
        hasRoster
          ? 'No players from this match in your tracked history yet.'
          : 'No roster was recorded for this match.',
      ),
    );
  }
  // Counts are PRIOR games — this match is excluded, so they read one lower than
  // the drill-down's own total. Both surfaces say which they show.
  const anyUnknown = d.playerHistory.some((p) => p.relationKnown < p.encounters);
  // Sorted your team first, then enemy, then side-unknown (S7) — a stable
  // sort, so within each group the core's own encounters-desc/recency order survives.
  const sideRank = (w: boolean | undefined): number => (w === true ? 0 : w === false ? 1 : 2);
  const sorted = [...d.playerHistory].sort((a, b) => sideRank(a.withYou) - sideRank(b.withYou));
  return card({ title: 'Player history', sub: PLAYER_HISTORY_SUB },
    h('table', { class: 'mini' },
      h('thead', null,
        h('tr', null,
          h('th', null),
          h('th', null, 'Player'),
          h('th', null, 'They play'),
          h('th', null, 'Prior'),
          h('th', null, RELATION_LABEL.with.long),
          h('th', null, RELATION_LABEL.against.long),
          h('th', null, 'Last'),
        ),
      ),
      h('tbody', null, ...sorted.map((p) => encounterRow(p, ctx))),
    ),
    anyUnknown
      ? h('div', { class: 'hint', style: { marginTop: '8px' } },
          'With / against is only known when the game feed reported both teams, so those two '
          + 'columns need not add up to the games column.')
      : null,
  );
}

const PLAYER_HISTORY_SUB =
  'games you played with these people BEFORE this one — click a name for every game you have shared';

/**
 * A split cell. `—` rather than `0W 0L` when no prior game had a known team
 * relation: zeroes would assert "never on their team", which is a different
 * claim from "the feed never said" (guardrail 1).
 */
function splitCell(wl: { wins: number; losses: number }, known: number): HTMLElement {
  if (!known) {
    const cell = h('td', { class: 'u-dim' }, '—');
    cell.title = 'The game feed never reported both teams for these games.';
    return cell;
  }
  return h('td', { class: 'mono' }, `${wl.wins}W ${wl.losses}L`);
}

/** "usually Widowmaker (4 of 6)" — the most actionable pre-match fact stored history can offer, now counted instead of thrown away (S7). */
function theirsCell(p: PlayerEncounter): HTMLElement {
  if (!p.topHero) return h('td', { class: 'u-dim' }, '—');
  return h('td', {
    class: 'u-dim',
    title: p.lastHero && p.lastHero !== p.topHero.hero ? `Last played: ${p.lastHero}` : undefined,
  }, `${p.topHero.hero} (${p.topHero.games} of ${p.encounters})`);
}

function encounterRow(p: PlayerEncounter, ctx: ViewContext): HTMLElement {
  const open = (): void => ctx.navigate('playerHistory', { playerName: p.name });
  return h('tr', {
    style: { cursor: 'pointer' },
    // The whole row opens their history now (S7), same click-through every
    // other list in the app gives a name — the name link stays for keyboard
    // users and stops its own click bubbling into the row's handler.
    ...clickableRow(open),
  },
    h('td', { style: { textAlign: 'center' } },
      h('span', {
        class: 'pill',
        title: p.withYou === undefined ? 'Team not reported this match' : p.withYou ? 'On your team now' : 'On the enemy team now',
      }, p.withYou === undefined ? '—' : p.withYou ? RELATION_LABEL.with.short : RELATION_LABEL.against.short),
    ),
    h('td', null,
      inlineLink(p.name, {
        strong: true,
        title: `See every game you have shared with ${p.name}`,
        onClick: (e) => { e.stopPropagation(); open(); },
      }),
    ),
    theirsCell(p),
    h('td', { class: 'mono' }, String(p.encounters)),
    splitCell(p.sameTeam, p.relationKnown),
    splitCell(p.enemyTeam, p.relationKnown),
    h('td', { class: 'u-dim mono' }, relTime(p.lastSeen)),
  );
}
