/**
 * Match detail — the parameterized drill-down behind a Matches row click.
 * Every section renders only when its data exists, so the page degrades
 * tier-by-tier: a minimal legacy record still gets a full header, richer
 * records add scoreboard, tabs, progress, player history, and screenshots.
 * No share/publish affordance anywhere (spec: Share URL is out of scope).
 */
import { h, render } from '../dom';
import type { HeroStat, MatchDetail, MatchMental, PlayerEncounter, RankSummary, Role, TargetGrade } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { fmt, relTime, roleLabel, rankLabel, signed } from '../format';
import { button, card, pill, RESULT_STATE, segmented, select, statBar, statBox } from '../components/primitives';
import { openModal } from '../components/overlay';
import { targetGradeRow, mentalFlagsRow } from '../components/reviewControls';
import { resultChooser, bindResultKeys } from '../components/resultChooser';
import { performanceSlider } from '../components/performanceSlider';
import { paintHeroChips } from '../components/heroPicker';
import { mapPicker, resolveMapName, type MapPickerEntry } from '../components/mapPicker';
import { attachWheelNudge } from '../components/wheelStepper';
import { prefs, DEFAULT_SUGGESTED_HEROES } from '../prefs';
import { TIERS } from '../../../src/core/rank';
import { toast } from '../components/toast';
import { scoreboard } from '../components/scoreboard';
import { gradedThisSession } from '../reviews';
import { leaverFlags } from '../../../src/core/leaver';
import { commsTone } from '../../../src/core/comms';
import { classifyGameType } from '../../../src/core/matchFilter';
import { PALETTE } from '../theme';
import type { ViewContext } from './view';

const ROLE_OPTS: Array<{ value: Role; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' }, { value: 'openQ', label: 'Open Q' },
];
/** Divisions high→low for the Set-current rank picker (5 = lowest band, 1 = highest). */
const DIVISIONS = [5, 4, 3, 2, 1];
/** The editor's SR-entry mode: nudge the change (±%) or set the resulting rank (back-computed). */
type SrMode = 'change' | 'set-current';

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
    perHeroSection(d.perHero),
    competitiveSection(d.competitive, d.srDelta),
    playerHistorySection(d),
    screenshotsSection(d.screenshots),
  ].filter((n): n is HTMLElement => n != null);
}

// --- header (always renders — derives from fields every record has) ----------

