/**
 * The quick-log card — opens after a game, ~5 taps. Captures the fields the app
 * can't auto-detect and persists a real match to history via the bridge, so it
 * flows into every dashboard stat (including the mental composite, from the
 * flags below). Account / result / role / map are chosen here; hero is
 * optional. Vantage is competitive-only (spec D1), so every manual log is sent
 * as competitive — it also captures the skill-rating % (and, the first time for
 * an account+role, the current rank anchor) and grades any active improvement
 * targets inline.
 */
import { h, render } from '../dom';
import { time, roleLabel } from '../format';
import { registerShortcut } from '../shortcuts';
import { badge, button, select } from '../components/primitives';
import { openModal } from '../components/overlay';
import { mapPicker, resolveMapName } from '../components/mapPicker';
import { targetGradeRow, mentalFlagChips, commsToneSwitch } from '../components/reviewControls';
import { resultChooser, bindResultKeys } from '../components/resultChooser';
import { paintHeroChips } from '../components/heroPicker';
import { performanceSlider } from '../components/performanceSlider';
import { field, optionalLabel } from '../components/formField';
import { srModeToggle, srDeltaInput, rankPicker, type SrMode } from '../components/srControls';
import { toast } from '../components/toast';
import { bridge } from '../bridge';
import { prefs, DEFAULT_SUGGESTED_HEROES } from '../prefs';
import type { AccountSummary, MatchMental, RankSummary, Result, Role, TargetGrade } from '../../../src/shared/contract';
import type { ViewContext } from '../views/view';

const ROLE_LABELS: Record<string, Role> = { Tank: 'tank', Damage: 'damage', Support: 'support', 'Open Queue': 'openQ' };

/** Preset SR delta for a result — the game moves rank ~±25 per competitive game. */
function presetFor(result: Result): string {
  return result === 'Win' ? '25' : result === 'Loss' ? '-25' : '0';
}
/** "Played" backfill choices — end-of-game time relative to now, in minutes. */
const PLAYED_OFFSETS: Array<{ label: string; minutes: number }> = [
  { label: 'Just now', minutes: 0 },
  { label: '30m ago', minutes: 30 },
  { label: '1h ago', minutes: 60 },
  { label: '2h ago', minutes: 120 },
];

interface LogState {
  result: Result;
  role: Role;
  map: string;
  /** Heroes played this match — the card allows several. */
  heroes: Set<string>;
  account: string;
  /** The mental self-report (flags + comms tone), toggled in place by the shared chips/switch. */
  mental: MatchMental;
  /** How SR is entered: nudge the change, or set the current rank directly. */
  srMode: SrMode;
  srDelta: string;
  /** True once the player has typed/wheeled SR, so a result change stops re-presetting it. */
  srEdited: boolean;
  anchorTier: string;
  anchorDivision: number;
  anchorPct: string;
  /** Absolute end-of-game timestamp (ms epoch), or null for "Just now" (stamped at save time). */
  playedAt: number | null;
  /** Self-rated performance for this match, 0-100, or undefined if not rated. */
  performance: number | undefined;
}

/** Fields carried into the next form by "Save & next" (same sitting, so heroes usually hold). */
export interface LogCarry {
  heroes?: string[];
}

// Cheatsheet entries only — the dialog binds these keys itself (the global
// dispatcher never fires over an open overlay), so `when` keeps them inert.
const never = (): boolean => false;
registerShortcut({ combo: 'w', description: 'Result: Win (in the log dialog)', group: 'Log match', when: never, run: () => {} });
registerShortcut({ combo: 'l', description: 'Result: Loss (in the log dialog)', group: 'Log match', when: never, run: () => {} });
registerShortcut({ combo: 'd', description: 'Result: Draw (in the log dialog)', group: 'Log match', when: never, run: () => {} });
registerShortcut({ combo: 'enter', description: 'Save the match (in the log dialog)', group: 'Log match', when: never, run: () => {} });
registerShortcut({ combo: 'ctrl+enter', description: 'Save & log another (in the log dialog)', group: 'Log match', when: never, run: () => {} });

