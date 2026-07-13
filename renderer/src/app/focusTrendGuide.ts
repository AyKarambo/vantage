/**
 * Focus Trend guide — a static, single-drawer explainer that teaches how to READ
 * a target's learning J-curve (the winrate line + the amber execution line).
 * Modelled on the readiness help wiki's visual grammar (a right-hand
 * {@link openDrawer}, section headings + body paragraphs) and reusing its
 * {@link wikiPara}/{@link wikiHeading} helpers — but deliberately NOT a multi-tier
 * mini-app: this is one honest read-through, reachable from the Focus Trend
 * panel's "How to read this" affordance.
 *
 * The copy mirrors the feature's honesty guarantees (see
 * ../../../src/core/targets/learningCurve): a dip is the expected cost of
 * practising and is never framed as decline, there is deliberately no "declining"
 * verdict, and the chart shows association over time, not proof of cause.
 */
import { h } from '../dom';
import { openDrawer } from '../components/overlay';
import { practiceJSchematic } from '../charts/plots';
import { PALETTE } from '../theme';
import { wikiHeading, wikiPara } from './readinessWiki/ui';
import { BASELINE_WINDOW, ROLL_WINDOW } from '../../../src/core/targets';

/** A bold, colour-coded inline token — makes a line/colour reference concrete in prose. */
const swatchWord = (text: string, color: string): HTMLElement =>
  h('span', { style: { color, fontWeight: '600' } }, text);

/** A legend row for one of the two chart lines: a mini rule + coloured name + note. */
function lineLegend(color: string, dashed: boolean, name: string, note: string): HTMLElement {
  const rule = h('span', {
    style: {
      display: 'inline-block', width: '24px', height: '0', flex: '0 0 auto',
      borderTop: `${dashed ? '2px dashed' : '2.5px solid'} ${color}`,
    },
  });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', margin: '5px 0' } },
    rule,
    h('span', { style: { fontSize: '12.5px', fontWeight: '600', color, minWidth: '62px' } }, name),
    h('span', { class: 'hint' }, note),
  );
}

/** The learning phases, mirroring the row chip's colour + label (see targetTrend PHASE_META). */
const PHASES: Array<{ color: string; label: string; note: string }> = [
  { color: PALETTE.muted, label: 'Gathering', note: 'too few games since you flagged it to draw an honest line yet' },
  { color: PALETTE.muted, label: 'New focus', note: 'enough games, but no before-baseline to compare against' },
  { color: PALETTE.accentBright, label: 'Building', note: 'the practice dip — below baseline, expected, not a problem' },
  { color: PALETTE.accentBright, label: 'Climbing back', note: 'risen off the low, still working back toward baseline' },
  { color: PALETTE.win, label: 'Paying off ↑', note: 'sustainably back above where you started' },
  { color: PALETTE.text, label: 'Holding steady', note: 'never really dipped — roughly flat vs your baseline' },
];

/** The colour-dot phase list — same grammar as the readiness wiki's band list. */
function phaseList(): HTMLElement {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', margin: '4px 0 6px' } },
    ...PHASES.map((p) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px' } },
      h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: p.color, flex: '0 0 auto' } }),
      h('span', { style: { fontSize: '12.5px', fontWeight: '600', minWidth: '108px' } }, p.label),
      h('span', { class: 'hint' }, p.note),
    )),
  );
}

/**
 * Open the Focus Trend guide — a right-hand drawer explaining how to read a
 * target's learning curve. Static content (no per-target context needed); the
 * drawer's built-in ✕ / Escape / backdrop handle dismissal.
 */
export function openFocusTrendGuide(): void {
  openDrawer(() => h('div', null,
    h('div', { class: 'wiki-title' }, 'Reading your Focus Trend'),
    wikiPara('This chart shows what happened to your winrate since you flagged this target — and, honestly, whether the work is paying off.'),

    // The idealised shape, up top, so the rest reads against it.
    h('div', { style: { display: 'flex', justifyContent: 'center', padding: '6px 0 2px' } }, practiceJSchematic()),

    wikiHeading('What this is'),
    wikiPara('Working on something new usually dips your winrate for a while — you’re spending focus on the new skill instead of your autopilot. Then it tends to rebound, often above where you started. That shape is a learning curve.'),
    wikiPara('So judge a target by the rebound, not the first few games. A rough patch right after you flag something is expected — it isn’t the verdict.'),

    wikiHeading('The baseline'),
    wikiPara(swatchWord('The cyan dashed line', PALETTE.info), ` is your winrate over the ~${BASELINE_WINDOW} decided games BEFORE you flagged this target — your form going in. Everything else is read against it.`),
    wikiPara('If you don’t have enough history before you flagged it, there’s no baseline line and no verdict. That’s deliberate, not a bug — the app would rather show nothing than invent a number to compare you against.'),

    wikiHeading('The dip'),
    wikiPara('When ', swatchWord('the purple line', PALETTE.accentBright), ' sags under the baseline, that’s the expected cost of practising: it means you’re doing the new thing on purpose, not that you got worse. It is never shown in red.'),

    wikiHeading('Paying off'),
    wikiPara('A ', swatchWord('green wedge', PALETTE.win), ' fills wherever your rolling winrate sits at or above the baseline, and a “back above baseline” marker appears once it sustainably climbs back over the baseline after a real dip. That’s the rebound you’re looking for.'),

    wikiHeading('The shaded band'),
    wikiPara('Every point sits inside a 95% uncertainty band. It’s WIDE when only a few games back that point — so a low point drawn from 6 games could be almost anything. Don’t over-read a wide band; wait for it to narrow as games add up.'),

    wikiHeading('The two lines'),
    lineLegend(PALETTE.accentBright, false, 'winrate', `the outcome — rolling over your last ${ROLL_WINDOW} decided games, so it lags`),
    lineLegend(PALETTE.mid, true, 'hit-rate', 'execution — how often you’re actually hitting the target lately'),
    wikiPara('Execution usually climbs FIRST. A rising ', swatchWord('amber line', PALETTE.mid), ' while your winrate is still down is the honest sign that practice is landing — you’re doing the thing more often, and the wins tend to follow.'),

    wikiHeading('The phases'),
    wikiPara('The little pill on each target names where it sits on the curve:'),
    phaseList(),
    wikiPara('There is deliberately no “declining” phase — the lowest state is “building”, and it’s defined as expected. The chart won’t tell you to stop.'),

    wikiHeading('Reading it honestly'),
    wikiPara('Your winrate moves for lots of reasons — the map, the hero, your rank, a streak, other targets you’re juggling. This chart shows how your form and this target moved together over time; it’s an association, not proof this target caused anything. Draws are excluded throughout.'),
    wikiPara(h('b', null, 'The takeaway: keep hitting the target through the dip.'), ' Execution first, wins after.'),
  ), { panelClass: 'drawer-panel--wide' });
}
