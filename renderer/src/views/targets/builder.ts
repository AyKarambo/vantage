/**
 * Improvement Target builder — the flexible creation/edit surface. Doubles as
 * the edit surface (a library row's Edit re-opens it pre-filled via `BuilderHandle.edit`),
 * and as the prefill target for the Target library card and Focus's quick-create
 * (`BuilderHandle.prefill`).
 */
import { h, render } from '../../dom';
import type { HeroEntry, Role, TargetMode, TargetSummary } from '../../../../src/shared/contract';
import { stepFor, parseMeasuredRule, roundToStep, MEASURED_STATS, type ThresholdSuggestion } from '../../../../src/core/targets';
import { PALETTE } from '../../theme';
import { badge, button, card, segmented, select } from '../../components/primitives';
import { attachStepper } from '../../components/wheelStepper';
import { paintHeroChips } from '../../components/heroPicker';
import { roleIcon } from '../../components/roleIcon';
import { roleLabel, fmt, fmt1, ratio } from '../../format';
import { inlineLink } from '../../components/inlineLink';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';

export const STATS = MEASURED_STATS;
export const OPS = ['≤', '≥', '='];

export interface BuilderState {
  /** Set while editing an existing target — Save then updates instead of creating. */
  editingId: string | null;
  name: string;
  mode: TargetMode;
  saved: boolean;
  stat: string;
  op: string;
  value: string;
  /** Role/hero scope (D), shared by both modes. Undefined = "Any" (applies to the whole match). */
  roleScope?: Role;
  heroScope?: string[];
}

export interface BuilderHandle {
  el: HTMLElement;
  /** Load an existing target into the builder (edit mode). Opens the card if it was collapsed. */
  edit: (t: TargetSummary) => void;
  /** Load a template (or a Focus quick-create) into the builder — always
   *  creates on save, even if the builder was mid-edit (AC 1–2). `roleScope`/
   *  `heroScope` (H1) seed the scope picker for a hero/role quick-create.
   *  Opens the card if it was collapsed. */
  prefill: (t: { name: string; mode: TargetMode; rule: string; roleScope?: Role; heroScope?: string[] }) => void;
}

