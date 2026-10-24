/**
 * "What did you work on this game?" (issue #321) — the practice-mode target
 * block shared by the Review card and the Log Match card. The player picks the
 * self-rated target(s) they actually practised; only those get a Hit / Partial
 * / Missed row, so a parked target is neither an attempt nor a miss. One
 * target per game is the default (a click swaps the choice); "+ another
 * target" allows a second one, with a hint that one works best. "Nothing
 * specific" is a deliberate read of its own (`focusIds()` → `[]`).
 *
 * Mutates the caller-owned `grades` object like {@link ./reviewControls
 * targetGradeRow} does, and drops a target's grade the moment it's unchosen.
 */
import { h, render } from '../dom';
import type { FocusStickiness, TargetGrade, TargetSummary } from '../../../src/shared/contract';
import { segmented } from './primitives';
import { targetGradeRow } from './reviewControls';

export interface FocusChooser {
  el: HTMLElement;
  /** The grade rows of the chosen targets, in chip order — the keyboard hook grades these. */
  rows(): Array<{ el: HTMLElement; set: (g: TargetGrade) => void }>;
  /** The chosen targets; `[]` = "Nothing specific"; `undefined` = no choice made at all. */
  focusIds(): string[] | undefined;
  /** Toggle the n-th target chip (0-based) — the 1–9 keyboard shortcut. */
  toggle(index: number): void;
}

const STICKINESS: Array<{ value: FocusStickiness; label: string }> = [
  { value: 'game', label: 'this game' },
  { value: 'sitting', label: 'this sitting' },
  { value: 'sticky', label: 'until I change it' },
];

export function focusTargetChooser(o: {
  /** Active, in-scope, self-rated targets. */
  targets: TargetSummary[];
  /** Pre-selected target ids (stickiness / check-in), already narrowed to `targets`. */
  initial: string[];
  grades: Record<string, TargetGrade>;
  stickiness: FocusStickiness;
  onStickiness: (s: FocusStickiness) => void;
  /** Called whenever the set of grade rows changes, so a keyboard focus index can reset. */
  onRowsChanged?: () => void;
  scopeBadge?: (t: TargetSummary) => Node | null;
}): FocusChooser {
  const ids = new Set(o.targets.map((t) => t.id));
  const selected = new Set(o.initial.filter((id) => ids.has(id)));
  // A lone active target is the obvious choice — pre-pick it rather than
  // making the player confirm the only option there is.
  if (!selected.size && o.targets.length === 1) selected.add(o.targets[0].id);
  let nothing = false;
  let multi = selected.size > 1;
  let rowList: Array<{ el: HTMLElement; set: (g: TargetGrade) => void }> = [];

  const chipsHost = h('div', { class: 'focus-chooser-chips', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const hintHost = h('div', { class: 'hint' });
  const rowsHost = h('div', { class: 'stack', style: { gap: '11px' } });

  const choose = (id: string): void => {
    nothing = false;
    if (selected.has(id)) {
      selected.delete(id);
      delete o.grades[id];
    } else {
      if (!multi) {
        for (const other of selected) delete o.grades[other];
        selected.clear();
      }
      selected.add(id);
    }
    paint();
  };

  const paint = (): void => {
    const chip = (label: string, on: boolean, onClick: () => void, title?: string, extraClass = ''): HTMLElement => {
      const b = h('button', { class: `chip${on ? ' is-on' : ''}${extraClass}`, title }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    render(chipsHost,
      ...o.targets.map((t, i) => chip(t.name, selected.has(t.id), () => choose(t.id), `${t.rule} · key ${i + 1}`)),
      chip('Nothing specific', nothing, () => {
        nothing = !nothing;
        if (nothing) {
          for (const id of selected) delete o.grades[id];
          selected.clear();
        }
        paint();
      }, 'Not practising a target this game — no target is graded or counted'),
      o.targets.length > 1
        ? chip(multi ? 'One target' : '+ another target', false, () => { multi = !multi; paint(); },
            multi ? 'Back to one target per game' : 'Work on a second target this game', ' chip--dashed')
        : null,
    );
    render(hintHost, multi
      ? 'Several targets are allowed — but one per game works best.'
      : 'One target per game works best. Unchosen targets aren’t graded and don’t count as a miss.');
    rowList = o.targets
      .filter((t) => selected.has(t.id))
      .map((t) => targetGradeRow(t, o.grades[t.id], (g) => { o.grades[t.id] = g; }, o.scopeBadge?.(t) ?? null));
    render(rowsHost, ...rowList.map((r) => r.el));
    o.onRowsChanged?.();
  };

  const el = h('div', { class: 'stack', style: { gap: '9px' } },
    chipsHost,
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { class: 'hint' }, 'Keep this choice for'),
      segmented({ options: STICKINESS, value: o.stickiness, onChange: o.onStickiness }),
    ),
    hintHost,
    rowsHost,
  );
  paint();

  return {
    el,
    rows: () => rowList,
    focusIds: () => (nothing ? [] : selected.size ? [...selected] : undefined),
    toggle: (index) => { const t = o.targets[index]; if (t) choose(t.id); },
  };
}