function header(d: MatchDetail, ctx: ViewContext): HTMLElement {
  const state = RESULT_STATE[d.result];
  const meta = h('div', { class: 'detail-meta' },
    pill(d.mapType, 'accent'),
    h('span', null, d.gameType),
    h('span', null, '·'),
    h('span', null, `${roleLabel(d.role)} · ${d.account}`),
    h('span', null, '·'),
    h('span', null, relTime(d.timestamp)),
  );
  const flags = mentalFlags(d);
  return card({ class: 'detail-head' },
    h('div', { class: 'detail-head-main' },
      h('div', { class: `detail-result is-${state}` }, RESULT_TEXT[d.result] ?? d.result),
      h('h1', { class: 'detail-map' }, d.map),
      meta,
      flags,
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

function mentalFlags(d: MatchDetail): HTMLElement | null {
  const m = d.mental;
  if (!m) return null;
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

function perHeroSection(perHero: HeroStat[]): HTMLElement | null {
  if (!perHero.length) return null;
  const body = h('div', { class: 'stat-grid stat-grid--wide' });
  const draw = (hero: string): void => {
    const s = perHero.find((x) => x.hero === hero) ?? perHero[0];
    const kda = (s.eliminations + s.assists) / Math.max(s.deaths, 1);
    render(body,
      statBox(String(s.eliminations), 'Eliminations'),
      statBox(String(s.assists), 'Assists'),
      statBox(String(s.deaths), 'Deaths'),
      statBox(kda.toFixed(1), 'KDA'),
      statBox(fmt(s.damage), 'Damage'),
      statBox(fmt(s.healing), 'Healing'),
      statBox(fmt(s.mitigation), 'Mitigation'),
    );
  };
  draw(perHero[0].hero);
  const tabs = perHero.length > 1
    ? segmented({
        options: perHero.map((s) => ({ value: s.hero, label: s.hero })),
        value: perHero[0].hero,
        onChange: draw,
      })
    : null;
  return card({ title: 'Per hero', sub: 'your line on each hero this match', actions: tabs }, body);
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
  return card(
    {
      title: 'Competitive progress',
      sub: NOTE_SUB[c.note],
      actions: pill(NOTE_LABEL[c.note] ?? c.note, 'accent'),
    },
    h('div', { class: 'detail-progress' },
      c.tier != null && c.division != null
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { class: 'detail-rank' }, rankLabel(c.tier, c.division)),
            c.protected ? pill('🛡 Rank protected', 'draw') : null,
          )
        : null,
      c.needsReanchor
        ? h('div', { class: 'hint', style: { color: 'var(--loss-text)' } },
            'Demoted after a protected loss — set your new rank on the Settings › Accounts panel to resume tracking.')
        : c.protected
          // Protected = a negative carry; a clamped division bar labelled "-19%"
          // reads as broken, so show the buffer state as a hint instead.
          ? h('div', { class: 'hint' },
              `Holding the division — ${Math.round(c.progressPct ?? 0)}% into the rank-protection buffer.`)
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

// --- edit tracking (re-open the manual read for any match, graded or not) -----

/** Local section wrapper reusing the Review screen's label styling. */
function editorSection(label: string, body: Node): HTMLElement {
  return h('div', { class: 'review-section' },
    h('div', { class: 'review-section-label' }, label),
    body,
  );
}

/**
 * Fold a legacy `leaver` boolean into the my-team flag so its chip pre-selects.
 * The comms tone is left untouched — the three-state comms switch in
 * `mentalFlagsRow` (see reviewControls) reads/writes it through `commsTone`, so
 * banter/abusive survive an unrelated edit.
 */
function normalizeFlags(m: MatchMental): MatchMental {
  const out: MatchMental = { ...m };
  if (out.leaver && !out.leaverMyTeam) out.leaverMyTeam = true;
  delete out.leaver;
  return out;
}

/** A labelled editor field (label above the control). */
function editField(label: string, control: Node): HTMLElement {
  return h('div', null, h('div', { class: 'field-label' }, label), control);
}

/**
 * Modal to edit a match's full manual layer: for hand-logged matches the game
 * facts (result/role/map/hero/mode) are editable; for auto-tracked matches those
 * stay locked and only the manual layer (SR %, mental flags incl. leaver-team,
 * target grades) can change. Saves go through `editMatch`; `ctx.refresh()`
 * re-pulls the detail so every dependent view reflects the change.
 */
function openMatchEditor(ctx: ViewContext, d: MatchDetail): void {
  // Preload mirrors the log card: current ranks feed the Set-current re-seed
  // on a role switch; per-account most-played heroes feed the picker shortlist.
  void Promise.all([bridge.getRanks(), bridge.mostPlayedHeroes()]).then(([ranks, mostPlayed]) => {
    buildMatchEditor(ctx, d, ranks, mostPlayed);
  });
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
  let srDelta: number | undefined = d.srDelta;
  let performance: number | undefined = d.performance;
  // SR entry mirrors the log card: nudge the change, or set the rank you ended
  // at (main back-computes the %). The Set-current fields seed from the rank shown
  // on the card (reconstructed as of this match), so a drift-correction starts
  // from where you actually are.
  let srMode: SrMode = 'change';
  let anchorTier = d.competitive?.tier ?? 'Gold';
  let anchorDivision = d.competitive?.division ?? 3;
  let anchorPct = d.competitive?.progressPct != null ? String(Math.round(d.competitive.progressPct)) : '';

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

    const resultRow = resultChooser({ value: state.result, keys: true, onChange: (v) => (state.result = v) });
    const mapField = editField('Map',
      mapPicker({
        value: state.map,
        maps,
        recentMaps: ctx.data.matches.map((m) => m.map),
        onChange: (v) => { state.map = v; mapError.classList.add('hidden'); updateSaveEnabled(); },
      }),
    );
    mapField.append(mapError);

    const factsBlock = editable
      ? h('div', { class: 'stack', style: { gap: '12px' } },
          editField('Result', resultRow),
          editField('Role', segmented({
            // Role filters the hero grid — repaint it when the role changes.
            options: ROLE_OPTS, value: state.role, fill: true, onChange: (v) => { state.role = v; paintEditorHeroes(); },
          })),
          mapField,
          editField('Heroes', heroEditHost),
          // No Mode control — Vantage is competitive-only (spec D1); matches stay
          // competitive, mirroring the quick-log's removed mode picker.
        )
      : h('div', { class: 'hint' },
          `Auto-tracked from the game feed — result, map and heroes are locked. ${d.map} · ${roleLabel(d.role)}`);

    // Change mode → the raw signed SR % (with wheel nudge). Set-current mode →
    // the tier/division/% picker (prefilled, wheel-nudged) the app back-computes
    // the SR % from on save.
    const srDeltaField = (): HTMLInputElement => {
      const el = srInput(srDelta, (v) => (srDelta = v));
      attachWheelNudge(el, () => (srDelta != null ? String(srDelta) : ''), (v) => { srDelta = v === '' ? undefined : Number(v); });
      return el;
    };
    const rankPicker = (): HTMLElement => {
      const pct = h('input', {
        class: 'vt-input mono', type: 'number', step: '1', value: anchorPct, placeholder: 'e.g. 40',
        on: { input: (e) => (anchorPct = (e.target as HTMLInputElement).value) },
      }) as HTMLInputElement;
      attachWheelNudge(pct, () => anchorPct, (v) => (anchorPct = v));
      return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        select(TIERS.map((t) => ({ value: t, label: t })), anchorTier, (v) => (anchorTier = v)),
        select(DIVISIONS.map((dv) => ({ value: String(dv), label: `Div ${dv}` })), String(anchorDivision), (v) => (anchorDivision = Number(v))),
        pct,
      );
    };
    const srHost = h('div');
    const paintSr = (): void => {
      const toggle = segmented<SrMode>({
        options: [{ value: 'change', label: 'Change (±%)' }, { value: 'set-current', label: 'Set current rank' }],
        value: srMode,
        fill: true,
        onChange: (v) => { srMode = v; paintSr(); },
      });
      if (srMode === 'set-current') {
        render(srHost,
          editField('Skill rating', toggle),
          editField('Current rank — negative % means rank protection', rankPicker()),
          h('div', { class: 'hint', style: { marginTop: '4px' } },
            'The rank you were at after this match — we back-calculate its SR %. Your live rank tracking is left as-is.'));
      } else {
        render(srHost,
          editField('Skill rating', toggle),
          editField('Skill rating change (%)', srDeltaField()));
      }
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
    const root = h('div', { class: 'stack', tabindex: '-1', style: { gap: '14px', padding: '18px', width: '460px', maxWidth: '92vw', outline: 'none' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Edit match'),
      h('div', { class: 'u-muted', style: { fontSize: '12px' } },
        `${d.map} · ${roleLabel(d.role)} · ${relTime(d.timestamp)} · ${d.source === 'gep' ? '⚡ auto' : '◎ manual'}`),
      editorSection('Match', factsBlock),
      srBlock ? editorSection('◎ Rank', srBlock) : null,
      editorSection('◎ Target grades', h('div', { class: 'stack', style: { gap: '11px' } },
        ...(rows.length
          ? rows.map((r) => r.el)
          : [h('div', { class: 'hint' }, 'No active targets — add some on the Targets page.')]),
      )),
      editorSection('◎ How it felt', mentalFlagsRow(flags)),
      editorSection('◎ How you played', performanceSlider(performance, (v) => (performance = v))),
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
  });
}

/** A signed number input for the per-match skill-rating %; blank → undefined. */
function srInput(value: number | undefined, onChange: (v: number | undefined) => void): HTMLInputElement {
  const el = h('input', {
    class: 'vt-input mono', type: 'number', step: '1', placeholder: 'e.g. +22 or -19',
    value: value != null ? String(value) : '',
    on: { input: (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      onChange(raw === '' ? undefined : Number(raw));
    } },
  }) as HTMLInputElement;
  return el;
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

// --- screenshots gallery ---------------------------------------------------------

function screenshotsSection(shots: string[]): HTMLElement {
  if (!shots.length) {
    // Collapsed: the section is reserved, not populated (capture is best-effort).
    return card({ title: 'Screenshots', sub: 'end-of-match captures' },
      h('div', { class: 'hint' }, 'No screenshots were captured for this match.'));
  }
  return card({ title: 'Screenshots', sub: 'end-of-match captures' },
    h('div', { class: 'shot-grid' },
      ...shots.map((src) => h('img', { class: 'shot', src, alt: 'End-of-match screenshot', loading: 'lazy' })),
    ),
  );
}