// NOTE: save()'s rule template (`${stat} ${op} ${value}`) and loadRule()'s
// `parseMeasuredRule` (shared with core scoring/auto-grading) are the two halves
// of one round-trip — the format is owned by `src/core/targets/measured.ts` so it
// cannot drift between writing, reading, and auto-grading.
export function builderCard(ctx: ViewContext, opts: { startOpen: boolean }): BuilderHandle {
  const state: BuilderState = {
    editingId: null,
    // Blank, not a real-looking sample name (R5) — a returning player who
    // never even looked at this field used to be one accidental Save away
    // from a target literally named "Trade before you die".
    name: '',
    mode: 'self',
    saved: false,
    stat: 'Deaths',
    op: '≤',
    value: '4',
    roleScope: undefined,
    heroScope: undefined,
  };
  // Collapsed by default once the player already has a set (R5) — the builder
  // used to always be the first thing on the screen, pushing "how are my
  // targets doing" (the page's actual daily question) below the fold.
  let open = opts.startOpen;
  const host = h('div');

  const save = (): void => {
    const name = state.name.trim() || 'Untitled target';
    const rule = state.mode === 'self' ? 'You grade it' : `${state.stat} ${state.op} ${state.value}`;
    // Scope applies identically to both modes now — always send it.
    const scope = { roleScope: state.roleScope, heroScope: state.heroScope };
    const persist = state.editingId
      ? bridge.updateTarget({ id: state.editingId, name, mode: state.mode, rule, ...scope })
      : bridge.saveTarget({ name, mode: state.mode, rule, ...scope });
    void persist.then(() => {
      state.saved = true;
      draw();
      ctx.refresh(); // re-pull so the change appears in the library below
    });
  };

  const draw = (): void => {
    if (!open) { render(host); return; }
    const gradeBlock = h('div');
    const footer = h('div');
    const dirty = (): void => { state.saved = false; drawFooter(); };

    const drawGrade = (): void => {
      render(gradeBlock, state.mode === 'self'
        ? selfBlock(state, ctx.data.masterData.heroes, dirty)
        : measuredBlock(state, ctx.data.masterData.heroes, dirty, ctx));
    };
    const drawFooter = (): void => {
      render(footer,
        state.saved
          ? h('div', { class: 'pill is-accent', style: { padding: '10px 14px' } }, '✓ Saved to your library')
          : button(state.editingId ? 'Save changes' : 'Save to library',
              { variant: 'primary', class: 'btn--block', onClick: save }),
      );
    };

    drawGrade();
    drawFooter();

    render(host, card(
      {
        variant: 'raised',
        title: state.editingId ? 'Edit target' : 'Define a target',
        sub: state.editingId ? 'stats keep accruing across edits' : 'Make it yours',
      },
      h('div', { class: 'field-label' }, 'Name your focus'),
      h('input', {
        class: 'target-name-input',
        value: state.name,
        placeholder: 'e.g. Trade before you die',
        on: { input: (e) => { state.name = (e.target as HTMLInputElement).value; dirty(); } },
      }),
      h('div', { class: 'field-label', style: { marginTop: '16px' } }, "How it's graded"),
      segmented<TargetMode>({
        fill: true,
        value: state.mode,
        options: [{ value: 'self', label: '◎ Self-rated' }, { value: 'measured', label: '⚡ Measured' }],
        onChange: (v) => {
          state.mode = v;
          dirty();
          drawGrade();
        },
      }),
      h('div', { style: { marginTop: '12px' } }, gradeBlock),
      h('div', { style: { marginTop: '16px' } }, footer),
    ));
  };

  // Shared by edit() and prefill(): loads name/mode and, for measured rules,
  // parses the `${stat} ${op} ${value}` string back into the stat/op/value
  // controls via the shared core parser (`parseMeasuredRule`), the inverse of
  // save()'s template — one round-trip, one source of truth.
  const loadRule = (t: { name: string; mode: TargetMode; rule: string; roleScope?: Role; heroScope?: string[] }): void => {
    state.name = t.name;
    state.mode = t.mode;
    state.saved = false;
    // Round-trip scope on edit regardless of mode; templates carry none, so they clear it.
    state.roleScope = t.roleScope;
    state.heroScope = t.heroScope;
    const rule = parseMeasuredRule(t.rule);
    if (t.mode === 'measured' && rule) {
      state.stat = rule.stat;
      state.op = rule.op;
      state.value = String(rule.value);
    }
  };

  // Deferred a tick: edit/prefill also run during view construction (the detail
  // page's editTargetId hop, Focus quick-create), where the host isn't mounted
  // yet — scrollIntoView on a detached node is a no-op — and the shell restores
  // the route's remembered scroll right after mounting, which would override an
  // immediate scroll anyway. Same idiom as the Maps highlight reveal.
  const reveal = (): void => {
    setTimeout(() => host.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const edit = (t: TargetSummary): void => {
    open = true;
    state.editingId = t.id;
    loadRule(t);
    draw();
    reveal();
  };

  const prefill = (t: { name: string; mode: TargetMode; rule: string; roleScope?: Role; heroScope?: string[] }): void => {
    open = true;
    // Always creates on save — abandon any in-progress edit (AC 2).
    state.editingId = null;
    loadRule(t);
    draw();
    reveal();
  };

  draw();
  return { el: host, edit, prefill };
}

export function selfBlock(state: BuilderState, heroes: HeroEntry[], onChange: () => void): HTMLElement {
  return h('div', { class: 'card', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '9px' } }, 'You judge it after the game. No stats needed.'),
    h('div', { style: { display: 'flex', gap: '7px' } },
      gradeChip('Hit', PALETTE.winText), gradeChip('Partial', PALETTE.mid), gradeChip('Missed', PALETTE.lossText)),
    scopeBlock(state, heroes, onChange),
  );
}

export const previewText = (s: BuilderState): string => `Hit when ${s.stat} ${s.op} ${formatThreshold(s.value)}`;

/** Thousands-separate the threshold for the preview (e.g. 9250 → "9,250"); leave partial input as typed. */
function formatThreshold(value: string): string {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) ? n.toLocaleString('en-US') : value;
}

