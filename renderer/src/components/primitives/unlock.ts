/**
 * The shared "unlocks at N" progress readout (F1) — replaces seven screens
 * that each gated on their own floor and told a first-week player something
 * different, none of them the actual number (Readiness said "keep logging"
 * over an unstated 15-games/14-days gate; Focus/Maps/Trends just showed an
 * empty state; Mental's own progress line overshot a met side, printing
 * "12/5 calm" once one side cleared its floor while the other hadn't).
 */
import { h, applyStyle } from '../../dom';

/** One dimension of an unlock gate — e.g. `{ have: 2, need: 3, label: 'games' }`. */
export interface UnlockPart {
  have: number;
  need: number;
  label: string;
}

/**
 * The pure half of a part's row — whether its own floor is met, and the
 * clamped 0–1 progress fraction toward it. Extracted (and unit-tested, since
 * `unlockPartRow` itself needs a DOM) so the actual fix stays covered: a
 * part with `have` past `need` reports `met: true`, never a fraction/label
 * combination that could print something like "12/5".
 */
export function unlockProgress(p: UnlockPart): { met: boolean; frac: number } {
  const met = p.have >= p.need;
  const frac = p.need > 0 ? Math.max(0, Math.min(1, p.have / p.need)) : 1;
  return { met, frac };
}

/**
 * `headline` states the gate itself in plain language ("Unlocks at 3 games
 * on a map"); each part renders its own thin track + "N of M <label>",
 * clamped to a check mark the INSTANT that one part individually meets its
 * own floor — a multi-part gate (Readiness's games AND days, or Mental's
 * two independent sides) never prints a number past its target.
 */
export function unlockHint(headline: string, parts: UnlockPart[]): HTMLElement {
  return h('div', { class: 'unlock-hint' },
    h('div', { class: 'hint' }, headline),
    ...parts.map(unlockPartRow),
  );
}

function unlockPartRow(p: UnlockPart): HTMLElement {
  const { met, frac } = unlockProgress(p);
  const fill = h('div', { class: 'track-fill' });
  applyStyle(fill, { width: `${Math.round(frac * 100)}%`, background: met ? 'var(--win-text)' : 'var(--accent)' });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' } },
    h('div', { class: 'track track--slim', style: { maxWidth: '120px' } }, fill),
    h('span', {
      class: 'mono',
      style: { fontSize: '11px', color: met ? 'var(--win-text)' : 'var(--muted)', whiteSpace: 'nowrap', flex: '0 0 auto' },
    }, met ? `✓ ${p.label}` : `${p.have} of ${p.need} ${p.label}`),
  );
}