/**
 * Serialize the chip/switch-driven mental state into the optional per-match
 * self-report: only truthy flags and a set comms tone go out (a toggled-off
 * chip leaves a `false` behind in the working object), and an untouched report
 * stays `undefined` so nothing is logged for it.
 */
function mentalFrom(mental: MatchMental): MatchMental | undefined {
  const m: MatchMental = {};
  if (mental.tilt) m.tilt = true;
  if (mental.toxicMates) m.toxicMates = true;
  if (mental.leaverMyTeam) m.leaverMyTeam = true;
  if (mental.leaverEnemyTeam) m.leaverEnemyTeam = true;
  if (mental.comms) m.comms = mental.comms;
  return Object.keys(m).length ? m : undefined;
}

export function openLogMatch(ctx: ViewContext, carry?: LogCarry): void {
  // Accounts + current ranks decide the picker options and whether the first-time
  // rank anchor is still needed; most-played heroes seed the hero-picker shortlist.
  // All fetched before building the form.
  void Promise.all([bridge.listAccounts(), bridge.getRanks(), bridge.mostPlayedHeroes()]).then(
    ([accounts, ranks, mostPlayed]) => {
      openModal((close) => buildForm(ctx, close, accounts, ranks, mostPlayed, carry), {
        panelClass: 'modal-card--wide',
      });
    },
  );
}

