/**
 * Mental's practice-mode cards (issue #321): how often you did what you set
 * out to do, per sitting and per target, and how the way you went in (sleep,
 * energy, mood, food, breaks) lines up with how you actually played. Win/loss
 * is the small print here — Trends keeps the objective side.
 */
import { h } from '../../dom';
import {
  FACTOR_LABELS, FACTOR_LEVELS, type ExecutionTally, type FactorEntry, type FactorHeadline, type FactorRow,
  type TargetGrade, type TargetSummary, type WeakDay,
} from '../../../../src/shared/contract';
import { COST_MIN_SAMPLE } from '../../../../src/core/mentalAnalytics';
import { pct, prettyDay } from '../../format';
import { PALETTE } from '../../theme';
import { badge, card, emptyState, statBar } from '../../components/primitives';
import { inlineLink } from '../../components/inlineLink';
import { GRADES } from '../../components/reviewControls';
import type { ViewContext } from '../view';

const gradeColor = (g: TargetGrade | undefined): string =>
  g === 'hit' ? 'var(--win)' : g === 'partial' ? 'var(--warn)' : g === 'missed' ? 'var(--loss)' : 'var(--surface-3)';

/** The Hit / Partial / Missed proportion bar, in the grade palette Review uses. */
function gradeBar(t: ExecutionTally): HTMLElement {
  const seg = (n: number, color: string): HTMLElement | null =>
    n ? h('div', { style: { width: `${(n / t.attempts) * 100}%`, background: color } }) : null;
  return h('div', { class: 'grade-bar', role: 'img', 'aria-label': `${t.hits} hit, ${t.partials} partial, ${t.misses} missed` },
    seg(t.hits, 'var(--win)'), seg(t.partials, 'var(--warn)'), seg(t.misses, 'var(--loss)'));
}

/** Target execution — the practice "winrate", with win/loss underneath as the secondary line. */
export function executionCard(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const t = d.practice.execution;
  const sub = 'your practice “winrate” · hit = 1, partial = ½';
  if (t.score === null) {
    return card({ title: 'Target execution', sub },
      emptyState('No graded focus games in this range yet — pick what you worked on when you review a game.'));
  }
  const prev = d.practice.prevExecution;
  const delta = prev?.score != null ? Math.round((t.score - prev.score) * 100) : null;
  return card({ title: 'Target execution', sub },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginTop: '4px' } },
      h('span', { class: 'mono', style: { fontSize: '44px', letterSpacing: '-0.02em' } }, pct(t.score)),
      delta !== null && d.previous
        ? h('span', { class: delta > 0 ? 'is-win' : delta < 0 ? 'is-loss' : 'u-dim', style: { fontSize: '12.5px' } },
            `${delta > 0 ? '+' : ''}${delta} pts vs ${d.previous.label}`)
        : null,
    ),
    gradeBar(t),
    h('div', { class: 'grade-legend' },
      ...GRADES.map((g) => h('span', null,
        h('span', { class: 'grade-dot', style: { background: gradeColor(g.v) } }),
        ` ${g.v === 'hit' ? t.hits : g.v === 'partial' ? t.partials : t.misses} ${g.label.toLowerCase()}`)),
      h('span', { class: 'mono u-dim' }, `${t.attempts} graded`),
    ),
    h('div', { class: 'practice-secondary' },
      h('span', null, 'Winrate ', h('span', { class: 'mono' }, pct(d.overall.winrate)), ` · ${d.overall.games} games`),
      inlineLink('Full stats on Trends ›', { onClick: () => ctx.navigate('trends') }),
    ),
  );
}

