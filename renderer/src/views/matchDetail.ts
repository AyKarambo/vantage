/**
 * Match detail — the parameterized drill-down behind a Matches row click.
 * Every section renders only when its data exists, so the page degrades
 * tier-by-tier: a minimal legacy record still gets a full header, richer
 * records add scoreboard, tabs, progress, and player history.
 * No share/publish affordance anywhere (spec: Share URL is out of scope).
 */
import { applyStyle, h, render } from '../dom';
import type { HeroStat, MatchDetail, MatchMental, PlayerEncounter, RankSummary, Role, TargetGrade, TargetSummary } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { fmt, relTime, roleLabel, signed } from '../format';
import { rankParts } from '../../../src/core/rankDisplay';
import { button, card, pill, RESULT_STATE, segmented, statBar, statBox } from '../components/primitives';
import { openModal } from '../components/overlay';
import { GRADES, targetGradeRow, mentalFlagChips, commsToneSwitch } from '../components/reviewControls';
import { resultChooser, bindResultKeys } from '../components/resultChooser';
import { performanceSlider } from '../components/performanceSlider';
import { paintHeroChips } from '../components/heroPicker';
import { mapPicker, resolveMapName, type MapPickerEntry } from '../components/mapPicker';
import { field, optionalLabel } from '../components/formField';
import { srModeToggle, srDeltaInput, rankPicker, suggestedSrDelta, type SrMode } from '../components/srControls';
import { prefs, DEFAULT_SUGGESTED_HEROES } from '../prefs';
import { toast } from '../components/toast';
import { scoreboard } from '../components/scoreboard';
import { gradedThisSession } from '../reviews';
import { leaverFlags } from '../../../src/core/leaver';
import { commsTone } from '../../../src/core/comms';
import { classifyGameType } from '../../../src/core/matchFilter';
import { heroLines, combinedHeroLine } from '../../../src/core/perHero';
import { PALETTE, wrHsl } from '../theme';
import type { ViewContext } from './view';

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
      render(host, backRow(ctx), card({}, h('div', { class: 'empty' }, 'This match is no longer in your history.')));
      return;
    }
    render(host, backRow(ctx), ...sections(d, ctx));
  });
  return host;
}

/** Back link + prev/next steppers through the filtered match list (also ←/→). */
function backRow(ctx: ViewContext): HTMLElement {
  const matches = ctx.data.matches;
  const idx = matches.findIndex((m) => m.matchId === ctx.params.matchId);
  const older = idx >= 0 ? matches[idx + 1] : undefined;
  const newer = idx >= 0 ? matches[idx - 1] : undefined;
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
    button('← Matches', { variant: 'ghost', onClick: () => ctx.navigate('matches') }),
    h('span', { style: { flex: '1' } }),
    button('‹ Older', {
      variant: 'ghost', disabled: !older, title: 'Previous match (←)',
      onClick: () => older && ctx.navigate('matchDetail', { matchId: older.matchId }),
    }),
    idx >= 0 ? h('span', { class: 'mono u-dim', style: { fontSize: '11px' } }, `${idx + 1} / ${matches.length}`) : null,
    button('Newer ›', {
      variant: 'ghost', disabled: !newer, title: 'Next match (→)',
      onClick: () => newer && ctx.navigate('matchDetail', { matchId: newer.matchId }),
    }),
  );
}

