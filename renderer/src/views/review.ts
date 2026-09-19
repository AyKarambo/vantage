/**
 * Review — the home for the manual (◎) layer. Auto-tracking removes the "I'm
 * logging this game" moment, so finished games land here needing your read: grade
 * your active targets (Hit / Partial / Missed) and flag how it felt. The auto (⚡)
 * facts are read-only; you only add what the app can't see.
 *
 * The inbox renders from `d.reviewInbox` — always unfiltered, so narrowing the
 * global range never hides an ungraded game. Saves go through the bridge and
 * re-render locally FIRST (so the card responds instantly), then refetch:
 * `gradedThisSession` keeps the list honest across that gap.
 *
 * The refetch is not optional. A review used to be grades + flags only, which
 * nothing outside this screen derived from — so the original design deliberately
 * skipped it to keep the snapshot stable while grading a stack. A review now also
 * records ±SR, the first rank anchor on an unanchored track, and a placement
 * prediction, all of which feed `primaryRank` — the top-left rank chip. Skipping
 * the refetch left that chip showing a pre-save rank until something unrelated
 * happened to refetch (a filter change, a window re-focus, the next tracked
 * match), which is exactly the "rank is always delayed" report.
 */
import { h, render } from '../dom';
import type { MatchMental, MatchRow, PendingMatch, PlacementRunSummary, RankEntryPreview, Result, TargetGrade, TargetSummary } from '../../../src/shared/contract';
import { matchInTargetScope, parseMeasuredRule } from '../../../src/core/targets';
import { classifyGameType } from '../../../src/core/matchFilter';
import { relTime, roleLabel } from '../format';
import { badge, button, card, chip, confirmButton, emptyState, resultPill } from '../components/primitives';
import { targetGradeRow, mentalFlagsRow, quickGradeChip, type BoolFlagKey } from '../components/reviewControls';
import { srDeltaInput, srModeToggle, rankEntry, placementPicker, suggestedSrDelta, type SrMode } from '../components/srControls';
import { performanceSlider } from '../components/performanceSlider';
import { toast } from '../components/toast';
import { openPopover } from '../components/popover';
import { store } from '../store';
import { bridge } from '../bridge';
import { registerShortcut } from '../shortcuts';
import { gradedThisSession } from '../reviews';
import { deleteMatch } from '../matchActions';
import { maybeConfirmPlacementRank } from '../app/placementComplete';
import { maybeOfferPlacements } from '../app/placementOffer';
import { srEntryMode } from '../../../src/core/placements';
import { viewHead, type ViewContext } from './view';

/**
 * Keyboard grading: while a grading card is open on the Review screen, H/P/M
 * grade the focused target (advancing to the next), S saves, N skips to the
 * next pending game (R2), T/X toggle the Tilt / Toxic mates flags. The hook
 * is set by the mounted card; the `when` gates keep stale hooks inert.
 */
let kbHook: {
  el: HTMLElement;
  grade: (g: TargetGrade) => void;
  save: () => void;
  skip: () => void;
  toggleFlag: (key: BoolFlagKey) => void;
} | null = null;
const kbActive = (): boolean =>
  store.get().view === 'review' && kbHook !== null && kbHook.el.isConnected;

registerShortcut({ combo: 'h', description: 'Grade focused target: Hit', group: 'Review', when: kbActive, run: () => kbHook?.grade('hit') });
registerShortcut({ combo: 'p', description: 'Grade focused target: Partial', group: 'Review', when: kbActive, run: () => kbHook?.grade('partial') });
registerShortcut({ combo: 'm', description: 'Grade focused target: Missed', group: 'Review', when: kbActive, run: () => kbHook?.grade('missed') });
registerShortcut({ combo: 's', description: 'Save the open review & advance', group: 'Review', when: kbActive, run: () => kbHook?.save() });
registerShortcut({ combo: 'n', description: 'Skip — leave for later, open the next game', group: 'Review', when: kbActive, run: () => kbHook?.skip() });
registerShortcut({ combo: 't', description: 'Toggle Tilt on the open game', group: 'Review', when: kbActive, run: () => kbHook?.toggleFlag('tilt') });
registerShortcut({ combo: 'x', description: 'Toggle Toxic mates on the open game', group: 'Review', when: kbActive, run: () => kbHook?.toggleFlag('toxicMates') });