/** Execution per sitting — the bars are the practice, W–L the small print. */
export function sessionQualityCard(ctx: ViewContext): HTMLElement {
  const rows = ctx.data.practice.sittings;
  const sub = 'execution per sitting · the result is the small print';
  if (!rows.length) return card({ title: 'Session quality', sub }, emptyState('Sittings with graded focus games appear here.'));
  const best = [...rows].sort((a, b) => b.score - a.score)[0];
  const label = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return card({ title: 'Session quality', sub },
    h('div', { class: 'sitting-bars' },
      ...rows.map((r) => h('div', { class: 'sitting-bar', title: `${label(r.startedAt)} · ${pct(r.score)} executed over ${r.attempts} grade${r.attempts === 1 ? '' : 's'} · ${r.wins}–${r.losses}` },
        h('span', { class: 'mono', style: { fontSize: '10.5px' } }, pct(r.score)),
        h('div', { class: 'sitting-bar-fill', style: { height: `${Math.max(4, Math.round(r.score * 90))}px`, opacity: r === best ? '1' : '0.6' } }),
        h('span', { style: { fontSize: '10.5px' } }, label(r.startedAt)),
        h('span', { class: 'mono u-dim', style: { fontSize: '10px' } }, `${r.wins}–${r.losses}`),
      ))),
    rows.length > 1
      ? h('div', { class: 'hint', style: { marginTop: '8px' } },
          `Best sitting: ${label(best.startedAt)} — ${pct(best.score)} executed`,
          best.losses > best.wins ? `, while going ${best.wins}–${best.losses}. Good practice even when the result wasn’t.` : '.')
      : null,
  );
}

/** One row per active self-rated target: hit rate, recent grades, whether it's landing more often. */
export function activeTargetsCard(ctx: ViewContext): HTMLElement {
  const active = ctx.data.targets.filter((t) => t.isActive && !t.archivedAt);
  const manage = inlineLink('Manage targets ›', { onClick: () => ctx.navigate('targets') });
  if (!active.length) {
    return card({ title: 'Your active targets', sub: 'how often you actually did what you planned', actions: manage },
      emptyState('No active targets — practice focus is on, so pick one on the Targets page.'));
  }
  return card({ title: 'Your active targets', sub: 'how often you actually did what you planned', actions: manage },
    h('div', { class: 'stack', style: { gap: '4px' } }, ...active.map(targetRow)),
  );
}

function targetRow(t: TargetSummary): HTMLElement {
  const last = t.recentAttempts.slice(0, 6).reverse();
  const trend = t.learning?.execRising
    ? h('span', { class: 'is-win' }, '↑ landing more often')
    : t.attempts ? h('span', { class: 'u-dim' }, `${t.attempts} graded`) : h('span', { class: 'u-dim' }, 'not graded yet');
  return h('div', { class: 'practice-target-row' },
    h('div', { style: { minWidth: '0' } },
      h('div', { style: { fontSize: '13px' } }, t.name, ' ', badge(t.mode === 'measured' ? '⚡ auto' : '◎ self', t.mode === 'measured' ? 'auto' : 'manual')),
      h('div', { class: 'mono u-dim', style: { fontSize: '10.5px', marginTop: '2px' } }, t.rule),
    ),
    statBar({ label: '', frac: t.hitRate, color: PALETTE.win, valueText: t.attempts ? pct(t.hitRate) : '—', slim: true, title: 'Hit rate' }),
    h('div', { style: { fontSize: '12px' } }, trend),
    h('div', { class: 'grade-dots', 'aria-label': 'last graded games, oldest first' },
      ...last.map((a) => h('span', { class: 'grade-dot grade-dot--lg', title: `${a.map} · ${a.grade ?? 'not graded'}`, style: { background: gradeColor(a.grade) } }))),
  );
}

const levelLabel = (f: FactorEntry, key: string): string =>
  FACTOR_LEVELS[f.key].find((l) => l.key === key)?.label ?? key;