function buildForm(
  ctx: ViewContext,
  close: () => void,
  accounts: AccountSummary[],
  ranks: RankSummary[],
  mostPlayed: Record<string, Partial<Record<Role, string[]>>>,
  carry?: LogCarry,
): HTMLElement {
  const accountOptions = accounts.length
    ? accounts.map((a) => ({ value: a.label, label: a.label }))
    : [{ value: 'You', label: 'You' }];
  const prefill = prefs.get('logPrefill');
  // Prefill Account/Role from the active dashboard filter when it names a specific
  // value — logging while scoped to an account/role should target it — otherwise
  // fall back to the last-logged values. Role only when the log form can represent
  // it (Tank/Damage/Support; Open Queue isn't a log option).
  const { account: filterAccount, role: filterRole } = ctx.data.filters;
  const seededAccount = filterAccount !== 'all' ? accountOptions.find((o) => o.value === filterAccount)?.value : undefined;
  const defaultAccount = seededAccount ?? accountOptions.find((o) => o.value === prefill?.account)?.value ?? accountOptions[0].value;
  const seededRole = filterRole !== 'all' && Object.values(ROLE_LABELS).includes(filterRole as Role) ? (filterRole as Role) : undefined;

  const initialRole: Role = seededRole ?? (prefill?.role as Role) ?? 'damage';

  const hasAnchor = (account: string, role: Role): boolean =>
    ranks.some((r) => r.account === account && r.role === role);

  const state: LogState = {
    result: 'Win',
    role: initialRole,
    map: '',
    heroes: new Set<string>(carry?.heroes ?? []),
    account: defaultAccount,
    mental: {},
    // No anchor yet for this account+role → open in "Set current rank" so the
    // starting rank gets established there (replacing the old one-time-setup
    // block); otherwise default to nudging the change.
    srMode: hasAnchor(defaultAccount, initialRole) ? 'change' : 'set-current',
    srDelta: presetFor('Win'),
    srEdited: false,
    anchorTier: 'Gold',
    anchorDivision: 3,
    anchorPct: '',
    playedAt: null,
    performance: undefined,
  };

  const grades: Record<string, TargetGrade> = {};
  const activeTargets = ctx.data.targets.filter((t) => t.isActive && !t.archivedAt);

  // Free-typed map text resolves case-insensitively onto the known map list
  // (spec AC 22 — inactive maps stay loggable); see resolveMapName.
  const resolveMap = (): string | null => resolveMapName(state.map, ctx.data.masterData.maps);

  // The map combobox is strict (see mapField below): its committed value can
  // only ever be an exact known map name or empty. Save stays disabled the
  // whole time it's empty, rather than only erroring after a submit attempt.
  const saveButtons: HTMLButtonElement[] = [];
  const updateSaveEnabled = (): void => {
    const enabled = resolveMap() != null;
    for (const b of saveButtons) b.disabled = !enabled;
  };

  // Guards against duplicate submits from this form (Enter auto-repeat, double
  // Enter/click before the first save resolves) — matchId is time-derived, so
  // dedupe downstream can't catch a double-fire here.
  let saving = false;

  // Returns false when validation failed, a save is already in flight, or the
  // save itself failed (form stays open, error/toast shown inline).
  const persist = async (): Promise<boolean> => {
    if (saving) return false;
    const map = resolveMap();
    if (!map) {
      mapError.textContent = state.map.trim()
        ? `"${state.map.trim()}" isn't a known map — pick one from the list.`
        : 'Pick the map — start typing and choose from the list.';
      mapError.classList.remove('hidden');
      return false;
    }
    state.map = map;
    saving = true;
    try {
      // "Set current rank" re-anchors the rank directly; the match then carries
      // no srDelta so it can't double-count on top of the fresh anchor.
      const setCurrent = state.srMode === 'set-current';
      // Vantage is competitive-only (spec D1) — manual logs always report as such.
      const srDelta = !setCurrent && state.srDelta.trim() !== '' ? Number(state.srDelta) : undefined;
      await bridge.logMatch({
        result: state.result,
        role: state.role,
        map,
        heroes: [...state.heroes],
        gameType: 'Competitive',
        mental: mentalFrom(state.mental),
        account: state.account,
        ...(srDelta != null && Number.isFinite(srDelta) ? { srDelta } : {}),
        ...(state.performance != null ? { performance: state.performance } : {}),
        ...(Object.keys(grades).length ? { grades } : {}),
        ...(state.playedAt != null ? { playedAt: state.playedAt } : {}),
      });
      // Only "Set current rank" re-anchors — it's the single path for
      // establishing/correcting the rank now (a negative % is preserved as a
      // rank-protection carry). Change mode only ever records the srDelta above.
      if (setCurrent) {
        await bridge.setRankAnchor({
          account: state.account,
          role: state.role,
          tier: state.anchorTier,
          division: state.anchorDivision,
          progressPct: Number(state.anchorPct) || 0,
        });
      }
    } catch {
      toast('Save failed — nothing was logged. Try again.');
      return false;
    } finally {
      saving = false;
    }
    prefs.set('logPrefill', { role: state.role, account: state.account });
    toast(`Match logged — ${state.result} · ${map}`);
    ctx.refresh();
    return true;
  };

  const timeBadgeHost = h('span');
  const paintTime = (): void => {
    render(timeBadgeHost, badge(`◎ manual · ${time(state.playedAt ?? Date.now())}`, 'manual'));
  };
  paintTime();

  const header = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' } },
    h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, 'Log match'),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      timeBadgeHost,
      h('button', { class: 'overlay-close', on: { click: close } }, '✕'),
    ),
  );

  const resultRow = resultChooser({
    value: state.result,
    keys: true,
    onChange: (v) => {
      state.result = v;
      // Re-preset the SR delta from the result, but only while the player hasn't
      // touched it — a manual value must survive a result change.
      if (!state.srEdited) state.srDelta = presetFor(state.result);
      paintRank();
    },
  });

  const accountField = field('Account',
    // Account scopes both the rank (per account+role) and the hero-picker
    // shortlist (per-account most-played) — repaint both. Re-seed the Set-current
    // rank picker too, if it's the active mode, so it reflects the new account.
    select(accountOptions, state.account, (v) => {
      state.account = v;
      if (state.srMode === 'set-current') seedAnchorFromRanks();
      paintRank();
      paintHeroes();
    }),
  );

  const mapError = h('div', { class: 'hint hidden', style: { color: 'var(--loss-text, #d18a84)', marginTop: '4px' } });
  const mapField = field('Map',
    mapPicker({
      value: state.map,
      maps: ctx.data.masterData.maps,
      recentMaps: ctx.data.matches.map((m) => m.map),
      onChange: (v) => { state.map = v; mapError.classList.add('hidden'); updateSaveEnabled(); },
    }),
  );
  mapField.append(mapError);

  const roleLabelInitial = Object.keys(ROLE_LABELS).find((k) => ROLE_LABELS[k] === state.role) ?? 'Damage';
  const roleField = field('Role',
    // Role decides the hero filter (rank is tracked per role too) — repaint both,
    // and re-seed the Set-current rank picker for the new role if it's active.
    choiceSegment(Object.keys(ROLE_LABELS), roleLabelInitial, (v) => {
      state.role = ROLE_LABELS[v];
      if (state.srMode === 'set-current') seedAnchorFromRanks();
      paintRank();
      paintHeroes();
    }),
  );

  const playedField = field(
    optionalLabel('Played', '— backfill a game you forgot to log'),
    choiceSegment(PLAYED_OFFSETS.map((o) => o.label), PLAYED_OFFSETS[0].label, (v) => {
      // Snapshot the absolute timestamp at click time — "Just now" stays null so
      // both the badge and the eventual save reflect the moment actually chosen,
      // not a live-recomputed offset that would drift while the form sits open.
      const minutes = PLAYED_OFFSETS.find((o) => o.label === v)?.minutes ?? 0;
      state.playedAt = minutes > 0 ? Date.now() - minutes * 60_000 : null;
      paintTime();
    }),
  );

  // Multi-hero picker: a role-filtered chip grid (union with anything already
  // picked, so switching role keeps off-role picks visible/removable). Toggling
  // a chip flips its `is-on` in place; only a role change repaints the grid.
  const heroHost = h('div');
  const paintHeroes = (): void => {
    const limit = prefs.get('suggestedHeroCount') ?? DEFAULT_SUGGESTED_HEROES;
    const shortlist = (mostPlayed[state.account]?.[state.role] ?? []).slice(0, limit);
    paintHeroChips(heroHost, state.heroes, state.role, ctx.data.masterData.heroes, { shortlist, search: true });
  };
  paintHeroes();
  const heroField = field(optionalLabel('Heroes', '— tap all you played'), heroHost);

  /**
   * Seed tier/division/% from the account+role's existing recorded rank when
   * entering Set-current mode (mirrors Settings' openSetRank prefill) — there's
   * nothing to prefill when no anchor exists yet, so the hardcoded Gold/3/blank
   * defaults stand.
   */
  const seedAnchorFromRanks = (): void => {
    const r = ranks.find((x) => x.account === state.account && x.role === state.role);
    if (!r) return;
    state.anchorTier = r.tier;
    state.anchorDivision = r.division;
    state.anchorPct = r.needsReanchor ? '' : String(Math.round(r.progressPct));
  };

  // Rank block: SR every match, plus the one-time anchor. Everything is
  // competitive now (spec D1), so this always shows — it re-paints when
  // account/role/mode/result change, since those decide what it renders.
  const rankHost = h('div');
  const paintRank = (): void => {
    const toggleRow = field(
      optionalLabel('Skill rating', '— nudge the change or set your rank'),
      srModeToggle(state.srMode, (v) => {
        state.srMode = v;
        if (v === 'set-current') seedAnchorFromRanks();
        paintRank();
      }),
    );

    if (state.srMode === 'set-current') {
      render(rankHost, toggleRow,
        field(optionalLabel('Current rank', '— negative % means in rank protection'), rankPicker({
          tier: state.anchorTier,
          division: state.anchorDivision,
          pct: state.anchorPct,
          onTier: (v) => (state.anchorTier = v),
          onDivision: (v) => (state.anchorDivision = v),
          onPct: (v) => (state.anchorPct = v),
        })),
        h('div', { class: 'hint', style: { marginTop: '4px' } },
          `Sets ${roleLabel(state.role)} on ${state.account} to this rank — we track from here.`));
      return;
    }

    const srField = field(optionalLabel('Skill rating change (%)'),
      srDeltaInput(state.srDelta, (v) => { state.srDelta = v; state.srEdited = true; }));
    const hint = hasAnchor(state.account, state.role)
      ? `Rank tracked for ${roleLabel(state.role)} on ${state.account} — the % above moves it.`
      : `No rank tracked for ${roleLabel(state.role)} on ${state.account} yet — switch to “Set current rank” to set your starting rank.`;
    render(rankHost, toggleRow, srField,
      h('div', { class: 'hint', style: { marginTop: '6px' } }, hint));
  };
  paintRank();

  // Flags + comms: the shared chip row and three-state comms switch (also used
  // by the editor and Review), toggling the mental self-report in place.
  const flagsBlock = field(
    optionalLabel('Flags', "— manual, the game doesn't report these"),
    mentalFlagChips(state.mental),
  );
  const commsBlock = field(optionalLabel('Comms', '— how team comms felt'),
    commsToneSwitch(state.mental));

  const targetsBlock = activeTargets.length
    ? field(
        optionalLabel('Targets', '— grade now or later on Review'),
        h('div', { class: 'stack', style: { gap: '10px' } },
          ...activeTargets.map((t) => targetGradeRow(t, grades[t.id], (g) => { grades[t.id] = g; }).el),
        ),
      )
    : null;

  const saveAndClose = (): void => { void persist().then((ok) => { if (ok) close(); }); };
  const saveAndNext = (): void => {
    void persist().then((ok) => {
      if (!ok) return;
      close();
      // Same sitting → the heroes usually hold; map/result never do.
      openLogMatch(ctx, { heroes: [...state.heroes] });
    });
  };

  const saveBtn = button('Save ⏎', { variant: 'primary', class: 'btn--block', onClick: saveAndClose });
  const saveNextBtn = button('Save & next  ⌃⏎', { title: 'Save and log another (Ctrl+Enter)', onClick: saveAndNext });
  saveButtons.push(saveBtn, saveNextBtn);
  updateSaveEnabled();
  const actions = h('div', { style: { display: 'flex', gap: '10px', paddingTop: '2px' } }, saveBtn, saveNextBtn);

  const performanceBlock = field(
    optionalLabel('Performance', '— how did you play?'),
    performanceSlider(state.performance, (v) => { state.performance = v; }),
  );

  // Two columns: the match facts (what happened) on the left, the manual
  // self-report (how it felt / how you played) on the right — keeps the card
  // short. Collapses to one column on a narrow viewport (see .log-grid CSS).
  // tabindex -1: focusable via script (for the mount-time focus below) but not
  // part of the natural Tab order.
  const form = h('div', { tabindex: '-1', style: { outline: 'none' } }, header,
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' } },
      h('div', { class: 'log-grid' },
        h('div', { class: 'log-col' },
          field('Result', resultRow), accountField, mapField, roleField, playedField, heroField, rankHost),
        h('div', { class: 'log-col' },
          performanceBlock, commsBlock, flagsBlock, targetsBlock),
      ),
      actions,
    ),
  );

  // Keyboard flow: W/L/D pick the result when not typing (shared binding);
  // Enter saves from anywhere but a button (a focused button keeps its native
  // click) and the typeahead swallows Enter itself while its list is open.
  bindResultKeys(form, resultRow);
  form.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    // e.repeat: ignore key-repeat from a held Enter — only a fresh keydown saves.
    if (e.key === 'Enter' && !e.repeat && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) saveAndNext();
      else saveAndClose();
    }
  });

  // Nothing moves focus into the dialog by default, which leaves W/L/D dead and
  // (worse) leaves focus on the opener button, so a stray Enter re-clicks it and
  // stacks a second dialog. openModal appends the form after buildForm returns,
  // so defer the focus to the next frame once it's actually in the DOM.
  requestAnimationFrame(() => form.focus());

  return form;
}

// --- little local builders --------------------------------------------------

/** Compact segmented choice (Role, Mode). */
function choiceSegment(options: string[], initial: string, onPick: (value: string) => void): HTMLElement {
  const seg = h('div', { class: 'segmented segmented--fill' });
  const buttons = options.map((opt) => {
    const btn = h('button', { class: `segmented-opt${opt === initial ? ' is-active' : ''}` }, opt);
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('is-active');
      btn.classList.add('is-active');
      onPick(opt);
    });
    return btn;
  });
  seg.append(...buttons);
  return seg;
}
