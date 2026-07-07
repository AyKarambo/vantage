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
import { badge, button, select, segmented } from '../components/primitives';
import { openModal } from '../components/overlay';
import { typeahead } from '../components/typeahead';
import { targetGradeRow } from '../components/reviewControls';
import { resultChooser } from '../components/resultChooser';
import { commsSwitch } from '../components/commsSwitch';
import { paintHeroChips } from '../components/heroPicker';
import { performanceSlider } from '../components/performanceSlider';
import { attachWheelNudge } from './wheelStepper';
import { toast } from '../components/toast';
import { bridge } from '../bridge';
import { prefs, DEFAULT_SUGGESTED_HEROES } from '../prefs';
import { TIERS } from '../../../src/core/rank';
import type { AccountSummary, CommsTone, MatchMental, RankSummary, Result, Role, TargetGrade } from '../../../src/shared/contract';
import type { ViewContext } from '../views/view';

const FLAGS = ['Tilt', 'Toxic mates', 'Leaver — my team', 'Leaver — enemy'];
const ROLE_LABELS: Record<string, Role> = { Tank: 'tank', Damage: 'damage', Support: 'support', 'Open Queue': 'openQ' };
const DIVISIONS = [5, 4, 3, 2, 1];

/** The SR-entry mode: nudge the change (±%) or set the current rank outright. */
type SrMode = 'change' | 'set-current';

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
  flags: Set<string>;
  /** Comms tone, or null when the player left the switch unset. */
  comms: CommsTone | null;
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

/** Turn the chip selection + comms switch into the optional per-match mental self-report. */
function mentalFrom(flags: Set<string>, comms: CommsTone | null): MatchMental | undefined {
  const m: MatchMental = {};
  if (flags.has('Tilt')) m.tilt = true;
  if (flags.has('Toxic mates')) m.toxicMates = true;
  if (flags.has('Leaver — my team')) m.leaverMyTeam = true;
  if (flags.has('Leaver — enemy')) m.leaverEnemyTeam = true;
  if (comms) m.comms = comms;
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
    flags: new Set<string>(),
    comms: null,
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

  /**
   * Resolve free-typed map text onto the known map list (case-insensitive).
   * Resolution is NOT gated by `isActive`: a user backfilling a game on a map
   * that has since rotated out of the pool must still be able to type it and log
   * it (spec AC 22) — only the browse suggestions hide inactive maps.
   */
  const resolveMap = (): string | null => {
    const q = state.map.trim().toLowerCase();
    if (!q) return null;
    return ctx.data.masterData.maps.map((m) => m.name).find((m) => m.toLowerCase() === q) ?? null;
  };

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
        mental: mentalFrom(state.flags, state.comms),
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
  const mutedMapNames = new Set(ctx.data.masterData.maps.filter((m) => !m.isActive).map((m) => m.name));
  const mapField = field('Map',
    typeahead({
      value: state.map,
      placeholder: 'start typing — recent maps listed first',
      suggestions: mapSuggestions(ctx),
      searchSuggestions: allMapNames(ctx),
      mutedItems: mutedMapNames,
      strict: true,
      showOnFocus: true,
      inputClass: 'vt-input',
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

  // SR-delta input with the mouse-wheel nudge (±1) and edit tracking.
  const srDeltaInput = (): HTMLInputElement => {
    const el = numInput(state.srDelta, 'e.g. +22 or -19', (v) => { state.srDelta = v; state.srEdited = true; });
    attachWheelNudge(el, () => state.srDelta, (v) => { state.srDelta = v; state.srEdited = true; });
    return el;
  };

  // Tier / division / % picker — the "Set current rank" mode's input.
  const rankPicker = (): HTMLElement => {
    const pctInput = numInput(state.anchorPct, 'e.g. 40, or -19 if protected', (v) => (state.anchorPct = v));
    attachWheelNudge(pctInput, () => state.anchorPct, (v) => (state.anchorPct = v));
    return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      select(TIERS.map((t) => ({ value: t, label: t })), state.anchorTier, (v) => (state.anchorTier = v)),
      select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(state.anchorDivision),
        (v) => (state.anchorDivision = Number(v))),
      pctInput,
    );
  };

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
      segmented<SrMode>({
        options: [{ value: 'change', label: 'Change (±%)' }, { value: 'set-current', label: 'Set current rank' }],
        value: state.srMode,
        onChange: (v) => {
          state.srMode = v;
          if (v === 'set-current') seedAnchorFromRanks();
          paintRank();
        },
        fill: true,
      }),
    );

    if (state.srMode === 'set-current') {
      render(rankHost, toggleRow,
        field(optionalLabel('Current rank', '— negative % means in rank protection'), rankPicker()),
        h('div', { class: 'hint', style: { marginTop: '4px' } },
          `Sets ${roleLabel(state.role)} on ${state.account} to this rank — we track from here.`));
      return;
    }

    const srField = field(optionalLabel('Skill rating change (%)'), srDeltaInput());
    const hint = hasAnchor(state.account, state.role)
      ? `Rank tracked for ${roleLabel(state.role)} on ${state.account} — the % above moves it.`
      : `No rank tracked for ${roleLabel(state.role)} on ${state.account} yet — switch to “Set current rank” to set your starting rank.`;
    render(rankHost, toggleRow, srField,
      h('div', { class: 'hint', style: { marginTop: '6px' } }, hint));
  };
  paintRank();

  const flagsBlock = field(
    optionalLabel('Flags', "— manual, the game doesn't report these"),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
      ...FLAGS.map((f) => {
        const el = h('button', { class: `chip${state.flags.has(f) ? ' is-on' : ''}` }, f);
        el.addEventListener('click', () => {
          state.flags.has(f) ? state.flags.delete(f) : state.flags.add(f);
          el.classList.toggle('is-on');
        });
        return el;
      }),
    ),
  );

  // Comms tone: a single-select colour switch (green/yellow/red). Clicking the
  // active option again clears it — comms stays optional. Shared with the editor
  // and Review via the commsSwitch component.
  const commsBlock = field(optionalLabel('Comms', '— how team comms felt'),
    commsSwitch({ get: () => state.comms, set: (t) => { state.comms = t; } }));

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

  // Keyboard flow: W/L/D pick the result when not typing; Enter saves from
  // anywhere but a button (a focused button keeps its native click) and the
  // typeahead swallows Enter itself while its list is open.
  form.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    if (!typing) {
      const byKey: Record<string, string> = { w: 'Win', l: 'Loss', d: 'Draw' };
      const pick = byKey[e.key.toLowerCase()];
      if (pick && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        resultRow.querySelectorAll('button').forEach((b) => {
          if (b.dataset.value === pick) b.click();
        });
        return;
      }
    }
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

