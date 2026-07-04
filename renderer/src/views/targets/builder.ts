/**
 * Improvement Target builder — the flexible creation/edit surface. Doubles as
 * the edit surface (a library row's Edit re-opens it pre-filled via `BuilderHandle.edit`).
 */
import { h, render } from '../../dom';
import type { TargetMode, TargetSummary } from '../../../../src/shared/contract';
import { PALETTE } from '../../theme';
import { badge, button, card, segmented, select } from '../../components/primitives';
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
}

export interface BuilderHandle {
  el: HTMLElement;
  /** Load an existing target into the builder (edit mode). */
  edit: (t: TargetSummary) => void;
}

// NOTE: save()'s rule template (`${stat} ${op} ${value}`) and edit()'s parse regex
// below are two halves of one round-trip — keep them in this file together so the
// rule string format cannot drift between writing and reading it.
export function builderCard(ctx: ViewContext): BuilderHandle {
  const state: BuilderState = {
    editingId: null,
    name: 'Trade before you die',
    mode: 'self',
    saved: false,
    stat: 'Deaths',
    op: '≤',
    value: '4',
  };
  const host = h('div');

  const save = (): void => {
    const name = state.name.trim() || 'Untitled target';
    const rule = state.mode === 'self' ? 'You grade it' : `${state.stat} ${state.op} ${state.value}`;
    const persist = state.editingId
      ? bridge.updateTarget({ id: state.editingId, name, mode: state.mode, rule })
      : bridge.saveTarget({ name, mode: state.mode, rule });
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
      render(gradeBlock, state.mode === 'self' ? selfBlock() : measuredBlock(state, dirty));
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
        onChange: (v) => { state.mode = v; dirty(); drawGrade(); },
      }),
      h('div', { style: { marginTop: '12px' } }, gradeBlock),
      h('div', { style: { marginTop: '16px' } }, footer),
    ));
  };

  const edit = (t: TargetSummary): void => {
    state.editingId = t.id;
    state.name = t.name;
    state.mode = t.mode;
    state.saved = false;
    const rule = t.rule.match(/^(.+) (≤|≥|=) (.+)$/);
    if (t.mode === 'measured' && rule) {
      state.stat = rule[1];
      state.op = rule[2];
      state.value = rule[3].replace(/,/g, '');
    }
    draw();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  draw();
  return { el: host, edit };
}

export function selfBlock(): HTMLElement {
  return h('div', { class: 'card', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '9px' } }, 'You judge it after the game. No stats needed.'),
    h('div', { style: { display: 'flex', gap: '7px' } },
      gradeChip('Hit', PALETTE.winText), gradeChip('Partial', PALETTE.mid), gradeChip('Missed', PALETTE.lossText)),
  );
}

export const previewText = (s: BuilderState): string => `Hit when ${s.stat} ${s.op} ${s.value}`;

export function measuredBlock(state: BuilderState, onChange: () => void): HTMLElement {
  const preview = badge(previewText(state), 'auto');
  const update = (): void => { preview.textContent = previewText(state); onChange(); };
  return h('div', { class: 'card' },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '10px' } }, 'Bind it to a stat and auto-grade:'),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      select(STATS.map((s) => ({ value: s, label: s })), state.stat, (v) => { state.stat = v; update(); }),
      select(OPS.map((o) => ({ value: o, label: o })), state.op, (v) => { state.op = v; update(); }),
      h('input', {
        class: 'vt-num', type: 'number', value: state.value, 'aria-label': 'threshold',
        on: { input: (e) => { state.value = (e.target as HTMLInputElement).value; update(); } },
      }),
      h('span', { class: 'u-muted' }, '→'),
      preview,
    ),
    h('div', { class: 'hint', style: { lineHeight: '1.5', marginTop: '10px' } },
      'Reads end-of-match stats when Overwatch exposes them — otherwise type the number yourself. Works for anyone, even if they never look at stats.'),
  );
}

/** One of the three Hit/Partial/Missed grading swatches previewed under a self-graded target. */
function gradeChip(label: string, color: string): HTMLElement {
  return h('div', { style: { flex: '1', textAlign: 'center', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: 'var(--surface-3)', color } }, label);
}
