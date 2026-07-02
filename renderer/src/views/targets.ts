/** Improvement Target — the flexible builder plus your tracked library. */
import { h, render } from '../dom';
import type { TargetSummary } from '../../../src/shared/contract';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { sparkline } from '../charts/plots';
import { badge, button, card, segmented, select } from '../components/primitives';
import { bridge } from '../bridge';
import { viewHead, type ViewContext } from './view';

type Mode = 'self' | 'measured';
type Scope = 'match' | 'season';

const STATS = ['Deaths', 'Eliminations', 'Assists', 'Damage', 'Healing', 'Mitigation', 'KDA'];
const OPS = ['≤', '≥', '='];

export function targets(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    viewHead('Improvement Target', 'Self-rated by default, measurable if you want — pick per target'),
    builderCard(ctx),
    libraryCard(ctx.data.targets),
  );
}

interface BuilderState {
  name: string;
  mode: Mode;
  scope: Scope;
  saved: boolean;
  stat: string;
  op: string;
  value: string;
}

function builderCard(ctx: ViewContext): HTMLElement {
  const state: BuilderState = {
    name: 'Trade before you die',
    mode: 'self',
    scope: 'season',
    saved: false,
    stat: 'Deaths',
    op: '≤',
    value: '4',
  };
  const gradeBlock = h('div');
  const footer = h('div');
  const dirty = () => { state.saved = false; drawFooter(); };

  const drawGrade = (): void => {
    render(gradeBlock, state.mode === 'self' ? selfBlock() : measuredBlock(state, dirty));
  };

  const save = (): void => {
    const rule = state.mode === 'self' ? 'You grade it' : `${state.stat} ${state.op} ${state.value}`;
    void bridge
      .saveTarget({ name: state.name.trim() || 'Untitled target', mode: state.mode, scope: state.scope, rule })
      .then(() => {
        state.saved = true;
        drawFooter();
        ctx.refresh(); // re-pull so the new target appears in the library below
      });
  };

  const drawFooter = (): void => {
    render(footer,
      state.saved
        ? h('div', { class: 'pill is-accent', style: { padding: '10px 14px' } }, '✓ Saved to your library')
        : h('div', { style: { display: 'flex', gap: '10px' } },
            button('Save to library', { variant: 'primary', class: 'btn--block', onClick: save }),
            button('Cancel', { class: 'btn--ghost' }),
          ),
    );
  };

  const nameInput = h('input', {
    class: 'target-name-input',
    value: state.name,
    placeholder: 'e.g. Trade before you die',
    on: { input: (e) => { state.name = (e.target as HTMLInputElement).value; dirty(); } },
  });

  drawGrade();
  drawFooter();

  return card({ variant: 'raised', title: 'Define a target', sub: 'Make it yours' },
    h('div', { class: 'field-label' }, 'Name your focus'),
    nameInput,
    h('div', { class: 'field-label', style: { marginTop: '16px' } }, "How it's graded"),
    segmented<Mode>({
      fill: true,
      value: state.mode,
      options: [{ value: 'self', label: '◎ Self-rated' }, { value: 'measured', label: '⚡ Measured' }],
      onChange: (v) => { state.mode = v; dirty(); drawGrade(); },
    }),
    h('div', { style: { marginTop: '12px' } }, gradeBlock),
    h('div', { class: 'field-label', style: { marginTop: '16px' } }, 'Scope'),
    segmented<Scope>({
      fill: true,
      value: state.scope,
      options: [{ value: 'match', label: 'This match' }, { value: 'season', label: 'Season focus · tracked' }],
      onChange: (v) => { state.scope = v; dirty(); },
    }),
    h('div', { style: { marginTop: '16px' } }, footer),
  );
}

function selfBlock(): HTMLElement {
  return h('div', { class: 'card', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '9px' } }, 'You judge it after the game. No stats needed.'),
    h('div', { style: { display: 'flex', gap: '7px' } },
      gradeChip('Hit', PALETTE.winText), gradeChip('Partial', PALETTE.mid), gradeChip('Missed', PALETTE.lossText)),
  );
}

function measuredBlock(state: BuilderState, onChange: () => void): HTMLElement {
  const preview = h('span', { class: 'badge badge--auto' }, 'auto-grade Hit');
  return h('div', { class: 'card' },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '10px' } }, 'Bind it to a stat and auto-grade:'),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      select(STATS.map((s) => ({ value: s, label: s })), state.stat, (v) => { state.stat = v; onChange(); }),
      select(OPS.map((o) => ({ value: o, label: o })), state.op, (v) => { state.op = v; onChange(); }),
      h('input', {
        class: 'vt-num', type: 'number', value: state.value, 'aria-label': 'threshold',
        on: { input: (e) => { state.value = (e.target as HTMLInputElement).value; onChange(); } },
      }),
      h('span', { class: 'u-muted' }, '→'),
      preview,
    ),
    h('div', { class: 'hint', style: { lineHeight: '1.5', marginTop: '10px' } },
      'Reads end-of-match stats when Overwatch exposes them — otherwise type the number yourself. Works for anyone, even if they never look at stats.'),
  );
}

function libraryCard(list: TargetSummary[]): HTMLElement {
  return card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
    ...list.map(targetRow),
  );
}

function targetRow(t: TargetSummary): HTMLElement {
  const accent = t.mode === 'measured' ? PALETTE.win : PALETTE.accent;
  return h('div', { class: 'target-row' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      h('div', { class: 'row-main' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { class: 'row-name', style: { flex: '0 1 auto', minWidth: '0', fontSize: '13.5px' } }, t.name),
          badge(t.mode === 'measured' ? 'Measured' : 'Self-rated', t.mode === 'measured' ? 'auto' : 'manual'),
        ),
        h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '3px' } }, t.rule),
      ),
      sparkline(t.spark, { width: 150, height: 34, color: accent, fill: true }),
      h('div', { style: { textAlign: 'right', width: '56px', flex: '0 0 auto' } },
        h('div', { class: 'mono', style: { fontSize: '16px', fontWeight: '600' } }, t.attempts ? pct(t.hitRate) : 'New'),
        h('div', { class: 'u-dim', style: { fontSize: '10px' } }, `${t.hits} / ${t.attempts}`),
      ),
    ),
    winSplit('win when hit', t.winWhenHit, PALETTE.win, PALETTE.winText),
    winSplit('when missed', t.winWhenMissed, 'rgba(255,255,255,0.16)', PALETTE.muted),
  );
}

function winSplit(label: string, frac: number, barColor: string, textColor: string): HTMLElement {
  const fill = h('div', { class: 'track-fill', style: { width: `${Math.round(frac * 100)}%`, background: barColor } });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
    h('span', { style: { fontSize: '10px', color: 'var(--muted-2)', width: '82px', flex: '0 0 auto' } }, label),
    h('div', { class: 'track track--slim' }, fill),
    h('span', { class: 'mono', style: { fontSize: '10.5px', color: textColor, width: '30px', textAlign: 'right', flex: '0 0 auto' } }, pct(frac)),
  );
}

function gradeChip(label: string, color: string): HTMLElement {
  return h('div', { style: { flex: '1', textAlign: 'center', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: 'var(--surface-3)', color } }, label);
}
