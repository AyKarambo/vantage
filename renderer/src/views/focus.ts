/**
 * Focus — the "work on these" hub: net-losing maps, heroes AND roles (H1),
 * each in its own worst-first section, ranked by a sample-aware deficit so a
 * real, well-evidenced weakness outranks a same-sized but noisy small sample.
 * Every row carries a trend verdict and, when an improvement target is
 * linked, the since-flagged progress. Overview teases → Focus prioritizes →
 * Maps/Trends stay the raw reference tables → Targets is the commitment.
 */
import { h, applyStyle } from '../dom';
import type { FocusEntry, FocusProgress, Role } from '../../../src/shared/contract';
import { pct, roleLabel, signed } from '../format';
import { PALETTE, wrColor } from '../theme';
import { button, card, pill } from '../components/primitives';
import { TREND_META } from '../components/trendArrow';
import { inlineLink } from '../components/inlineLink';
import { openPopover } from '../components/popover';
import { openHeroDrawer } from './heroes';
import { viewHead, type ViewContext } from './view';

export function focus(ctx: ViewContext): HTMLElement {
  const items = ctx.data.focusItems;
  const roles = items.filter((e) => e.dimension === 'role');
  const heroes = items.filter((e) => e.dimension === 'hero');
  const maps = items.filter((e) => e.dimension === 'map');

  return h('div', { class: 'view' },
    viewHead('Focus', 'The roles, heroes and maps that cost you the most points — work on these'),
    focusSection(ctx, 'Roles', 'net = losses − wins · across your roles', roles),
    focusSection(ctx, 'Heroes', 'net = losses − wins · across your heroes', heroes),
    focusSection(ctx, 'Maps', 'net = losses − wins · across your maps', maps),
    items.length
      ? null
      : card({ title: 'Work on these' }, h('div', { class: 'empty empty--good' }, 'Nothing is net-losing right now — nice. 🎯')),
    card({ variant: 'glow', title: 'Build a focus routine' },
      h('p', { class: 'hint', style: { lineHeight: '1.6', margin: '0 0 12px' } },
        'Practice your bottom three before ranked and review one replay each. Small, repeatable — that is how the deficit closes.'),
      button('Start a routine →', { variant: 'primary', onClick: () => ctx.navigate('targets') }),
    ),
  );
}

/** One dimension's card — omitted entirely when it has no net-losing entries, so an empty dimension doesn't waste a section on nothing. */
function focusSection(ctx: ViewContext, title: string, sub: string, entries: FocusEntry[]): HTMLElement | null {
  if (!entries.length) return null;
  const maxNet = entries[0].net;
  return card({ title, sub },
    h('div', { class: 'stack', style: { gap: '14px' } }, ...entries.map((e) => focusRow(ctx, e, maxNet))));
}

