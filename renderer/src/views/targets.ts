/**
 * Improvement Target — the flexible builder plus your tracked library. The
 * builder doubles as the edit surface (row Edit re-opens it pre-filled); library
 * rows carry the lifecycle: Active toggle (graded on Review), Archive/Restore,
 * and permanent Delete behind a confirmation.
 */
import { h, render } from '../dom';
import type { TargetMode, TargetSummary } from '../../../src/shared/contract';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { sparkline } from '../charts/plots';
import { badge, button, card, chip, segmented, select } from '../components/primitives';
import { openModal } from '../components/overlay';
import { bridge } from '../bridge';
import { viewHead, type ViewContext } from './view';

const STATS = ['Deaths', 'Eliminations', 'Assists', 'Damage', 'Healing', 'Mitigation', 'KDA'];
const OPS = ['≤', '≥', '='];

export function targets(ctx: ViewContext): HTMLElement {
  const builder = builderCard(ctx);
  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    viewHead('Improvement Target', 'Self-rated by default, measurable if you want — pick per target'),
    builder.el,
    libraryCard(ctx, builder.edit),
  );
}

interface BuilderState {
  /** Set while editing an existing target — Save then updates instead of creating. */
  editingId: string | null;
  name: string;
  mode: TargetMode;
  saved: boolean;
  stat: string;
  op: string;
  value: string;
}

interface BuilderHandle {
  el: HTMLElement;
  /** Load an existing target into the builder (edit mode). */
  edit: (t: TargetSummary) => void;
}

function builderCard(ctx: ViewContext): BuilderHandle {
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

function selfBlock(): HTMLElement {
  return h('div', { class: 'card', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } },
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '9px' } }, 'You judge it after the game. No stats needed.'),
    h('div', { style: { display: 'flex', gap: '7px' } },
      gradeChip('Hit', PALETTE.winText), gradeChip('Partial', PALETTE.mid), gradeChip('Missed', PALETTE.lossText)),
  );
}

const previewText = (s: BuilderState): string => `Hit when ${s.stat} ${s.op} ${s.value}`;

function measuredBlock(state: BuilderState, onChange: () => void): HTMLElement {
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

function libraryCard(ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
  const live = ctx.data.targets.filter((t) => !t.archivedAt);
  const archived = ctx.data.targets.filter((t) => t.archivedAt);
  return card({ variant: 'raised', title: 'Your targets', sub: 'does it move your winrate?' },
    ...live.map((t) => targetRow(t, ctx, onEdit)),
    archived.length ? archivedSection(archived, ctx) : null,
  );
}

function targetRow(t: TargetSummary, ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
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
    rowActions(t, ctx, onEdit),
  );
}

/** Lifecycle controls: Active = graded on Review; Archive keeps history restorable. */
function rowActions(t: TargetSummary, ctx: ViewContext, onEdit: (t: TargetSummary) => void): HTMLElement {
  const refreshAfter = (p: Promise<void>): void => { void p.then(() => ctx.refresh()); };
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } },
    chip(t.isActive ? '◎ Active on Review' : 'Inactive', t.isActive,
      () => refreshAfter(bridge.setTargetActive(t.id, !t.isActive))),
    h('span', { style: { flex: '1' } }),
    button('Edit', { variant: 'ghost', onClick: () => onEdit(t) }),
    button('Archive', { variant: 'ghost', onClick: () => refreshAfter(bridge.setTargetArchived(t.id, true)) }),
    button('Delete', { variant: 'ghost', onClick: () => confirmDelete(t, ctx) }),
  );
}

function archivedSection(list: TargetSummary[], ctx: ViewContext): HTMLElement {
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' } },
    h('div', { class: 'field-label' }, `Archived (${list.length})`),
    ...list.map((t) =>
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' } },
        h('div', { class: 'row-main', style: { minWidth: '0' } },
          h('div', { class: 'u-muted', style: { fontSize: '13px' } }, t.name),
          h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
        ),
        button('Restore', {
          variant: 'ghost',
          onClick: () => void bridge.setTargetArchived(t.id, false).then(() => ctx.refresh()),
        }),
        button('Delete', { variant: 'ghost', onClick: () => confirmDelete(t, ctx) }),
      ),
    ),
  );
}

function confirmDelete(t: TargetSummary, ctx: ViewContext): void {
  openModal((close) =>
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, `Delete "${t.name}"?`),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        'This permanently removes the target from your library and its stats stop counting. Grades already saved on match reviews stay stored but inert. Archive instead if you might want it back.'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Delete permanently', {
          variant: 'primary',
          onClick: () => void bridge.deleteTarget(t.id).then(() => { close(); ctx.refresh(); }),
        }),
        button('Keep it', { variant: 'ghost', onClick: close }),
      ),
    ),
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
