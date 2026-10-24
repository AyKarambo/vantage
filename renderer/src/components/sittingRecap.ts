/**
 * The Review screen's sitting recap (issue #321) — shown in practice mode once
 * every game of a sitting has your read. Practice comes first: targets
 * executed, how you played, the check-in you went in with; the result is the
 * last and quietest tile. One plain sentence compares the sitting's execution
 * with your own average.
 */
import { h } from '../dom';
import {
  CHECK_IN_ENERGY_LABELS, CHECK_IN_LABELS, CHECK_IN_SLEEP_LABELS, type SittingRecap,
} from '../../../src/shared/contract';
import { pct } from '../format';
import { button, card } from './primitives';

/** Execution points a sitting must sit above/below the average before the sentence calls it out. */
const NOTABLE = 0.05;

export function sittingRecapCard(r: SittingRecap, onDismiss: () => void): HTMLElement {
  const score = r.execution.score;
  const tile = (label: string, value: string, sub: string, accent = false): HTMLElement =>
    h('div', { class: `recap-tile${accent ? ' recap-tile--accent' : ''}` },
      h('div', { class: 'review-section-label', style: { margin: '0' } }, label),
      h('div', { class: 'mono', style: { fontSize: '22px', marginTop: '6px' } }, value),
      h('div', { class: 'hint' }, sub),
    );
  const c = r.checkIn;
  const checkInText = c
    ? [CHECK_IN_LABELS[c.mood], c.sleep ? `slept ${CHECK_IN_SLEEP_LABELS[c.sleep]}` : null, c.energy ? `energy ${CHECK_IN_ENERGY_LABELS[c.energy]}` : null]
      .filter((s): s is string => s !== null).join(' · ')
    : 'no check-in';
  const t = r.execution;
  const gradeLine = [`${t.hits} hit`, t.partials ? `${t.partials} partial` : null, t.misses ? `${t.misses} missed` : null]
    .filter((s): s is string => s !== null).join(', ');
  const minutes = Math.round((r.endedAt - r.startedAt) / 60_000);

  return card({
    variant: 'raised',
    title: 'Sitting recap',
    sub: `${r.games} game${r.games === 1 ? '' : 's'} · ${minutes} min · how the practice went`,
    actions: button('Dismiss', { variant: 'ghost', onClick: onDismiss }),
  },
  h('div', { class: 'recap-grid' },
    tile('Targets executed', score === null ? '—' : pct(score), `${gradeLine}${r.overallScore !== null ? ` · your average ${pct(r.overallScore)}` : ''}`, true),
    tile('How you played', r.avgRating === null ? '—' : String(Math.round(r.avgRating)), r.avgRating === null ? 'not rated' : 'average self-rating'),
    tile('Check-in', c ? CHECK_IN_LABELS[c.mood] : '—', checkInText),
    tile('Result', `${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ''}`, r.srDelta !== undefined ? `${r.srDelta > 0 ? '+' : ''}${r.srDelta}% SR` : 'win / loss'),
  ),
  h('div', { class: 'hint', style: { marginTop: '10px', fontSize: '12.5px' } }, sentence(r)),
  );
}

function sentence(r: SittingRecap): string {
  const s = r.execution.score;
  const avg = r.overallScore;
  if (s === null || avg === null) return 'Practice logged — the comparison appears once you have more graded games.';
  const lost = r.losses > r.wins;
  if (s >= avg + NOTABLE) {
    return lost
      ? 'Good practice sitting: you executed above your average, even though the result didn’t follow.'
      : 'Good practice sitting: you executed above your average.';
  }
  if (s <= avg - NOTABLE) return 'You executed below your average this sitting — worth a look at what was different going in.';
  return 'About your usual execution this sitting.';
}
