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
import type { MatchMental, MatchRow, PendingMatch, Result, TargetGrade, TargetSummary } from '../../../src/shared/contract';
import { parseMeasuredRule } from '../../../src/core/targets';
import { relTime, roleLabel } from '../format';
import { badge, button, card, emptyState, resultPill } from '../components/primitives';
import { targetGradeRow, mentalFlagsRow } from '../components/reviewControls';
import { performanceSlider } from '../components/performanceSlider';
import { toast } from '../components/toast';
import { store } from '../store';
import { bridge } from '../bridge';
import { registerShortcut } from '../shortcuts';
import { gradedThisSession } from '../reviews';
import { viewHead, type ViewContext } from './view';

/**
 * Keyboard grading: while a grading card is open on the Review screen, H/P/M
 * grade the focused target (advancing to the next), S saves. The hook is set
 * by the mounted card; the `when` gates keep stale hooks inert.
 */
let kbHook: { el: HTMLElement; grade: (g: TargetGrade) => void; save: () => void } | null = null;
const kbActive = (): boolean =>
  store.get().view === 'review' && kbHook !== null && kbHook.el.isConnected;

registerShortcut({ combo: 'h', description: 'Grade focused target: Hit', group: 'Review', when: kbActive, run: () => kbHook?.grade('hit') });
registerShortcut({ combo: 'p', description: 'Grade focused target: Partial', group: 'Review', when: kbActive, run: () => kbHook?.grade('partial') });
registerShortcut({ combo: 'm', description: 'Grade focused target: Missed', group: 'Review', when: kbActive, run: () => kbHook?.grade('missed') });
registerShortcut({ combo: 's', description: 'Save the open review & advance', group: 'Review', when: kbActive, run: () => kbHook?.save() });

export function review(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const active = d.targets.filter((t) => t.isActive && !t.archivedAt);
  const pending = d.reviewInbox.filter((m) => !gradedThisSession.has(m.matchId));
  // No-outcome matches held for manual completion — filtered by the session set
  // so a just-resolved row disappears immediately, before the refetch lands.
  const needsResult = (d.pendingMatches ?? []).filter((m) => !resolvedThisSession.has(m.matchId));

  const head = viewHead('Review', subtitle(pending.length, needsResult.length));
  const needsResultSection = needsResult.length ? needsResultCard(needsResult) : null;

  if (!pending.length) {
    return h('div', { class: 'view', style: { maxWidth: '760px' } },
      head,
      activeStrip(active),
      needsResultSection,
      card({ variant: 'raised' }, emptyState('All caught up — every tracked game has your read. 🎯', true)),
    );
  }

  return h('div', { class: 'view', style: { maxWidth: '760px' } },
    head,
    activeStrip(active),
    needsResultSection,
    h('div', { class: 'stack', style: { gap: '10px' } }, ...pending.map((m, i) => item(m, active, i === 0))),
  );
}

/** The Review head subtitle, reflecting both the needs-result and grading backlogs. */
function subtitle(gradeCount: number, needsResultCount: number): string {
  const parts: string[] = [];
  if (needsResultCount) parts.push(`${needsResultCount} match${needsResultCount === 1 ? '' : 'es'} need a result set`);
  if (gradeCount) parts.push(`${gradeCount} tracked game${gradeCount === 1 ? '' : 's'} need your read`);
  return parts.length
    ? `${parts.join(' · ')} — grade your targets and flag how it felt`
    : 'Grade your targets and flag how it felt on the games you play';
}

/**
 * Matches resolved in this session, so their row hides on the local re-render
 * before the pending-store refetch arrives (mirrors {@link gradedThisSession}).
 */
const resolvedThisSession = new Set<string>();

/**
 * "Needs result" — competitive matches GEP delivered without a win/loss. Sits
 * ABOVE the grading inbox (rendered even when the inbox is empty). Setting a
 * result runs the held match back through the normal history pipeline.
 */
function needsResultCard(items: PendingMatch[]): HTMLElement {
  return card({ variant: 'raised', class: 'review-needs-result' },
    h('div', { class: 'review-section-label' },
      `Needs result — ${items.length} ranked ${items.length === 1 ? 'match' : 'matches'} ended without a win/loss`),
    h('div', { class: 'stack', style: { gap: '10px', marginTop: '10px' } }, ...items.map(needsResultRow)),
  );
}

