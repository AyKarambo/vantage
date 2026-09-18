/**
 * Match scoreboard — presentational factory for the detail page. Renders
 * whatever team blocks the stored roster actually contains: two teams with a
 * VS divider when both were reported, one team plus an explicit "not reported
 * by the game feed" note when the feed only delivered the local side. Best
 * value per stat column is highlighted; the tracked player's row(s) are tinted.
 */
import { h } from '../dom';
import type { ScoreboardEntry } from '../../../src/shared/contract';
import { fmt } from '../format';
import { roleIcon } from './roleIcon';
import { inlineLink } from './inlineLink';

type StatKey = 'eliminations' | 'assists' | 'deaths' | 'damage' | 'healing' | 'mitigation';

interface StatColumn {
  key: StatKey;
  label: string;
  compact: boolean;
  /** Which extreme counts as "best" for this column (M4) — deaths is the one
   *  column where FEWER is better; it used to share the same `Math.max` as
   *  every other column, so whoever died most was painted the same win-green
   *  as top damage. */
  best: 'max' | 'min';
}

const STATS: StatColumn[] = [
  { key: 'eliminations', label: 'E', compact: false, best: 'max' },
  { key: 'assists', label: 'A', compact: false, best: 'max' },
  { key: 'deaths', label: 'D', compact: false, best: 'min' },
  { key: 'damage', label: 'DMG', compact: true, best: 'max' },
  { key: 'healing', label: 'HEAL', compact: true, best: 'max' },
  { key: 'mitigation', label: 'MIT', compact: true, best: 'max' },
];

export interface ScoreboardOptions {
  /**
   * Append a per-team totals row (M4) — summed only over rows that report the
   * stat (blank, never zero-filled, when none do), the higher team's cell per
   * column brightened the way `tallyRow` (`views/live.ts`) brightens the
   * leading side. Opt-in: the match detail page passes it, but Live keeps its
   * own separate tally card and does not.
   */
  totals?: boolean;
}

type TeamTotal = Partial<Record<StatKey, number>>;

/**
 * @param onPlayer optional drill-down for a non-local player's name — when
 *   supplied, each opponent/teammate name renders as a link that calls it with
 *   the player's name (the tracked player's own row stays plain).
 */
export function scoreboard(entries: ScoreboardEntry[], onPlayer?: (name: string) => void, opts: ScoreboardOptions = {}): HTMLElement {
  // Perks are not in the feed today — the column only exists if data ever shows up.
  const hasPerks = entries.some((e) => e.perks?.length);
  const columns = `28px minmax(90px, 130px) minmax(0, 1fr)${hasPerks ? ' minmax(70px, 110px)' : ''} repeat(3, 42px) repeat(3, 58px)`;
  // Best per column across everyone on the board, like the in-game TAB screen.
  const best = new Map<StatKey, number>();
  for (const s of STATS) {
    const values = entries.map((e) => e[s.key]).filter((v): v is number => v != null);
    if (!values.length) continue;
    if (s.best === 'min') best.set(s.key, Math.min(...values));
    else {
      const max = Math.max(...values);
      if (max > 0) best.set(s.key, max);
    }
  }

  const teams = groupTeams(entries);
  const totals = opts.totals ? teams.map((t) => teamTotal(t.entries)) : null;
  const blocks: Node[] = [headerRow(columns, hasPerks)];
  teams.forEach((team, i) => {
    if (i > 0) blocks.push(h('div', { class: 'sb-vs' }, h('span', null, 'VS')));
    blocks.push(h('div', { class: 'sb-team-label' }, team.label));
    blocks.push(...team.entries.map((e) => row(e, columns, hasPerks, best, onPlayer)));
    if (totals) blocks.push(totalRow(totals[i], teams.length === 2 ? totals[1 - i] : null, columns, hasPerks));
  });
  if (teams.length === 1) {
    blocks.push(
      h('div', { class: 'sb-vs' }, h('span', null, 'VS')),
      h('div', { class: 'sb-note' }, 'Enemy team not reported by the game feed.'),
    );
  }
  return h('div', { class: 'scoreboard' }, ...blocks);
}

/** Sums each stat over the rows that actually report it; a column stays absent — never a fabricated 0 — when none of the team's rows do (M4). */
function teamTotal(entries: ScoreboardEntry[]): TeamTotal {
  const out: TeamTotal = {};
  for (const s of STATS) {
    const values = entries.map((e) => e[s.key]).filter((v): v is number => v != null);
    if (values.length) out[s.key] = values.reduce((a, b) => a + b, 0);
  }
  return out;
}