export function review(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const active = d.targets.filter((t) => t.isActive && !t.archivedAt);
  const pending = d.reviewInbox.filter((m) => !gradedThisSession.has(m.matchId));
  // The subtitle states the TRUE, uncapped backlog (R1) — `pending.length` is
  // capped at reviewInbox's 150 rows, which would silently understate a
  // deeper backlog. `d.pendingReviews` isn't itself session-adjusted, so the
  // same graded-this-session correction `pending` already applied is redone
  // against it here.
  const totalPending = Math.max(0, d.pendingReviews - (d.reviewInbox.length - pending.length));
  // No-outcome matches held for manual completion — filtered by the session set
  // so a just-resolved row disappears immediately, before the refetch lands.
  const needsResult = (d.pendingMatches ?? []).filter((m) => !resolvedThisSession.has(m.matchId));

  const head = viewHead('Review', subtitle(totalPending, needsResult.length),
    pending.length ? noReadAction(ctx) : undefined);
  const needsResultSection = needsResult.length ? needsResultCard(needsResult) : null;

  if (!pending.length) {
    return h('div', { class: 'view view--narrow' },
      head,
      activeStrip(active),
      needsResultSection,
      card({ variant: 'raised' }, emptyState('All caught up — every tracked game has your read. 🎯', true)),
    );
  }

  // A sibling-aware chain (R2): each item's Skip opens the next pending one
  // and scrolls to it — plain "collapse and hope the player finds the next
  // row" was the opposite of a triage flow.
  const items = pending.map((m, i) => item(m, active, i === 0, d.placements));
  for (let i = 0; i < items.length; i++) items[i].next = items[i + 1] ?? null;

  return h('div', { class: 'view view--narrow' },
    head,
    activeStrip(active),
    needsResultSection,
    h('div', { class: 'stack', style: { gap: '10px' } }, ...items.map((it) => it.host)),
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

/** Age-cutoff choices for {@link noReadAction} — `minAgeDays: 0` means every pending row. */
const NO_READ_AGES: Array<{ label: string; minAgeDays: number }> = [
  { label: 'Older than 1 day', minAgeDays: 1 },
  { label: 'Older than 7 days', minAgeDays: 7 },
  { label: 'All of them', minAgeDays: 0 },
];

/**
 * "Mark older games as no-read" (R1) — the bulk exit from a backlog that
 * would otherwise only shrink one card at a time. The IPC contract and its
 * channel wiring shipped ahead of this button; this is what finally calls it.
 */
function noReadAction(ctx: ViewContext): HTMLElement {
  const btn = button('Mark older as no-read', {
    variant: 'ghost',
    title: 'Bulk-clear old tracked games from this inbox without grading them',
    onClick: () => openNoReadPopover(btn, ctx),
  });
  return btn;
}

function openNoReadPopover(anchor: HTMLElement, ctx: ViewContext): void {
  let minAgeDays = NO_READ_AGES[0].minAgeDays;
  let count: number | null = null;
  let requestId = 0;

  const refreshCount = (repaint: () => void): void => {
    const id = ++requestId;
    count = null;
    repaint();
    void bridge.previewPendingReviewIgnore({ filters: ctx.data.filters, minAgeDays }).then((r) => {
      if (id !== requestId) return; // a newer age selection has since been chosen
      count = r.count;
      repaint();
    });
  };

  openPopover(anchor, (close) => {
    const body = h('div', { class: 'stack', style: { gap: '10px', minWidth: '220px' } });
    const paint = (): void => {
      render(body,
        h('div', { class: 'u-muted', style: { fontSize: '11px' } }, 'Mark older games as no-read'),
        h('div', { class: 'stack', style: { gap: '4px' } },
          ...NO_READ_AGES.map((a) => chip(a.label, a.minAgeDays === minAgeDays, () => {
            minAgeDays = a.minAgeDays;
            refreshCount(paint);
          }))),
        h('div', { class: 'hint' },
          count === null ? 'Counting…' : `This will clear ${count} game${count === 1 ? '' : 's'} from your inbox.`),
        button('Mark as no-read', {
          variant: 'danger',
          disabled: count === null || count === 0,
          onClick: () => {
            close();
            void applyNoRead(ctx, minAgeDays);
          },
        }),
      );
    };
    refreshCount(paint);
    paint();
    return body;
  });
}

/** The actual bulk write + refetch + Undo toast, once the popover confirms. */
async function applyNoRead(ctx: ViewContext, minAgeDays: number): Promise<void> {
  let matchIds: string[];
  try {
    ({ matchIds } = await bridge.ignorePendingReviews({ filters: ctx.data.filters, minAgeDays }));
  } catch (err) {
    toast(`Couldn't clear those games — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  await store.refresh();
  if (!matchIds.length) {
    toast('Nothing to clear — those games were already graded or gone.');
    return;
  }
  toast(
    `Marked ${matchIds.length} game${matchIds.length === 1 ? '' : 's'} as no-read.`,
    {
      ttl: 12_000,
      action: {
        label: 'Undo',
        run: () => {
          void bridge.clearReviews(matchIds).then(() => store.refresh());
        },
      },
    },
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

/** An inbox entry's controller — its host node plus the sibling {@link item} Skip opens next (R2). */
interface ReviewItem {
  host: HTMLElement;
  next: ReviewItem | null;
  open: () => void;
}

/** In-scope, self-rated (hand-graded) targets for a match — measured targets auto-grade and never appear here. Shared by the collapsed quick-grade row and the expanded card so they can't disagree on which targets a game needs. */
function selfTargetsFor(m: MatchRow, active: TargetSummary[]): TargetSummary[] {
  return active.filter((t) => t.mode !== 'measured' && matchInTargetScope(m, t));
}

/**
 * The minimal save behind a collapsed row's quick-grade chips (R2): just the
 * self-rated grades and whatever flags were toggled — SR, performance and
 * placement/rank handling stay behind the full card ("Grade"), which is
 * where a player who needs them already goes. Same toast+Undo as the full
 * save, but no placement-confirm/offer follow-up: quick-grade never touches
 * rank data, so there is nothing new for either of those to react to.
 */
function quickSave(m: MatchRow, grades: Record<string, TargetGrade>, flags: MatchMental, onDone: () => void): void {
  void bridge.saveReview({ matchId: m.matchId, grades, flags }).then(() => {
    gradedThisSession.add(m.matchId);
    onDone();
    toast(`Review saved — ${m.map}`, {
      action: {
        label: 'Undo',
        run: () => void bridge.clearReview(m.matchId).then(() => {
          gradedThisSession.delete(m.matchId);
          store.rerender();
          void store.refresh();
        }),
      },
    });
  });
}

/** One inbox entry: a collapsed row (with inline quick-grade) that expands into the full grading card. */
function item(
  m: MatchRow,
  active: TargetSummary[],
  startOpen: boolean,
  placements: PlacementRunSummary[],
): ReviewItem {
  const host = h('div');
  let open = startOpen;
  const controller: ReviewItem = { host, next: null, open: () => { open = true; draw(); } };
  const skipToNext = (): void => {
    open = false;
    draw();
    // Open the next pending sibling and bring it into view — Skip used to
    // only collapse the current card, leaving the player to scroll down and
    // click "Grade" themselves; "Skip" still means "later", not "graded"
    // (the game stays in the inbox either way).
    if (controller.next) {
      controller.next.open();
      controller.next.host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  // The full card's own "saved" refresh — reused by the collapsed row's
  // quick-grade path too, since a quick-graded game must leave the inbox the
  // same way a fully-graded one does, not just sit there re-collapsed.
  const onSaved = (): void => { store.rerender(); void store.refresh(); };
  const draw = (): void => {
    render(host, open
      ? expanded(m, active, onSaved, skipToNext, placements)
      : collapsed(m, active, () => { open = true; draw(); }, onSaved));
  };
  draw();
  return controller;
}

function collapsed(m: MatchRow, active: TargetSummary[], onOpen: () => void, onGraded: () => void): HTMLElement {
  const selfTargets = selfTargetsFor(m, active);
  const grades: Record<string, TargetGrade> = {};
  const flags: MatchMental = {};
  let saved = false;
  // Fires once every in-scope self-rated target has a grade (R2) — with zero
  // active self-rated targets, toggling Tilt alone is the only interaction
  // there is, so that becomes the trigger instead.
  const maybeSave = (): void => {
    if (saved) return;
    if (selfTargets.length ? Object.keys(grades).length < selfTargets.length : !flags.tilt) return;
    saved = true;
    quickSave(m, grades, flags, onGraded);
  };
  const grid = selfTargets.length
    ? h('div', { class: 'review-quick-grade' },
        ...selfTargets.map((t) => quickGradeChip(t, (g) => { grades[t.id] = g; maybeSave(); })),
        tiltToggle(flags, maybeSave),
      )
    : h('div', { class: 'review-quick-grade' }, tiltToggle(flags, maybeSave));
  return h('div', { class: 'review-row' },
    h('span', { class: 'review-auto', title: 'auto-detected' }, '⚡'),
    resultPill(m.result),
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, m.map),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
        `${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
    ),
    grid,
    button('Grade', { onClick: onOpen }),
  );
}

/** The collapsed row's Tilt toggle (R2) — a plain chip, same visual language as {@link import('../components/reviewControls').mentalFlagChips}'s. */
function tiltToggle(flags: MatchMental, onToggle: () => void): HTMLElement {
  const btn = h('button', { class: 'chip', title: 'Flag this game as tilted' }, 'Tilt');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    flags.tilt = !flags.tilt;
    btn.classList.toggle('is-on', Boolean(flags.tilt));
    onToggle();
  });
  return btn;
}

function expanded(
  m: MatchRow,
  active: TargetSummary[],
  onSaved: () => void,
  onSkip: () => void,
  placements: PlacementRunSummary[],
): HTMLElement {
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
  // Review offers the same Change / Set-current choice as the log card and the
  // match editor — the three surfaces are meant to be interchangeable, which is
  // why srControls exists. Set-current is an input aid: rankEntry translates the
  // picked rank into the ±% and this card submits that, like any other review.
  let srMode: SrMode = 'change';
  let rankPreview: RankEntryPreview | undefined;
  let rankTier = 'Gold';
  let rankDivision = 3;
  let rankPct = '';
  // A COUNTED placement match pre-empts SR entry entirely, exactly as in the log
  // card and the match editor: Overwatch shows no ±% and no rank protection
  // during placements, only a predicted rank after each match.
  //
  // Per MATCH, not per run: this is the auto-tracked (GEP) path, so the inbox
  // routinely holds matches from before the run reached its target alongside
  // ones from after. Match four stays a placement match forever; match eleven
  // never was one, and is the player's only chance to record the ±% the game
  // showed for it — nothing else in the app can capture it later.
  const run = isComp
    ? placements.find((p) => p.account === m.account && p.role === m.role && !p.completed)
    : undefined;
  const mode = srEntryMode(run, m.matchId);
  let predTier = run?.latestPrediction?.tier ?? 'Gold';
  let predDivision = run?.latestPrediction?.division ?? 3;

  // Self-rated targets are hand-graded here; measured targets are auto-graded
  // from stats and shown read-only (keyboard grading cycles the self-rated only).
  // Self-rated targets hide outright when the match is out of scope; measured
  // targets stay visible with their read-only "no stat this match" row.
  const selfTargets = active.filter((t) => t.mode !== 'measured' && matchInTargetScope(m, t));
  const measuredTargets = active.filter((t) => t.mode === 'measured');
  const rows = selfTargets.map((t) => targetGradeRow(t, undefined, (g) => { grades[t.id] = g; }));
  const targetEls = [...rows.map((r) => r.el), ...measuredTargets.map((t) => measuredResultRow(t, m.measuredGrades?.[t.id]))];
  let focusIdx = 0;
  const markFocus = (): void => {
    rows.forEach((r, i) => r.el.classList.toggle('is-focused', i === focusIdx));
  };
  markFocus();

  // Repaints in place on a mode switch, so the card keeps its scroll position
  // and the keyboard grading focus — the same host-plus-paint idiom the log card
  // and the match editor use for their SR block.
  const srHost = h('div', { class: 'stack', style: { gap: '6px' } });
  const paintSr = (): void => {
    if (mode === 'placement' && run) {
      render(srHost,
        placementPicker({
          tier: predTier,
          division: predDivision,
          onTier: (v) => (predTier = v),
          onDivision: (v) => (predDivision = v),
        }),
        h('div', { class: 'hint' },
          `Placements (${run.counted}/${run.target}) for ${roleLabel(m.role)} on ${m.account} — `
          + 'the game shows a predicted rank after each match, no ±% and no rank protection.'));
      return;
    }
    // On the track but outside the counted ten — the run has revealed its rank
    // (or this match predates the run), so the game did show a ±%. Offer the
    // field, but not the "set current rank" toggle: that measures against the
    // track's live anchor, which is still the pre-run one until confirmation.
    if (mode === 'delta-only') {
      render(srHost,
        srDeltaInput(srText, (v) => { srText = v; }),
        h('div', { class: 'hint' },
          'Placements are done on this track — confirm the revealed rank and this ±% starts counting from it.'));
      return;
    }
    const toggle = srModeToggle(srMode, (v) => { srMode = v; paintSr(); });
    if (srMode === 'set-current') {
      render(srHost, toggle,
        rankEntry({
          account: m.account,
          role: m.role,
          timestamp: m.timestamp,
          tier: rankTier,
          division: rankDivision,
          pct: rankPct,
          onTier: (v) => (rankTier = v),
          onDivision: (v) => (rankDivision = v),
          onPct: (v) => (rankPct = v),
          onResolved: (p) => (rankPreview = p),
        }));
      return;
    }
    render(srHost, toggle,
      srDeltaInput(srText, (v) => { srText = v; }),
      h('div', { class: 'hint' }, "the % the game showed (e.g. +22 or −19) — GEP can't report this"));
  };
  const srSection = (): HTMLElement => { paintSr(); return srHost; };

  const doSave = (): void => {
    // Send the SR % only for competitive matches and only when the field parses
    // to a finite number. The field pre-fills a suggested ±25, so saving records
    // it unless the player clears the field (blank leaves the stored SR unchanged).
    const t = srText.trim();
    let srDelta: number | undefined;
    // A COUNTED placement match carries no ±% at all — only the predicted rank,
    // recorded against the run after the review saves. A match outside the ten
    // records its ±% normally: this is its one chance, since GEP can't report
    // one and no later step can reconstruct it.
    if (mode === 'placement') {
      srDelta = undefined;
    } else if (isComp && mode === 'full' && srMode === 'set-current') {
      // Already translated by rankEntry. An unanchored track has no delta to
      // record — that entry sets the starting rank instead, below.
      if (rankPreview?.anchored) srDelta = rankPreview.srDelta;
    } else if (isComp && t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) srDelta = n;
    }
    const anchoring = mode === 'full' && isComp && srMode === 'set-current' && rankPreview?.anchored === false;
    // AWAITED, not fire-and-forget: the refetch that follows the save reads
    // `primaryRank`, which only exists once this anchor has landed. Left
    // unawaited, a refetch could resolve first and paint the pre-anchor rank —
    // the same staleness the refetch was added to fix, just harder to see.
    const anchored = anchoring
      ? bridge.setRankAnchor({
          account: m.account, role: m.role,
          tier: rankTier, division: rankDivision, progressPct: Number(rankPct) || 0,
        })
      : Promise.resolve();
    const reviewed = bridge.saveReview({
      matchId: m.matchId, grades, flags,
      ...(performance != null ? { performance } : {}),
      ...(srDelta !== undefined ? { srDelta } : {}),
    });
    void Promise.all([anchored, mode === 'placement'
      ? reviewed.then(() => bridge.setPlacementPrediction({
          account: m.account, role: m.role, matchId: m.matchId,
          prediction: { tier: predTier, division: predDivision },
        }))
      : reviewed,
    ]).then(() => {
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
            void store.refresh();
          }),
        },
      });
      // Auto-tracked matches land here, never through the log form — this is
      // the path that made the reveal-rank prompt reportable in the first
      // place (#184). Only a match on a track with an open run can possibly
      // have finished one; a non-placement review has nothing to confirm.
      if (run) {
        // Refetch, not just rerender: confirming the revealed rank writes a real
        // rank anchor (completePlacementRun), so the chip must stop saying
        // "Placements N/10" and start showing that rank.
        void maybeConfirmPlacementRank({
          account: m.account, role: m.role,
          onDone: () => { store.rerender(); void store.refresh(); },
        });
      } else if (isComp) {
        // No run on this track: the same "should one start?" question the log
        // form asks after a manual save. This is the belt-and-braces catch-up
        // for an auto-tracked match whose `onGameLogged` push was dropped
        // because no window was open (`DashboardWindow.push` is a silent no-op
        // then) — grading it is the next time the track is in front of us.
        //
        // Refetches for the same reason the confirm above does: STARTING a run
        // replaces the track's rank with `Placements N/10`, so the chip has to
        // be told rather than left on the pre-offer snapshot.
        void maybeOfferPlacements(m.account, m.role, () => { store.rerender(); void store.refresh(); });
      }
    });
  };

  const flagsRow = mentalFlagsRow(flags);

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
    section('◎ How it felt', flagsRow.el),
    section('◎ How you played', performanceSlider(performance, (v) => { performance = v; })),
    // Competitive only — GEP can't report SR, so the player enters what the game
    // showed. Blank = leave unchanged (mirrors the W/L/D backfill just above).
    isComp ? section(run ? '◎ Predicted rank' : '◎ Skill rating', srSection()) : null,
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '15px', alignItems: 'center' } },
      button('Save & next', { variant: 'primary', onClick: doSave }),
      button('Skip', { variant: 'ghost', onClick: onSkip }),
      h('span', { class: 'u-dim', style: { fontSize: '10.5px', marginLeft: 'auto' } },
        'keys: H P M grade · S save · N skip · T tilt · X toxic'),
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
    skip: onSkip,
    toggleFlag: flagsRow.toggleFlag,
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