/**
 * Browse order for the map typeahead: recently-played first, then the rest —
 * built from the ACTIVE competitive pool only, so a map rotated out of the pool
 * is hidden from suggestions (spec AC 21). It stays type-resolvable via
 * {@link resolveMap} (AC 22), so history on it is never blocked.
 */
function mapSuggestions(ctx: ViewContext): string[] {
  const active = ctx.data.masterData.maps
    .filter((m) => m.isActive)
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));
  const activeSet = new Set(active);
  const recent: string[] = [];
  for (const m of ctx.data.matches) if (activeSet.has(m.map) && !recent.includes(m.map)) recent.push(m.map);
  const rest = active.filter((m) => !recent.includes(m));
  return [...recent, ...rest];
}

/**
 * Every known map (active + inactive), sorted — the locked combobox's search
 * pool, so a rotated-out map is still reachable by typing its name (spec AC
 * 21/22), just deprioritized/muted rather than hidden.
 */
function allMapNames(ctx: ViewContext): string[] {
  return ctx.data.masterData.maps.map((m) => m.name).sort((a, b) => a.localeCompare(b));
}

function field(label: Node | string, control: Node): HTMLElement {
  return h('div', null, typeof label === 'string' ? h('div', { class: 'field-label' }, label) : label, control);
}

/** A field label with a dimmed "— optional / …" suffix. */
function optionalLabel(label: string, suffix = '— optional'): HTMLElement {
  return h('span', null,
    h('span', { class: 'field-label', style: { display: 'inline', margin: '0' } }, label),
    h('span', { class: 'u-dim', style: { fontSize: '11px', marginLeft: '6px' } }, suffix),
  );
}

/** A text/number input styled like the rest of the form. */
function numInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder,
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}

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