function sections(d: MatchDetail, ctx: ViewContext): Node[] {
  return [
    header(d, ctx),
    scoreboardSection(d),
    perHeroSection(d.perHero, d.durationMinutes),
    competitiveSection(d.competitive, d.srDelta),
    gradesSection(d, ctx),
    playerHistorySection(d),
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
    h('span', null, `${roleLabel(d.role)} · ${d.account}`),
    h('span', null, '·'),
    h('span', null, relTime(d.timestamp)),
  );
  return card({ class: 'detail-head' },
    h('div', { class: 'detail-head-main' },
      h('div', { class: `detail-result is-${state}` }, RESULT_TEXT[d.result] ?? d.result),
      h('h1', { class: 'detail-map' }, d.map),
      meta,
      h('div', { style: { marginTop: '10px' } },
        button('✎ Edit match', {
          variant: 'soft',
          title: d.source === 'gep'
            ? 'Edit the manual layer (flags, SR %, target grades) — game facts stay locked'
            : 'Edit this match — result, map, flags, SR %, and target grades',
          onClick: () => openMatchEditor(ctx, d),
        }),
      ),
    ),
    h('div', { class: 'detail-head-side' },
      d.finalScore ? statBox(h('span', { class: 'mono' }, d.finalScore), 'Round score') : null,
      d.durationMinutes != null ? statBox(`${d.durationMinutes}m`, 'Duration') : null,
      d.heroes.length
        ? h('div', { class: 'detail-heroes' },
            h('div', { class: 'stat-box-label' }, 'Heroes played'),
            h('div', { class: 'detail-hero-pills' }, ...d.heroes.map((name) => pill(name))),
          )
        : null,
    ),
  );
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

function scoreboardSection(d: MatchDetail): HTMLElement | null {
  if (!d.scoreboard?.length) return null;
  const localOnly = d.scoreboard.every((e) => e.isLocal);
  return card(
    {
      title: 'Scoreboard',
      sub: localOnly ? 'only your own line was recorded for this match' : 'as reported by the game feed',
      class: 'card--flush detail-scoreboard',
    },
    scoreboard(d.scoreboard),
  );
}

// --- per-hero tabs ------------------------------------------------------------

function perHeroSection(perHero: HeroStat[], durationMinutes: number | undefined): HTMLElement | null {
  if (!perHero.length) return null;
  // Counting stats are per-10-minutes on that hero (real swap-timed minutes when
  // available, else an equal split of the match); KDA stays a raw ratio. A match
  // with no usable duration dashes the per-10 stats but still shows KDA.
  const lines = heroLines(perHero, durationMinutes);
  // With more than one hero, lead with an "All" tab combining every hero's stats
  // (per-10 over the whole match); a single-hero match already IS its own total.
  const all = combinedHeroLine(perHero, durationMinutes);
  const tabLines = all && lines.length > 1 ? [all, ...lines] : lines;
  const body = h('div', { class: 'stat-grid stat-grid--wide' });
  const draw = (hero: string): void => {
    const s = tabLines.find((x) => x.hero === hero) ?? tabLines[0];
    const p = s.per10;
    render(body,
      statBox(per10Fixed(p?.eliminations), 'Elims/10'),
      statBox(per10Fixed(p?.assists), 'Assists/10'),
      statBox(per10Fixed(p?.deaths), 'Deaths/10'),
      statBox(s.kda.toFixed(1), 'KDA'),
      statBox(fmt(p?.damage), 'DMG/10'),
      statBox(fmt(p?.healing), 'HEAL/10'),
      statBox(fmt(p?.mitigation), 'MIT/10'),
    );
  };
  draw(tabLines[0].hero);
  const tabs = tabLines.length > 1
    ? segmented({
        options: tabLines.map((s) => ({ value: s.hero, label: s.hero })),
        value: tabLines[0].hero,
        onChange: draw,
      })
    : null;
  return card({ title: 'Per hero', sub: 'per 10 minutes on hero · KDA is a ratio', actions: tabs }, body);
}

/** Per-10 for the E/D/A stats: one decimal, or a dash when minutes are unknown. */
function per10Fixed(v: number | undefined): string {
  return v == null ? '–' : v.toFixed(1);
}

// --- competitive progress (calculated from your rank anchor + logged SR) ------

const NOTE_LABEL: Record<string, string> = {
  calculated: 'Calculated', reconstructed: 'Reconstructed', estimate: 'Estimate', reported: 'Reported',
};
const NOTE_SUB: Record<string, string> = {
  calculated: 'from your rank anchor + logged SR — the game feed does not report rank',
  reconstructed: 'reconstructed backward from your rank anchor — best-effort, may drift on missing SR',
  estimate: 'estimated from recent results — set a rank anchor to track the real number',
  reported: 'reported by the game feed',
};

function competitiveSection(c: MatchDetail['competitive'], srDelta?: number): HTMLElement | null {
  if (!c) return null;
  const withinDivision = c.progressPct != null ? c.progressPct / 100 : null;
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
      sub: NOTE_SUB[c.note],
      actions: pill(NOTE_LABEL[c.note] ?? c.note, 'accent'),
    },
    h('div', { class: 'detail-progress' },
      parts
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { class: 'detail-rank' }, parts.rankLabel),
            parts.shield ? pill('🛡 Rank protected', 'draw') : null,
          )
        : null,
      parts?.shield
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
        : c.delta != null
          ? h('span', {
              class: 'mono',
              style: { fontSize: '12px', color: c.delta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' },
            }, `${signed(Math.round(c.delta))}% over the range`)
          : null,
    ),
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
      const grade = selfGrades[t.id];
      return grade ? [gradeRow(t, grade)] : [];
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
 * Modal to edit a match's full manual layer: for hand-logged matches the game
 * facts (result/role/map/hero/mode) are editable; for auto-tracked matches those
 * stay locked and only the manual layer (SR %, mental flags incl. leaver-team,
 * target grades) can change. Saves go through `editMatch`; `ctx.refresh()`
 * re-pulls the detail so every dependent view reflects the change.
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
  void Promise.all([bridge.getRanks(), bridge.mostPlayedHeroes()]).then(
    ([ranks, mostPlayed]) => {
      editorOpening = false;
      buildMatchEditor(ctx, d, ranks, mostPlayed);
    },
    (err) => {
      editorOpening = false;
      throw err;
    },
  );
}