/** "What shapes your performance" — how you went in vs how it actually went. */
export function factorCard(ctx: ViewContext): HTMLElement {
  const { factors, headline } = ctx.data.practice;
  const sub = `how you felt going in vs how it actually went · ◎ from your check-in, ⚡ tracked · rows under ${COST_MIN_SAMPLE} games are dimmed`;
  if (!factors.length) return card({ title: 'What shapes your performance', sub }, emptyState('Play a few sittings to see how they compare.'));
  const hasCheckIn = factors.some((f) => f.source === 'checkIn');
  return card({ title: 'What shapes your performance', sub },
    h('div', { class: 'table-scroll' },
      h('table', { class: 'data factor-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Going in'), h('th', { class: 'num' }, 'Games'),
          h('th', null, 'Target execution'), h('th', null, 'How you played'), h('th', { class: 'num' }, 'Winrate'))),
        ...factors.map((f) => h('tbody', null,
          h('tr', { class: 'factor-head' }, h('td', { colspan: '5' }, `${f.source === 'checkIn' ? '◎' : '⚡'} ${FACTOR_LABELS[f.key]}`)),
          ...f.rows.map((r) => factorRow(f, r)),
        )),
      ),
    ),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } }, headlineText(factors, headline ?? null)),
    !hasCheckIn
      ? h('div', { class: 'hint', style: { marginTop: '4px' } },
          'Sleep, energy and food rows appear once your check-ins carry them — switch the questions on in Settings › Coaching.')
      : null,
  );
}

function factorRow(f: FactorEntry, r: FactorRow): HTMLElement {
  const thin = r.games < COST_MIN_SAMPLE;
  const bar = (frac: number | null, text: string, color: string): HTMLElement =>
    frac === null ? h('span', { class: 'u-dim' }, '—') : statBar({ label: '', frac, color, valueText: text, slim: true });
  return h('tr', { class: thin ? 'is-thin' : '', title: thin ? `Under ${COST_MIN_SAMPLE} games — not read` : undefined },
    h('td', null, levelLabel(f, r.key)),
    h('td', { class: 'num mono' }, String(r.games)),
    h('td', null, bar(r.execution, r.execution === null ? '' : pct(r.execution), PALETTE.accent)),
    h('td', null, bar(r.avgRating === null ? null : r.avgRating / 100, r.avgRating === null ? '' : String(Math.round(r.avgRating)), PALETTE.win)),
    h('td', { class: 'num mono' }, r.decided ? pct(r.winrate) : '—'),
  );
}

function headlineText(factors: FactorEntry[], hl: FactorHeadline | null): string {
  if (!hl) return `No factor stands out yet — it needs ${COST_MIN_SAMPLE}+ rated games on two levels and a clear gap.`;
  const f = factors.find((x) => x.key === hl.factor)!;
  return `Biggest gap right now: ${FACTOR_LABELS[hl.factor].toLowerCase()} — you rate your play ${Math.round(hl.gap)} points `
    + `higher after “${levelLabel(f, hl.high.key)}” than after “${levelLabel(f, hl.low.key)}”. `
    + 'That’s a correlation, not proof — but worth testing.';
}

/** The weakest days in range, with the plain facts of each. */
export function weakestDaysCard(ctx: ViewContext): HTMLElement {
  const days = ctx.data.practice.weakestDays;
  const sub = 'lowest “How you played” days in range, and what was so that day';
  if (!days.length) return card({ title: 'Your weakest days', sub }, emptyState('Days with 3+ rated games appear here.'));
  return card({ title: 'Your weakest days', sub },
    h('div', { class: 'stack', style: { gap: '2px' } }, ...days.map((day) => weakDayRow(ctx, day))),
  );
}

function weakDayRow(ctx: ViewContext, day: WeakDay): HTMLElement {
  return h('div', { class: 'weak-day' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
      inlineLink(prettyDay(day.date), { title: `Open ${day.date}'s matches`, onClick: () => ctx.navigate('matches', { day: day.date }) }),
      h('span', { class: 'mono', style: { fontSize: '11.5px' } },
        `played ${Math.round(day.avgRating)}`,
        day.execution !== null ? ` · ${pct(day.execution)} executed` : '',
        ` · ${day.wins}–${day.losses}`),
    ),
    day.tags.length
      ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '5px' } },
          ...day.tags.map((t) => h('span', { class: 'tag' }, t)))
      : null,
  );
}
