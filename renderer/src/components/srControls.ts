/**
 * The skill-rating entry controls shared by every match-entry surface — the
 * quick-log card, the match-detail editor and the Review card: the Change /
 * Set-current mode toggle, the signed SR-% input, and the tier/division/% rank
 * picker. Extracted so the three surfaces render (and word) SR entry identically
 * and can't drift again.
 *
 * Setting a rank is an INPUT AID for the ±% field, not a second way to record a
 * match. {@link rankEntry} asks main to translate the entered rank into the delta
 * the player would otherwise have typed and shows it immediately; every surface
 * then submits a plain `srDelta`. That is why the translation lives here rather
 * than in each caller — one shared control, one shared wording, one behaviour.
 */
import { h, render } from '../dom';
import { segmented, select } from './primitives';
import { attachWheelNudge } from './wheelStepper';
import { TIERS } from '../../../src/core/rank';
import { bridge } from '../bridge';
import type { RankEntryPreview, Result, Role } from '../../../src/shared/contract';

/** The SR-entry mode: nudge the change (±%) or set the current rank outright. */
export type SrMode = 'change' | 'set-current';

/**
 * The SR-% change to pre-fill for a result — a starting point the player fine-tunes
 * with the wheel, since GEP never reports SR. Win/Loss suggest ±25 (a typical
 * competitive swing); a Draw suggests no change. Shared by every SR-entry surface
 * (quick log, match editor, Review) so the suggestion can't drift between them.
 */
export function suggestedSrDelta(result: Result): string {
  return result === 'Win' ? '25' : result === 'Loss' ? '-25' : '0';
}

/** Divisions high→low for the rank picker (5 = lowest band, 1 = highest). */
const DIVISIONS = [5, 4, 3, 2, 1];

/** The Change (±%) / Set current rank segmented toggle. */
export function srModeToggle(value: SrMode, onChange: (v: SrMode) => void): HTMLElement {
  return segmented<SrMode>({
    options: [{ value: 'change', label: 'Change (±%)' }, { value: 'set-current', label: 'Set current rank' }],
    value,
    onChange,
    fill: true,
  });
}

/** A signed number input styled like the rest of the form, with the ±1 wheel nudge. */
function nudgedInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const el = h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder,
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
  attachWheelNudge(el, () => el.value, onChange);
  return el;
}

/** The Change-mode signed SR-% input (blank allowed; the caller interprets it). */
export function srDeltaInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  return nudgedInput(value, 'e.g. +22 or -19', onChange);
}

export interface RankPickerOpts {
  tier: string;
  division: number;
  /** Percent within the division as entered text ('' = unset; negative = protected). */
  pct: string;
  onTier: (tier: string) => void;
  onDivision: (division: number) => void;
  onPct: (pct: string) => void;
}

/** The Set-current-mode tier / division / % picker (wheel-nudged % field). */
export function rankPicker(opts: RankPickerOpts): HTMLElement {
  return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    select(TIERS.map((t) => ({ value: t, label: t })), opts.tier, opts.onTier),
    select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(opts.division),
      (v) => opts.onDivision(Number(v))),
    nudgedInput(opts.pct, 'e.g. 40, or -19 if protected', opts.onPct),
  );
}

export interface RankEntryOpts extends RankPickerOpts {
  /** The track the entered rank belongs to, and the match it was reached at. */
  account: string;
  role: Role;
  timestamp: number;
  /**
   * Fires whenever the translation resolves — with the ±% to submit, or with
   * `anchored: false` when this entry would set the track's first anchor. The
   * surface stores the latest value and submits accordingly; it never recomputes.
   */
  onResolved: (preview: RankEntryPreview) => void;
}

/**
 * The Set-current-mode picker WITH the live translation into a ±%.
 *
 * The point of the mode is convenience, not a different kind of record: you say
 * where you ended up, and the app works out the change. Showing that number
 * while you pick — rather than silently deriving it on save — is what makes the
 * two modes visibly the same thing, and lets you catch a mistyped rank before it
 * is stored.
 *
 * An unanchored track has no rank-before to measure against, so instead of a
 * fabricated `0` it says plainly that this entry sets the starting rank.
 */
export function rankEntry(opts: RankEntryOpts): HTMLElement {
  const out = h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Working out the change…');
  // Guards against out-of-order replies: a fast picker change can resolve after
  // a slower earlier one, which would leave the older number on screen.
  let seq = 0;

  const resolve = (): void => {
    const mine = ++seq;
    void bridge.rankEntryPreview({
      account: opts.account,
      role: opts.role,
      timestamp: opts.timestamp,
      rank: { tier: opts.tier, division: opts.division, progressPct: Number(opts.pct) || 0 },
    }).then((preview) => {
      if (mine !== seq) return;
      opts.onResolved(preview);
      render(out, preview.anchored
        ? h('span', {}, 'SR change for this match: ',
            h('strong', {}, `${preview.srDelta > 0 ? '+' : ''}${preview.srDelta}%`))
        : h('span', {}, 'No rank tracked for this role yet — saving sets this as your starting rank.'));
    });
  };

  const picker = rankPicker({
    tier: opts.tier,
    division: opts.division,
    pct: opts.pct,
    onTier: (v) => { opts.onTier(v); opts.tier = v; resolve(); },
    onDivision: (v) => { opts.onDivision(v); opts.division = v; resolve(); },
    onPct: (v) => { opts.onPct(v); opts.pct = v; resolve(); },
  });
  resolve();
  return h('div', { class: 'stack', style: { gap: '4px' } }, picker, out);
}

export interface PlacementPickerOpts {
  tier: string;
  division: number;
  onTier: (tier: string) => void;
  onDivision: (division: number) => void;
}

/**
 * The tier/division-only picker for a match logged into an OPEN placement run.
 * Deliberately not `rankPicker` with the `%` field hidden: during placements
 * Overwatch itself shows neither a percent-in-division nor a rank-protection
 * state, only a predicted rank (tier + division) after each match — so
 * offering either field here would invite the player to invent data the game
 * never gives them.
 */
export function placementPicker(opts: PlacementPickerOpts): HTMLElement {
  return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    select(TIERS.map((t) => ({ value: t, label: t })), opts.tier, opts.onTier),
    select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(opts.division),
      (v) => opts.onDivision(Number(v))),
  );
}