/** The role-scope options: "Any" (undefined) plus the three queue roles. */
const ROLE_SCOPE_OPTIONS: Array<{ value: Role | undefined; label: string }> = [
  { value: undefined, label: 'Any role' },
  { value: 'tank', label: 'Tank' },
  { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' },
];

/** A measured stat's suggested value, formatted the same way the rest of the app shows that stat (H5-style: one decimal for the small count rates, k-suffixed for the big volume ones, a plain ratio for KDA). */
function formatStatValue(stat: string, n: number): string {
  if (stat === 'KDA') return ratio(n);
  if (stat === 'Damage' || stat === 'Healing' || stat === 'Mitigation') return `${fmt(n)}/10`;
  return `${fmt1(n)}/10`;
}

/** The account the suggestion (R7) should read from — the switcher's current
 *  pick, or the first known account while "All accounts" is selected (a
 *  suggestion has to be per-account; there's no meaningful "usual" blended
 *  across a main and a smurf). `undefined` on a genuinely fresh install. */
export function suggestionAccount(ctx: ViewContext): string | undefined {
  return ctx.data.filters.account !== 'all' ? ctx.data.filters.account : ctx.data.options.accounts[0];
}

export function measuredBlock(state: BuilderState, heroes: HeroEntry[], onChange: () => void, ctx: ViewContext): HTMLElement {
  const preview = badge(previewText(state), 'auto');
  const update = (): void => { preview.textContent = previewText(state); onChange(); };

  const numInput = h('input', {
    class: 'vt-num', type: 'number', min: '0', step: String(stepFor(state.stat)),
    value: state.value, 'aria-label': 'threshold',
    on: { input: (e) => { state.value = (e.target as HTMLInputElement).value; update(); } },
  }) as HTMLInputElement;
  // Wheel + Shift-coarse adjust; the step is read live so it tracks the stat.
  attachStepper(numInput, { step: () => stepFor(state.stat), onChange: (v) => { state.value = v; update(); } });

  // "Your usual: …" (R7) — the player's own median/stretch for the chosen
  // stat + scope, fetched live and re-fetched whenever either changes.
  // `reqId` discards a stale response that resolves after a newer request
  // has already gone out (a fast stat/scope change firing two round-trips).
  const suggestionHost = h('div', { style: { marginTop: '10px' } });
  const account = suggestionAccount(ctx);
  let reqId = 0;
  const useValue = (v: number): void => {
    state.value = String(v);
    numInput.value = String(v);
    update();
  };
  const refreshSuggestion = (): void => {
    if (!account) { render(suggestionHost); return; }
    const stat = state.stat;
    const my = ++reqId;
    void bridge.suggestThreshold({
      stat, account, roleScope: state.roleScope, heroScope: state.heroScope,
    }).then((s) => {
      if (my !== reqId) return; // superseded by a newer stat/scope change
      render(suggestionHost, suggestionPanel(stat, s, useValue));
    });
  };
  refreshSuggestion();

  const statSelect = select(STATS.map((s) => ({ value: s, label: s })), state.stat, (v) => {
    state.stat = v;
    numInput.step = String(stepFor(v)); // keep arrow-key/spinner step in sync with the stat
    update();
    refreshSuggestion();
  });

  return h('div', { class: 'card' },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '10px' } }, 'Bind it to a stat and auto-grade:'),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      statSelect,
      select(OPS.map((o) => ({ value: o, label: o })), state.op, (v) => { state.op = v; update(); }),
      numInput,
      h('span', { class: 'u-muted' }, '→'),
      preview,
    ),
    h('div', { class: 'hint', style: { lineHeight: '1.5', marginTop: '10px' } },
      'Auto-graded from your end-of-match stats — Damage, Healing and Mitigation are read per 10 minutes. Scroll the number to adjust (hold Shift for bigger steps); matches the game does not report the stat for are skipped.'),
    suggestionHost,
    // Scope changes also affect the suggestion — it must re-fetch, not just
    // repaint the picker.
    scopeBlock(state, heroes, () => { onChange(); refreshSuggestion(); }),
  );
}

/** The "Your usual: …" line + one-click chips that write a personal, rounded
 *  value into the threshold (R7). `null` reads as "no stats yet" rather than
 *  silently showing nothing — a blank pane would look broken, not empty. */
function suggestionPanel(stat: string, s: ThresholdSuggestion | null, onUse: (v: number) => void): HTMLElement {
  if (!s) {
    return h('div', { class: 'hint' },
      'No stats yet for this stat and scope — play a few more games and your usual will show up here.');
  }
  const median = roundToStep(s.median, stat);
  const stretch = roundToStep(s.median * 1.1, stat);
  const best = roundToStep(s.p75, stat);
  return h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'hint' },
      `Your usual: ${formatStatValue(stat, median)} (median, ${s.n} game${s.n === 1 ? '' : 's'})`),
    h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      button(`Use median (${formatStatValue(stat, median)})`, {
        variant: 'ghost', title: 'Set the threshold to your median for this stat', onClick: () => onUse(median),
      }),
      button(`Use +10% (${formatStatValue(stat, stretch)})`, {
        variant: 'ghost', title: 'A modest stretch above your median', onClick: () => onUse(stretch),
      }),
      button(`Use my average (${formatStatValue(stat, best)})`, {
        variant: 'ghost', title: 'Your 75th percentile — how you play on your better games', onClick: () => onUse(best),
      }),
    ),
  );
}

