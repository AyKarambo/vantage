/**
 * Improvement Target builder — the flexible creation/edit surface. Doubles as
 * the edit surface (a library row's Edit re-opens it pre-filled via `BuilderHandle.edit`).
 */
import { h, render } from '../../dom';
import type { HeroEntry, Role, TargetMode, TargetSummary } from '../../../../src/shared/contract';
import { TARGET_TEMPLATES, stepFor, parseMeasuredRule } from '../../../../src/core/targets';
import { roleOfHero } from '../../../../src/core/heroes';
import { PALETTE } from '../../theme';
import { badge, button, card, segmented, select } from '../../components/primitives';
import { attachStepper } from '../../components/wheelStepper';
import { paintHeroChips } from '../../components/heroPicker';
import { roleIcon } from '../../components/roleIcon';
import { bridge } from '../../bridge';
import type { ViewContext } from '../view';

export const STATS = ['Deaths', 'Eliminations', 'Assists', 'Damage', 'Healing', 'Mitigation', 'KDA'];
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
  /** Measured-target scope (D). Undefined = "Any" (evaluate over the whole match). */
  roleScope?: Role;
  heroScope?: string;
}

export interface BuilderHandle {
  el: HTMLElement;
  /** Load an existing target into the builder (edit mode). */
  edit: (t: TargetSummary) => void;
  /** Load a template (or a Focus quick-create) into the builder — always
   *  creates on save, even if the builder was mid-edit (AC 1–2). */
  prefill: (t: { name: string; mode: TargetMode; rule: string }) => void;
}