function buildMatchEditor(
  ctx: ViewContext,
  d: MatchDetail,
  ranks: RankSummary[],
  mostPlayed: Record<string, Partial<Record<Role, string[]>>>,
): void {
  const active = ctx.data.targets.filter((t) => t.isActive && !t.archivedAt);
  const grades: Record<string, TargetGrade> = { ...(d.review?.grades ?? {}) };
  const flags: MatchMental = normalizeFlags({ ...(d.mental ?? {}), ...(d.review?.flags ?? {}) });
  const editable = d.source === 'manual';
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
  // SR entry mirrors the log card: nudge the change, or set the rank you ended
  // at (main back-computes the %). The Set-current fields seed from the rank shown
  // on the card (reconstructed as of this match), so a drift-correction starts
  // from where you actually are.
  let srMode: SrMode = 'change';
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

  openModal((close) => {
    const rows = active.map((t) => targetGradeRow(t, grades[t.id], (g) => { grades[t.id] = g; }));

    // Multi-hero picker with the log card's shortlist + search: most-played for
    // this match's account and the selected role, the rest reachable via search.
    const heroEditHost = h('div');
    const paintEditorHeroes = (): void => {
      const limit = prefs.get('suggestedHeroCount') ?? DEFAULT_SUGGESTED_HEROES;
      const shortlist = (mostPlayed[d.account]?.[state.role] ?? []).slice(0, limit);
      paintHeroChips(heroEditHost, heroes, state.role, ctx.data.masterData.heroes, { shortlist, search: true });
    };
    paintEditorHeroes();

    // The same strict map combobox as the log card, with the same save guard:
    // the field can only commit a known map, and Save stays disabled while the
    // text resolves to none. The match's current map is always in the pool.
    const maps = editorMapPool(ctx, d.map);
    const resolveMap = (): string | null => resolveMapName(state.map, maps);
    const mapError = h('div', { class: 'hint hidden', style: { color: 'var(--loss-text, #d18a84)', marginTop: '4px' } });
    const updateSaveEnabled = (): void => {
      saveBtn.disabled = editable && resolveMap() == null;
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
      }),
    );
    mapField.append(mapError);

    // Canonical field order shared with the log card: Result, Map, Role, Heroes.
    const factsBlock = editable
      ? h('div', { class: 'stack', style: { gap: '12px' } },
          field('Result', resultRow),
          mapField,
          field('Role', segmented({
            // Role filters the hero grid and keys the Set-current rank seed —
            // repaint the heroes, and re-seed + repaint the picker if it's active.
            options: ROLE_OPTS, value: state.role, fill: true,
            onChange: (v) => {
              state.role = v;
              paintEditorHeroes();
              if (isComp && srMode === 'set-current') {
                seedAnchor();
                paintSr();
              }
            },
          })),
          field(optionalLabel('Heroes', '— tap all you played'), heroEditHost),
          // No Mode control — Vantage is competitive-only (spec D1); matches stay
          // competitive, mirroring the quick-log's removed mode picker.
        )
      : h('div', { class: 'hint' },
          `Auto-tracked from the game feed — result, map and heroes are locked. ${d.map} · ${roleLabel(d.role)}`);

    // SR block from the shared srControls, with the log card's labels. Change
    // mode → the raw signed SR % (wheel-nudged); Set-current mode → the
    // tier/division/% picker the app back-computes the SR % from on save.
    const srHost = h('div');
    const paintSr = (): void => {
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
          field(optionalLabel('Current rank', '— negative % means in rank protection'), rankPicker({
            tier: anchorTier,
            division: anchorDivision,
            pct: anchorPct,
            onTier: (v) => (anchorTier = v),
            onDivision: (v) => (anchorDivision = v),
            onPct: (v) => (anchorPct = v),
          })),
          h('div', { class: 'hint', style: { marginTop: '4px' } },
            'The rank you were at after this match — we back-calculate its SR %. Your live rank tracking is left as-is.'));
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
      if (editable) {
        // Same guard as the log card: only a resolved, known map may save.
        const resolved = resolveMap();
        if (!resolved) {
          mapError.textContent = state.map.trim()
            ? `"${state.map.trim()}" isn't a known map — pick one from the list.`
            : 'Pick the map — start typing and choose from the list.';
          mapError.classList.remove('hidden');
          return;
        }
        state.map = resolved;
      }
      void bridge.editMatch({
        matchId: d.matchId,
        ...(editable ? { result: state.result, role: state.role, map: state.map, heroes: [...heroes] } : {}),
        mental: flags,
        // Competitive rank: Set-current sends the resulting rank (main derives the
        // srDelta); Change sends the raw % (number sets, null clears). Omitted for
        // non-comp.
        ...(isComp
          ? (srMode === 'set-current'
              ? { setRank: { tier: anchorTier, division: anchorDivision, progressPct: Number(anchorPct) || 0 } }
              : { srDelta: srDelta ?? null })
          : {}),
        // number sets, null clears — performance applies to any match, comp or not.
        performance: performance ?? null,
        grades,
      }).then(() => {
        gradedThisSession.add(d.matchId);
        close();
        ctx.refresh();
        toast(`Match updated — ${state.map}`);
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

    // tabindex -1: focusable via script (for the mount-time focus below) but not
    // part of the natural Tab order — mirrors the log card's keyboard handling.
    // Field order and label convention are the log card's (its Account/Played
    // fields are log-only): Result, Map, Role, Heroes, Skill rating,
    // Performance, Comms, Flags, Targets.
    const root = h('div', { class: 'stack', tabindex: '-1', style: { gap: '14px', padding: '18px', outline: 'none' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Edit match'),
      h('div', { class: 'u-muted', style: { fontSize: '12px' } },
        `${d.map} · ${roleLabel(d.role)} · ${relTime(d.timestamp)} · ${d.source === 'gep' ? '⚡ auto' : '◎ manual'}`),
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
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px' } },
        saveBtn,
        button('Cancel', { variant: 'ghost', onClick: close }),
        h('span', { style: { flex: '1' } }),
        d.review ? button('Clear grades', { variant: 'ghost', onClick: clear }) : null,
      ),
    );

    // W/L/D drive the result chooser for editable matches — the same shared
    // binding as the log card. openModal appends the panel after build returns,
    // so defer the focus to the next frame once it's actually in the DOM.
    if (editable) bindResultKeys(root, resultRow);
    requestAnimationFrame(() => root.focus());
    return root;
  }, { panelClass: 'modal-card--wide' });
}

// --- player history -------------------------------------------------------------

function playerHistorySection(d: MatchDetail): HTMLElement {
  const hasRoster = Boolean(d.scoreboard?.some((e) => !e.isLocal));
  const body = d.playerHistory.length
    ? d.playerHistory.map(encounterRow)
    : [h('div', { class: 'hint' },
        hasRoster
          ? 'No players from this match in your tracked history yet.'
          : 'No roster was recorded for this match.',
      )];
  return card({ title: 'Player history', sub: 'players from this match you have met before' }, ...body);
}

function encounterRow(p: PlayerEncounter): HTMLElement {
  const wl = p.results ? ` · ${p.results.wins}W ${p.results.losses}L together` : '';
  return h('div', { class: 'row' },
    h('span', { class: 'row-main', style: { fontSize: '12.5px', fontWeight: '500' } }, p.name),
    h('span', { class: 'u-muted', style: { fontSize: '11.5px' } },
      `${p.encounters} prior ${p.encounters === 1 ? 'match' : 'matches'}${wl}`),
    h('span', { class: 'u-dim mono', style: { fontSize: '11px', minWidth: '46px', textAlign: 'right' } },
      relTime(p.lastSeen)),
  );
}