/**
 * Role + hero scope, collapsed by default behind a one-line summary (R5) —
 * with "Any role" selected the full picker paints every hero in the game
 * (`paintHeroChips`'s openQ fallback), which used to be what filled the
 * whole viewport before Save was even visible, for a field most targets
 * never touch. Starts expanded when the loaded target already carries a
 * scope; otherwise a "Change" link reveals the untouched {@link scopePickers}.
 */
function scopeBlock(state: BuilderState, heroes: HeroEntry[], onChange: () => void): HTMLElement {
  const host = h('div');
  let expanded = state.roleScope != null || (state.heroScope?.length ?? 0) > 0;

  const summaryRow = (): HTMLElement => {
    const rolePart = state.roleScope ? roleLabel(state.roleScope) : 'any role';
    const heroPart = state.heroScope?.length ? state.heroScope.join(', ') : 'any hero';
    return h('div', {
      class: 'hint',
      style: { marginTop: '14px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
    },
      state.roleScope ? roleIcon(state.roleScope, { size: 13 }) : null,
      h('span', null, `Applies to: ${rolePart}, ${heroPart}`),
      h('span', null, '·'),
      inlineLink('Change', { onClick: () => { expanded = true; draw(); } }),
    );
  };

  const draw = (): void => {
    render(host, expanded ? scopePickers(state, heroes, onChange) : summaryRow());
  };
  draw();
  return host;
}

/** The role/hero picker (D) itself — restricts grading to a role and/or one
 *  or more heroes. Shared by both self-rated and measured targets; the scope
 *  is stored identically regardless of grading mode. Unchanged by the R5
 *  disclosure above it — only when it's shown changed, not what it shows. */
function scopePickers(state: BuilderState, heroes: HeroEntry[], onChange: () => void): HTMLElement {
  const heroHost = h('div');
  const heroSelected = new Set<string>(state.heroScope ?? []);
  const paintHeroes = (): void => {
    // "Any role" (undefined) → the full hero list (openQ shows everyone); a
    // specific role filters the grid to that role's heroes.
    paintHeroChips(heroHost, heroSelected, state.roleScope ?? 'openQ', heroes, { search: true });
  };
  // The chip is natively multi-select — it already toggled its own membership
  // in `heroSelected` and flipped its `is-on` class on the target phase, before
  // this bubble-phase handler runs. Just derive state from the Set's contents.
  heroHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.chip') as HTMLElement | null;
    if (!btn || !heroHost.contains(btn)) return;
    state.heroScope = heroSelected.size ? [...heroSelected] : undefined;
    onChange();
  });

  const roleHost = h('div', { class: 'segmented segmented--fill' });
  const paintRoles = (): void => {
    render(roleHost, ...ROLE_SCOPE_OPTIONS.map((opt) => {
      const active = state.roleScope === opt.value;
      const btn = h('button', { class: `segmented-opt${active ? ' is-active' : ''}`, title: opt.label },
        opt.value ? roleIcon(opt.value, { size: 14 }) : null,
        h('span', { style: { marginLeft: opt.value ? '5px' : '0' } }, opt.label),
      );
      btn.addEventListener('click', () => {
        if (state.roleScope === opt.value) return;
        state.roleScope = opt.value;
        // A specific role some of the scoped heroes don't belong to would make
        // an unsatisfiable role AND hero filter for those heroes — drop only
        // the now-off-role heroes, keep the rest gradable. Checked against the
        // effective master-data role (not the static built-in table), so a
        // hero whose role was overridden in Settings is judged correctly.
        if (state.roleScope) {
          const roleOf = (name: string): Role | undefined => heroes.find((entry) => entry.name === name)?.role;
          state.heroScope = state.heroScope?.filter((name) => roleOf(name) === state.roleScope);
          if (state.heroScope && state.heroScope.length === 0) state.heroScope = undefined;
          heroSelected.clear();
          state.heroScope?.forEach((name) => heroSelected.add(name));
        }
        paintRoles();
        paintHeroes(); // the hero grid re-filters to the newly chosen role
        onChange();
      });
      return btn;
    }));
  };
  paintRoles();
  paintHeroes();

  return h('div', null,
    h('div', { class: 'field-label', style: { marginTop: '14px' } }, 'Scope (optional)'),
    h('div', { class: 'hint', style: { marginBottom: '8px' } },
      'Limit this target to a role and/or one or more heroes — leave as “Any role” with no heroes to apply to the whole match. Out-of-scope matches don’t grade or offer this target.'),
    roleHost,
    h('div', { style: { marginTop: '8px' } }, heroHost),
  );
}

/** One of the three Hit/Partial/Missed grading swatches previewed under a self-graded target. */
function gradeChip(label: string, color: string): HTMLElement {
  return h('div', { style: { flex: '1', textAlign: 'center', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: 'var(--surface-3)', color } }, label);
}