function focusRow(ctx: ViewContext, e: FocusEntry, maxNet: number): HTMLElement {
  const fill = h('span', { style: { display: 'block', height: '100%', background: PALETTE.loss, borderRadius: 'inherit' } });
  applyStyle(fill, { width: `${Math.round((e.net / maxNet) * 100)}%` });

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', minWidth: '0', flexWrap: 'wrap' } },
        entryLink(ctx, e),
        // H1: a map outside the current competitive pool still gets a row
        // (history stays visible) but is flagged rather than treated as a
        // live weakness — practicing it wouldn't move a real queue.
        e.inPool === false ? h('span', { class: 'tag', title: 'Not in the current competitive map pool' }, 'Out of pool') : null,
        e.dimension === 'map' && e.mode ? pill(e.mode, 'accent') : null,
        trendPill(e),
      ),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'baseline' } },
        h('span', { class: 'is-loss mono', style: { fontSize: '13px' } }, `${signed(-e.net)} net`),
        // Net SR (C2) beside net wins — display only, the ranking stays raw
        // net (sample-aware deficit, H1); a 3-loss map at −60% and one at
        // −45% otherwise look identical on this row.
        e.srNet !== undefined
          ? h('span', { class: `mono ${e.srNet >= 0 ? 'is-win' : 'is-loss'}`, style: { fontSize: '11px' } }, `${signed(Math.round(e.srNet))}%`)
          : null,
        h('span', { class: 'mono', style: { color: wrColor(e.winrate) } }, pct(e.winrate)),
        h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${e.games}g`),
        e.progress || e.inPool === false ? null : targetButton(ctx, e),
      ),
    ),
    h('div', { class: 'track track--slim' }, fill),
    // H2: the per-map record explains WHY, not just that — most of a map's
    // losses often trace to one hero, and that used to be invisible here.
    e.dimension === 'map' ? heroRecordLine(ctx, e) : null,
    e.progress ? progressLine(e.progress) : null,
  );
}

/** The row's primary click target — where "open the games behind this" points, by dimension. */
function entryLink(ctx: ViewContext, e: FocusEntry): HTMLElement {
  if (e.dimension === 'map') {
    // The primary action opens the games behind this row (H3) — the plain
    // div this used to be was a dead end, the one thing every other
    // "open the map" surface in the app already promised. A secondary
    // "↗ Maps" keeps today's flash-jump to the aggregate ranking, for
    // "how does this map look overall" rather than "which games".
    return h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'baseline' } },
      inlineLink(e.key, {
        class: 'row-name',
        style: { fontSize: '13.5px' },
        title: `Open your ${e.key} matches`,
        onClick: () => ctx.navigate('matches', { map: e.key }),
      }),
      inlineLink('↗ Maps', {
        class: 'u-dim',
        style: { fontSize: '11px' },
        title: `See ${e.key} on the Maps ranking`,
        onClick: () => ctx.navigate('maps', { highlight: e.key }),
      }),
    );
  }
  if (e.dimension === 'hero') {
    return inlineLink(e.key, {
      class: 'row-name',
      style: { fontSize: '13.5px' },
      title: `Open the ${e.key} drawer`,
      onClick: () => openHeroDrawer(ctx, e.key),
    });
  }
  // role
  return inlineLink(roleLabel(e.key), {
    class: 'row-name',
    style: { fontSize: '13.5px' },
    title: `Open Trends scoped to ${roleLabel(e.key)}`,
    onClick: () => { ctx.setFilter({ role: e.key }); ctx.navigate('trends'); },
  });
}

/** "with Genji 1-4 · Tracer 0-2 · Sombra 1-0" — the top heroes behind a map
 *  entry's record, per-game credit (H2's FocusEntry.heroes), each opening
 *  that hero's own drawer. */
function heroRecordLine(ctx: ViewContext, e: FocusEntry): HTMLElement | null {
  if (!e.heroes?.length) return null;
  return h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '4px' } },
    'with ',
    ...e.heroes.flatMap((hr, i) => [
      i > 0 ? ' · ' : '',
      inlineLink(`${hr.hero} ${hr.wins}-${hr.losses}`, {
        style: { fontSize: '11px' },
        title: `Open the ${hr.hero} drawer`,
        onClick: () => openHeroDrawer(ctx, hr.hero),
      }),
    ]),
  );
}

/** The recent-vs-earlier verdict as a small tinted readout — the point delta
 *  alongside the arrow, same grammar {@link progressLine} already uses. */
function trendPill(e: FocusEntry): HTMLElement | null {
  if (!e.trend) return null;
  const meta = TREND_META[e.trend];
  const text = e.trendPts === undefined || e.trend === 'flat' ? meta.label : `${signed(e.trendPts)} pts lately`;
  return h('span', { class: 'mono', style: { color: meta.color, fontSize: '11px' } }, `${meta.arrow} ${text}`);
}

/**
 * The closing-the-loop read for an entry that already has a tracked target:
 * the winrate moved since it was flagged (once both sides have enough decided
 * games), or an honest "tracking since" line while the sample is still small.
 */
function progressLine(p: FocusProgress): HTMLElement {
  const since = new Date(p.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const games = `${p.gamesSince} game${p.gamesSince === 1 ? '' : 's'} since`;
  if (p.deltaPts === undefined) {
    return h('div', { class: 'hint', style: { marginTop: '5px', fontSize: '11.5px' } },
      `◎ tracking “${p.targetName}” since ${since} · ${games}`);
  }
  const up = p.deltaPts >= 0;
  return h('div', { class: 'hint', style: { marginTop: '5px', fontSize: '11.5px' } },
    h('span', { class: `mono ${up ? 'is-win' : 'is-loss'}` },
      `${up ? '▴' : '▾'} ${Math.abs(p.deltaPts)} pts`),
    ` since you flagged it (${since}) · ${games}`,
  );
}

/** Quick-create a practice target for an entry that isn't tracked yet — pre-fills the
 *  matching hero/role/map scope (H1, R9) so the builder opens already scoped, not just
 *  named. Explains what that commits to (R9) before navigating, via {@link openTrackPopover}. */
function targetButton(ctx: ViewContext, e: FocusEntry): HTMLElement {
  const label = e.dimension === 'role' ? roleLabel(e.key) : e.key;
  const name = `Practice ${label}: warm up unranked + review one replay`;
  const params = {
    prefillName: name,
    ...(e.dimension === 'role' ? { prefillRole: e.key as Role } : {}),
    ...(e.dimension === 'hero' ? { prefillHeroes: [e.key] } : {}),
    ...(e.dimension === 'map' ? { prefillMap: [e.key] } : {}),
  };
  const btn = h('button', {
    class: 'btn btn--ghost',
    style: { padding: '3px 8px', fontSize: '10.5px' },
    title: `Create a practice target for ${label}`,
  }, 'Track as target');
  btn.addEventListener('click', () => openTrackPopover(btn, name, label, () => ctx.navigate('targets', params)));
  return btn;
}

/**
 * Explains what "Track as target" actually creates before committing (R9) —
 * a returning player clicking a bare "＋ target" button had no idea it
 * silently created a self-rated target and navigated away; this spells out
 * the prefilled name and what tracking means (graded every matching game,
 * progress shown back on this row) with a single confirm action.
 */
function openTrackPopover(anchor: HTMLElement, name: string, label: string, onConfirm: () => void): void {
  openPopover(anchor, (close) =>
    h('div', { class: 'stack', style: { gap: '10px', minWidth: '240px', maxWidth: '280px' } },
      h('div', { class: 'field-label' }, 'Track as target'),
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        `Creates a self-rated target scoped to ${label}, named “${name}”. You grade it Hit/Partial/Missed after every matching game, and this row will show your progress since you started tracking it.`),
      button('Track as target', {
        variant: 'primary', class: 'btn--block',
        onClick: () => { close(); onConfirm(); },
      }),
    ),
  );
}