function totalRow(mine: TeamTotal, other: TeamTotal | null, columns: string, hasPerks: boolean): HTMLElement {
  return h('div', { class: 'sb-row sb-row--total', style: { gridTemplateColumns: columns } },
    h('span', null, ''),
    h('span', null, ''),
    h('span', { class: 'sb-team-total-label' }, 'Team total'),
    hasPerks ? h('span', null, '') : null,
    ...STATS.map((s) => totalCell(mine[s.key], other?.[s.key], s)),
  );
}

function totalCell(value: number | undefined, otherValue: number | undefined, col: StatColumn): HTMLElement {
  if (value == null) return h('span', { class: 'sb-cell mono u-dim' }, '–');
  // Deaths leads the other way — fewer is ahead, same direction as the
  // per-row is-best-neutral highlight (M4).
  const leads = otherValue == null || (col.best === 'min' ? value <= otherValue : value >= otherValue);
  return h('span', { class: `sb-cell mono${leads ? '' : ' is-total-behind'}` }, col.compact ? fmt(value) : String(value));
}

interface TeamBlock {
  label: string;
  entries: ScoreboardEntry[];
}

/** Group by the feed's team index; the tracked player's team renders first. */
function groupTeams(entries: ScoreboardEntry[]): TeamBlock[] {
  const groups = new Map<number | 'none', ScoreboardEntry[]>();
  for (const e of entries) {
    const key = e.team ?? 'none';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  const blocks = [...groups.entries()].map(([, list]) => ({
    label: list.some((e) => e.isLocal) ? 'Your team' : 'Enemy team',
    entries: list,
  }));
  return blocks.sort((a, b) => Number(b.entries.some((e) => e.isLocal)) - Number(a.entries.some((e) => e.isLocal)));
}

function headerRow(columns: string, hasPerks: boolean): HTMLElement {
  return h('div', { class: 'sb-row sb-row--head', style: { gridTemplateColumns: columns } },
    h('span', null, ''),
    h('span', null, 'Hero'),
    h('span', null, 'Player'),
    hasPerks ? h('span', null, 'Perks') : null,
    ...STATS.map((s) => h('span', { class: 'sb-cell' }, s.label)),
  );
}

function row(e: ScoreboardEntry, columns: string, hasPerks: boolean, best: Map<StatKey, number>, onPlayer?: (name: string) => void): HTMLElement {
  return h('div', {
    class: `sb-row${e.isLocal ? ' is-you' : ''}`,
    style: { gridTemplateColumns: columns },
  },
    h('span', { class: 'sb-role' }, roleIcon(e.role)),
    h('span', { class: 'sb-hero' }, e.hero ?? '—'),
    h('span', { class: 'sb-name' }, nameNode(e, onPlayer), e.isLocal ? h('span', { class: 'sb-you' }, 'you') : null),
    hasPerks ? h('span', { class: 'sb-perks' }, e.perks?.join(', ') || '—') : null,
    ...STATS.map((s) => statCell(e[s.key], s, best.get(s.key))),
  );
}

/** The player name: a drill-down link for identifiable opponents/teammates,
 *  plain text for the tracked player (yourself) or an unidentified slot. */
function nameNode(e: ScoreboardEntry, onPlayer?: (name: string) => void): Node {
  const clickable = onPlayer && !e.isLocal && e.name && e.name !== 'Unknown';
  if (!clickable) return document.createTextNode(e.name);
  return inlineLink(e.name, {
    title: `See the matches you shared with ${e.name}`,
    onClick: (ev) => { ev.stopPropagation(); onPlayer!(e.name); },
  });
}

function statCell(value: number | undefined, col: StatColumn, best: number | undefined): HTMLElement {
  const isBest = value != null && best != null && value === best;
  const text = value == null ? '–' : col.compact ? fmt(value) : String(value);
  // Deaths' "best" is fewest, not most — a plain `.is-best` there would paint
  // it in the same win-green as top damage, so it gets a neutral bold instead
  // (M4): still a highlight, but not one that reads as "good" via colour.
  const cls = isBest ? (col.best === 'min' ? ' is-best-neutral' : ' is-best') : '';
  return h('span', { class: `sb-cell mono${cls}` }, text);
}
