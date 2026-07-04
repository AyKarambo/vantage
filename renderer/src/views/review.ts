/**
 * Review — the home for the manual (◎) layer. Auto-tracking removes the "I'm
 * logging this game" moment, so finished games land here needing your read: grade
 * your active targets (Hit / Partial / Missed) and flag how it felt. The auto (⚡)
 * facts are read-only; you only add what the app can't see.
 *
 * The inbox renders from `d.reviewInbox` — always unfiltered, so narrowing the
 * global range never hides an ungraded game. Saves go through the bridge and only
 * re-render locally (no refetch); `gradedThisSession` keeps the list honest.
 */
import { h, render } from '../dom';
import type { MatchMental, MatchRow, TargetGrade, TargetSummary } from '../../../src/shared/contract';
import { relTime, roleLabel } from '../format';
import { badge, button, card, emptyState, resultPill } from '../components/primitives';
import { store } from '../store';
import { bridge } from '../bridge';
import { gradedThisSession } from '../reviews';
import { viewHead, type ViewContext } from './view';

export function review(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const active = d.targets.filter((t) => t.isActive && !t.archivedAt);
  const pending = d.reviewInbox.filter((m) => !gradedThisSession.has(m.matchId));

  const head = viewHead(
    'Review',
    pending.length
      ? `${pending.length} tracked game${pending.length === 1 ? '' : 's'} need your read — grade your targets and flag how it felt`
      : 'Grade your targets and flag how it felt on the games you play',
  );

  if (!pending.length) {
    return h('div', { class: 'view', style: { maxWidth: '760px' } },
      head,
      activeStrip(active),
      card({ variant: 'raised' }, emptyState('All caught up — every tracked game has your read. 🎯', true)),
    );
  }

  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    head,
    activeStrip(active),
    h('div', { class: 'stack', style: { gap: '10px' } }, ...pending.map((m, i) => item(m, active, i === 0))),
  );
}

/** Where the targets come from — a reminder that they're set on the Targets page. */
function activeStrip(active: TargetSummary[]): HTMLElement {
  return h('div', { class: 'review-active' },
    h('span', { class: 'u-muted', style: { fontSize: '11.5px' } }, 'Active targets'),
    ...(active.length
      ? active.map((t) => badge(t.name, 'manual'))
      : [h('span', { class: 'u-dim', style: { fontSize: '11.5px' } }, 'none yet — add some on the Targets page')]),
  );
}

/** One inbox entry: a collapsed row that expands into the grading card. */
function item(m: MatchRow, active: TargetSummary[], startOpen: boolean): HTMLElement {
  const host = h('div');
  let open = startOpen;
  const draw = (): void => {
    render(host, open
      ? expanded(m, active, () => store.rerender(), () => { open = false; draw(); })
      : collapsed(m, () => { open = true; draw(); }));
  };
  draw();
  return host;
}

function collapsed(m: MatchRow, onGrade: () => void): HTMLElement {
  return h('div', { class: 'review-row' },
    h('span', { class: 'review-auto', title: 'auto-detected' }, '⚡'),
    resultPill(m.result),
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, m.map),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
        `${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    button('Grade', { onClick: onGrade }),
  );
}

function expanded(m: MatchRow, active: TargetSummary[], onSaved: () => void, onSkip: () => void): HTMLElement {
  const grades: Record<string, TargetGrade> = {};
  const flags: MatchMental = {};

  const targetRows = active.length
    ? active.map((t) => gradeRow(t, (g) => { grades[t.id] = g; }))
    : [h('div', { class: 'hint' }, 'No active targets yet — add some on the Targets page to grade them here.')];

  return card({ variant: 'raised', class: 'review-card' },
    h('div', { class: 'review-card-head' },
      h('span', { class: 'badge badge--auto' }, '⚡ auto'),
      resultPill(m.result),
      h('span', { style: { fontSize: '13.5px', fontWeight: '600' } }, m.map),
      h('span', { class: 'u-dim', style: { fontSize: '12px' } },
        `· ${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    section('◎ Your active targets', h('div', { class: 'stack', style: { gap: '11px' } }, ...targetRows)),
    section('◎ How it felt', h('div', { class: 'review-flags' },
      flagChip('Tilted', flags, 'tilt'),
      flagChip('Good comms', flags, 'positiveComms'),
      flagChip('Toxic mate', flags, 'toxicMates'),
      flagChip('Leaver', flags, 'leaver'),
    )),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '15px', alignItems: 'center' } },
      button('Save & next', {
        variant: 'primary',
        onClick: () => {
          void bridge.saveReview({ matchId: m.matchId, grades, flags }).then(() => {
            gradedThisSession.add(m.matchId);
            onSaved();
          });
        },
      }),
      button('Skip', { variant: 'ghost', onClick: onSkip }),
    ),
  );
}

function section(label: string, body: Node): HTMLElement {
  return h('div', { class: 'review-section' },
    h('div', { class: 'review-section-label' }, label),
    body,
  );
}

function gradeRow(t: TargetSummary, onChange: (g: TargetGrade) => void): HTMLElement {
  return h('div', { class: 'review-target' },
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, t.name),
      h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
    ),
    gradeControl(onChange),
  );
}

const GRADES: Array<{ v: TargetGrade; label: string; bg: string; fg: string }> = [
  { v: 'hit', label: 'Hit', bg: 'rgba(87,166,132,0.18)', fg: 'var(--win-text)' },
  { v: 'partial', label: 'Partial', bg: 'rgba(214,162,79,0.18)', fg: 'var(--mid-text)' },
  { v: 'missed', label: 'Missed', bg: 'rgba(209,104,95,0.16)', fg: 'var(--loss-text)' },
];

/** A 3-way grade control that starts unselected (so it reads as "needs grading"),
 *  using the shared segmented look with a semantic tint on the chosen grade. */
function gradeControl(onChange: (g: TargetGrade) => void): HTMLElement {
  const btns = GRADES.map((o) => h('button', { class: 'segmented-opt' }, o.label));
  GRADES.forEach((o, i) => btns[i].addEventListener('click', () => {
    btns.forEach((b, j) => {
      const on = i === j;
      b.classList.toggle('is-active', on);
      b.style.background = on ? GRADES[j].bg : '';
      b.style.color = on ? GRADES[j].fg : '';
    });
    onChange(o.v);
  }));
  return h('div', { class: 'segmented' }, ...btns);
}

function flagChip(label: string, flags: MatchMental, key: keyof MatchMental): HTMLElement {
  const btn = h('button', {
    class: 'chip',
    on: { click: () => { flags[key] = !flags[key]; btn.classList.toggle('is-on', Boolean(flags[key])); } },
  }, label);
  return btn;
}