/** One "Needs result" row: the auto badge, the match facts, and W/L/D actions. */
function needsResultRow(m: PendingMatch): HTMLElement {
  const options: Result[] = ['Win', 'Loss', 'Draw'];
  const buttons = options.map((result) =>
    button(result, {
      onClick: () => {
        for (const b of buttons) b.disabled = true;
        void bridge.resolvePendingMatch(m.matchId, result).then(() => {
          resolvedThisSession.add(m.matchId);
          toast(`Result set — ${m.map} · ${result}`);
          store.rerender();
          void store.refresh();
        });
      },
    }));
  return h('div', { class: 'review-row' },
    h('span', { class: 'review-auto', title: 'auto-detected — no result reported' }, '⚡'),
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, m.map),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
        `${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    h('div', { style: { display: 'flex', gap: '6px' } }, ...buttons),
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
  // Seed from any already-stored rating (mirrors the match-detail editor) so an
  // imported / previously-rated game shows its value here instead of "Not rated".
  let performance: number | undefined = m.performance;

  // Self-rated targets are hand-graded here; measured targets are auto-graded
  // from stats and shown read-only (keyboard grading cycles the self-rated only).
  const selfTargets = active.filter((t) => t.mode !== 'measured');
  const measuredTargets = active.filter((t) => t.mode === 'measured');
  const rows = selfTargets.map((t) => targetGradeRow(t, undefined, (g) => { grades[t.id] = g; }));
  const targetEls = [...rows.map((r) => r.el), ...measuredTargets.map((t) => measuredResultRow(t, m.measuredGrades?.[t.id]))];
  let focusIdx = 0;
  const markFocus = (): void => {
    rows.forEach((r, i) => r.el.classList.toggle('is-focused', i === focusIdx));
  };
  markFocus();

  const doSave = (): void => {
    void bridge.saveReview({ matchId: m.matchId, grades, flags, ...(performance != null ? { performance } : {}) }).then(() => {
      gradedThisSession.add(m.matchId);
      kbHook = null;
      onSaved();
      // Saving is reversible — Undo removes the review and re-opens the inbox slot.
      toast(`Review saved — ${m.map}`, {
        action: {
          label: 'Undo',
          run: () => void bridge.clearReview(m.matchId).then(() => {
            gradedThisSession.delete(m.matchId);
            store.rerender();
          }),
        },
      });
    });
  };

  const el = card({ variant: 'raised', class: 'review-card' },
    h('div', { class: 'review-card-head' },
      h('span', { class: 'badge badge--auto' }, '⚡ auto'),
      resultPill(m.result),
      h('span', { style: { fontSize: '13.5px', fontWeight: '600' } }, m.map),
      h('span', { class: 'u-dim', style: { fontSize: '12px' } },
        `· ${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    section('Your active targets', h('div', { class: 'stack', style: { gap: '11px' } },
      ...(targetEls.length
        ? targetEls
        : [h('div', { class: 'hint' }, 'No active targets yet — add some on the Targets page to grade them here.')]),
    )),
    section('◎ How it felt', mentalFlagsRow(flags)),
    section('◎ How you played', performanceSlider(performance, (v) => { performance = v; })),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '15px', alignItems: 'center' } },
      button('Save & next', { variant: 'primary', onClick: doSave }),
      button('Skip', { variant: 'ghost', onClick: onSkip }),
      h('span', { class: 'u-dim', style: { fontSize: '10.5px', marginLeft: 'auto' } }, 'keys: H / P / M grade · S saves'),
    ),
  );

  kbHook = {
    el,
    grade: (g) => {
      const row = rows[focusIdx];
      if (!row) return;
      row.set(g);
      if (focusIdx < rows.length - 1) focusIdx++;
      markFocus();
    },
    save: doSave,
  };
  return el;
}

function section(label: string, body: Node): HTMLElement {
  return h('div', { class: 'review-section' },
    h('div', { class: 'review-section-label' }, label),
    body,
  );
}

/** A measured (⚡) target's auto-grade for this match, shown read-only — no manual control. */
function measuredResultRow(
  t: TargetSummary,
  res: { grade: TargetGrade; value: number } | 'no-stat' | undefined,
): HTMLElement {
  const parsed = parseMeasuredRule(t.rule);
  const unit = parsed ? (parsed.stat === 'KDA' ? 'KDA' : `${parsed.stat}/10`) : '';
  const body = res && res !== 'no-stat'
    ? `⚡ ${gradeLabel(res.grade)} — ${unit} = ${res.value.toLocaleString('en-US')}`
    : '⚡ no stat this match';
  return h('div', { class: 'review-target' },
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, t.name),
      h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
    ),
    h('div', { class: 'u-muted', style: { fontSize: '12px', whiteSpace: 'nowrap' } }, body),
  );
}

function gradeLabel(g: TargetGrade): string {
  return g === 'hit' ? 'Hit' : g === 'partial' ? 'Partial' : 'Missed';
}