// NOTE: save()'s rule template (`${stat} ${op} ${value}`) and loadRule()'s
// `parseMeasuredRule` (shared with core scoring/auto-grading) are the two halves
// of one round-trip — the format is owned by `src/core/targets/measured.ts` so it
// cannot drift between writing, reading, and auto-grading.
export function builderCard(ctx: ViewContext): BuilderHandle {
  const state: BuilderState = {
    editingId: null,
    name: 'Trade before you die',
    mode: 'self',
    saved: false,
    stat: 'Deaths',
    op: '≤',
    value: '4',
    roleScope: undefined,
    heroScope: undefined,
  };
  const host = h('div');

  // Templates help you start; once you have your own set (≥3 live authored
  // targets) they collapse behind a "Show templates" toggle. Sample/demo rows
  // aren't "your set", so they don't count.
  const liveAuthored = ctx.data.isSample ? 0 : ctx.data.targets.filter((t) => !t.archivedAt).length;
  let templatesOpen = liveAuthored < 3;

  const save = (): void => {
    const name = state.name.trim() || 'Untitled target';
    const rule = state.mode === 'self' ? 'You grade it' : `${state.stat} ${state.op} ${state.value}`;
    // Scope only applies to measured targets; a self-rated save sends no scope,
    // which the store treats as "clear any previously-saved scope".
    const scope = state.mode === 'measured'
      ? { roleScope: state.roleScope, heroScope: state.heroScope }
      : {};
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
    const gradeBlock = h('div');
    const footer = h('div');
    const dirty = (): void => { state.saved = false; drawFooter(); };

    const drawGrade = (): void => {
      render(gradeBlock, state.mode === 'self' ? selfBlock() : measuredBlock(state, ctx.data.masterData.heroes, dirty));
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
      templatesRegion(),
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
          // Switching to self-rated hides + clears the measured-only scope.
          if (v === 'self') { state.roleScope = undefined; state.heroScope = undefined; }
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
  const loadRule = (t: { name: string; mode: TargetMode; rule: string; roleScope?: Role; heroScope?: string }): void => {
    state.name = t.name;
    state.mode = t.mode;
    state.saved = false;
    // Round-trip the measured scope on edit; templates carry none, so they clear it.
    state.roleScope = t.mode === 'measured' ? t.roleScope : undefined;
    state.heroScope = t.mode === 'measured' ? t.heroScope : undefined;
    const rule = parseMeasuredRule(t.rule);
    if (t.mode === 'measured' && rule) {
      state.stat = rule.stat;
      state.op = rule.op;
      state.value = String(rule.value);
    }
  };

  const edit = (t: TargetSummary): void => {
    state.editingId = t.id;
    loadRule(t);
    draw();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const prefill = (t: { name: string; mode: TargetMode; rule: string }): void => {
    // Always creates on save — abandon any in-progress edit (AC 2).
    state.editingId = null;
    loadRule(t);
    draw();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // The "Start from a template" section: expanded until the player has their own
  // set, then collapsed behind a toggle (local state only, no store round-trip).
  const templatesRegion = (): HTMLElement => {
    if (!templatesOpen) {
      return h('div', { style: { marginBottom: '16px' } },
        h('button', {
          class: 'chip',
          title: 'Browse the starter templates again',
          on: { click: () => { templatesOpen = true; draw(); } },
        }, 'Show templates'));
    }
    return h('div', { style: { marginBottom: '16px' } },
      h('div', { class: 'field-label' }, 'Start from a template'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
        ...TARGET_TEMPLATES.map((t) =>
          h('button', { class: 'chip', title: t.blurb, on: { click: () => prefill(t) } }, t.name),
        ),
        // A hide affordance only makes sense once there's a set to fall back on.
        liveAuthored >= 3
          ? h('button', {
              class: 'chip u-dim',
              title: 'Hide the starter templates',
              on: { click: () => { templatesOpen = false; draw(); } },
            }, 'Hide')
          : null,
      ),
    );
  };

  draw();
  return { el: host, edit, prefill };
}

export function selfBlock(): HTMLElement {
  return h('div', { class: 'card', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '9px' } }, 'You judge it after the game. No stats needed.'),
    h('div', { style: { display: 'flex', gap: '7px' } },
      gradeChip('Hit', PALETTE.winText), gradeChip('Partial', PALETTE.mid), gradeChip('Missed', PALETTE.lossText)),
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

export function measuredBlock(state: BuilderState, heroes: HeroEntry[], onChange: () => void): HTMLElement {
  const preview = badge(previewText(state), 'auto');
  const update = (): void => { preview.textContent = previewText(state); onChange(); };

  const numInput = h('input', {
    class: 'vt-num', type: 'number', min: '0', step: String(stepFor(state.stat)),
    value: state.value, 'aria-label': 'threshold',
    on: { input: (e) => { state.value = (e.target as HTMLInputElement).value; update(); } },
  }) as HTMLInputElement;
  // Wheel + Shift-coarse adjust; the step is read live so it tracks the stat.
  attachStepper(numInput, { step: () => stepFor(state.stat), onChange: (v) => { state.value = v; update(); } });

  const statSelect = select(STATS.map((s) => ({ value: s, label: s })), state.stat, (v) => {
    state.stat = v;
    numInput.step = String(stepFor(v)); // keep arrow-key/spinner step in sync with the stat
    update();
  });

  // --- Scope (D): restrict auto-grading to a role and/or a single hero. ---
  const heroHost = h('div');
  const heroSelected = new Set<string>(state.heroScope ? [state.heroScope] : []);
  const paintHeroes = (): void => {
    // "Any role" (undefined) → the full hero list (openQ shows everyone); a
    // specific role filters the grid to that role's heroes.
    paintHeroChips(heroHost, heroSelected, state.roleScope ?? 'openQ', heroes, { search: true });
  };
  // The picker is a multi-select, but a target's scope is a single hero. The
  // chip toggles `heroSelected` in place on the target phase; here (bubble phase)
  // we enforce single-select — prune the set to the just-toggled hero and clear
  // the `is-on` class off any other chip WITHOUT a repaint, so typed search text
  // survives selecting a hero.
  heroHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.chip') as HTMLElement | null;
    if (!btn || !heroHost.contains(btn)) return;
    const name = btn.textContent ?? '';
    if (heroSelected.has(name)) {
      for (const other of [...heroSelected]) if (other !== name) heroSelected.delete(other);
      heroHost.querySelectorAll('button.chip.is-on').forEach((c) => { if (c !== btn) c.classList.remove('is-on'); });
      state.heroScope = name;
    } else {
      state.heroScope = undefined;
    }
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
        // A specific role the scoped hero doesn't belong to would make an
        // unsatisfiable role AND hero filter (the target could never grade any
        // match) — drop the now-off-role hero so the scope stays gradable.
        if (state.roleScope && state.heroScope && roleOfHero(state.heroScope) !== state.roleScope) {
          state.heroScope = undefined;
          heroSelected.clear();
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
    h('div', { class: 'field-label', style: { marginTop: '14px' } }, 'Scope (optional)'),
    h('div', { class: 'hint', style: { marginBottom: '8px' } },
      'Limit auto-grading to a role and/or a single hero — leave as “Any role” with no hero to grade over the whole match. Matches with no in-scope hero are skipped.'),
    roleHost,
    h('div', { style: { marginTop: '8px' } }, heroHost),
  );
}

/** One of the three Hit/Partial/Missed grading swatches previewed under a self-graded target. */
function gradeChip(label: string, color: string): HTMLElement {
  return h('div', { style: { flex: '1', textAlign: 'center', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: 'var(--surface-3)', color } }, label);
}
