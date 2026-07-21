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
import { classifyGameType } from '../../../src/core/matchFilter';
import { relTime, roleLabel } from '../format';
import { badge, button, card, confirmButton, emptyState, resultPill } from '../components/primitives';
import { targetGradeRow, mentalFlagsRow } from '../components/reviewControls';
import { srDeltaInput, suggestedSrDelta } from '../components/srControls';
import { performanceSlider } from '../components/performanceSlider';
import { toast } from '../components/toast';
import { store } from '../store';
import { bridge } from '../bridge';
import { registerShortcut } from '../shortcuts';
import { gradedThisSession } from '../reviews';
import { deleteMatch } from '../matchActions';
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
  if (needsResultCount) parts.push(`${needsResultCount} match${needsResultCount === 1 ? '' : 'es'} to confirm or dismiss`);
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
 * "Needs review" — played matches GEP didn't confirm as clean trackable games:
 * no win/loss, an unknown/missing game_type (e.g. after an account swap), or
 * both. Rather than silently drop a possibly-real match, Vantage holds it here
 * for the user to curate. Sits ABOVE the grading inbox (rendered even when the
 * inbox is empty). Setting a result runs the held match back through the normal
 * history pipeline; dismissing drops it without ever logging it.
 */
function needsResultCard(items: PendingMatch[]): HTMLElement {
  return card({ variant: 'raised', class: 'review-needs-result' },
    h('div', { class: 'review-section-label' },
      `Needs review — ${items.length} ${items.length === 1 ? 'match' : 'matches'} GEP didn’t confirm`),
    h('div', { class: 'hint', style: { marginTop: '-6px', marginBottom: '4px' } },
      'Set a result to track it, or dismiss if it wasn’t a real match.'),
    h('div', { class: 'stack', style: { gap: '10px', marginTop: '10px' } }, ...items.map(needsResultRow)),
  );
}

/** GEP's own outcome vocabulary, for the "GEP: …" reported-result hint chip. */
const GEP_RESULT_LABEL: Record<Result, string> = { Win: 'Victory', Loss: 'Defeat', Draw: 'Draw' };

/**
 * One "Needs review" row: the auto badge, the match facts, an optional
 * GEP-reported-result hint, the W/L/D confirm buttons (the reported result
 * pre-highlighted for a one-click confirm), and a subtle Dismiss action.
 */
function needsResultRow(m: PendingMatch): HTMLElement {
  const options: Result[] = ['Win', 'Loss', 'Draw'];
  const actions: HTMLButtonElement[] = [];
  const disableAll = (): void => { for (const b of actions) b.disabled = true; };
  const buttons = options.map((result) =>
    button(result, {
      // Pre-highlight the result GEP actually reported (when it did) so a match
      // that HAS a result is one click to confirm.
      variant: m.reportedResult === result ? 'soft' : 'default',
      onClick: () => {
        disableAll();
        void bridge.resolvePendingMatch(m.matchId, result).then(() => {
          resolvedThisSession.add(m.matchId);
          toast(`Result set — ${m.map} · ${result}`);
          store.rerender();
          void store.refresh();
        });
      },
    }));
  const dismiss = button('Not a real match', {
    variant: 'ghost',
    class: 'review-dismiss',
    title: 'Discard this match — it won’t be tracked',
    onClick: () => {
      disableAll();
      void bridge.dismissPendingMatch(m.matchId).then(() => {
        // Reuse the resolved-this-session set so the row hides immediately,
        // before the pending-store refetch lands.
        resolvedThisSession.add(m.matchId);
        toast(`Dismissed — ${m.map}`);
        store.rerender();
        void store.refresh();
      });
    },
  });
  actions.push(...buttons, dismiss);
  return h('div', { class: 'review-row' },
    h('span', { class: 'review-auto', title: 'auto-detected — GEP didn’t confirm a result' }, '⚡'),
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, m.map),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
        `${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    m.reportedResult
      ? h('span', { class: 'pill is-accent', title: 'the result GEP reported', style: { whiteSpace: 'nowrap' } },
          `GEP: ${GEP_RESULT_LABEL[m.reportedResult]}`)
      : null,
    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, ...buttons, dismiss),
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
  // Manual SR % — only offered for competitive games (GEP can't report it). Seeds
  // from any stored delta, else a suggested ±25 (Win/Loss) the player fine-tunes
  // with the wheel; blank clears it.
  const isComp = classifyGameType(m.gameType) === 'competitive';
  let srText = m.srDelta != null
    ? String(m.srDelta)
    : (isComp && m.result !== 'Draw' ? suggestedSrDelta(m.result) : '');

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
    // Send the SR % only for competitive matches and only when the field parses
    // to a finite number. The field pre-fills a suggested ±25, so saving records
    // it unless the player clears the field (blank leaves the stored SR unchanged).
    const t = srText.trim();
    let srDelta: number | undefined;
    if (isComp && t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) srDelta = n;
    }
    void bridge.saveReview({
      matchId: m.matchId, grades, flags,
      ...(performance != null ? { performance } : {}),
      ...(srDelta !== undefined ? { srDelta } : {}),
    }).then(() => {
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
    // Competitive only — GEP can't report SR, so the player enters what the game
    // showed. Blank = leave unchanged (mirrors the W/L/D backfill just above).
    isComp
      ? section('◎ SR change (%)', h('div', { class: 'stack', style: { gap: '6px' } },
          srDeltaInput(srText, (v) => { srText = v; }),
          h('div', { class: 'hint' }, "the % the game showed (e.g. +22 or −19) — GEP can't report this"),
        ))
      : null,
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '15px', alignItems: 'center' } },
      button('Save & next', { variant: 'primary', onClick: doSave }),
      button('Skip', { variant: 'ghost', onClick: onSkip }),
      h('span', { class: 'u-dim', style: { fontSize: '10.5px', marginLeft: 'auto' } }, 'keys: H / P / M grade · S saves'),
      // Deliberately NOT labelled "Not a real match" — the pending rows above
      // carry that label for a match that never entered history, and this one
      // destroys a recorded game. Same words on one screen for two very
      // different blast radii would teach the wrong reflex.
      confirmButton({
        label: 'Delete match',
        confirmLabel: 'Delete permanently?',
        variant: 'ghost',
        title: 'Delete this match from your history',
        confirmTitle: `Permanently deletes your ${m.map} ${m.result.toLowerCase()} — this can't be undone`,
        onConfirm: (reset) => {
          // Only drop the keyboard hook if it still points at THIS card. It is
          // module-level and last-writer-wins, so a second expanded card would
          // otherwise lose H/P/M/S when this one is deleted.
          if (kbHook?.el === el) kbHook = null;
          void deleteMatch(m, reset);
        },
      }),
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
