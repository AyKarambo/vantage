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

type StatKey = 'eliminations' | 'assists' | 'deaths' | 'damage' | 'healing' | 'mitigation';

interface StatColumn {
  key: StatKey;
  label: string;
  compact: boolean;
}

const STATS: StatColumn[] = [
  { key: 'eliminations', label: 'E', compact: false },
  { key: 'assists', label: 'A', compact: false },
  { key: 'deaths', label: 'D', compact: false },
  { key: 'damage', label: 'DMG', compact: true },
  { key: 'healing', label: 'HEAL', compact: true },
  { key: 'mitigation', label: 'MIT', compact: true },
];

/**
 * @param onPlayer optional drill-down for a non-local player's name — when
 *   supplied, each opponent/teammate name renders as a link that calls it with
 *   the player's name (the tracked player's own row stays plain).
 */
export function scoreboard(entries: ScoreboardEntry[], onPlayer?: (name: string) => void): HTMLElement {
  // Perks are not in the feed today — the column only exists if data ever shows up.
  const hasPerks = entries.some((e) => e.perks?.length);
  const columns = `28px minmax(90px, 130px) minmax(0, 1fr)${hasPerks ? ' minmax(70px, 110px)' : ''} repeat(3, 42px) repeat(3, 58px)`;
  // Best per column across everyone on the board, like the in-game TAB screen.
  const best = new Map<StatKey, number>();
  for (const s of STATS) {
    const max = Math.max(...entries.map((e) => e[s.key] ?? -1));
    if (max > 0) best.set(s.key, max);
  }

  const teams = groupTeams(entries);
  const blocks: Node[] = [headerRow(columns, hasPerks)];
  teams.forEach((team, i) => {
    if (i > 0) blocks.push(h('div', { class: 'sb-vs' }, h('span', null, 'VS')));
    blocks.push(h('div', { class: 'sb-team-label' }, team.label));
    blocks.push(...team.entries.map((e) => row(e, columns, hasPerks, best, onPlayer)));
  });
  if (teams.length === 1) {
    blocks.push(
      h('div', { class: 'sb-vs' }, h('span', null, 'VS')),
      h('div', { class: 'sb-note' }, 'Enemy team not reported by the game feed.'),
    );
  }
  return h('div', { class: 'scoreboard' }, ...blocks);
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
  return h('button', {
    class: 'inline-link',
    title: `See the matches you shared with ${e.name}`,
    on: { click: (ev) => { ev.stopPropagation(); onPlayer!(e.name); } },
  }, e.name);
}

function statCell(value: number | undefined, col: StatColumn, best: number | undefined): HTMLElement {
  const isBest = value != null && best != null && value === best;
  const text = value == null ? '–' : col.compact ? fmt(value) : String(value);
  return h('span', { class: `sb-cell mono${isBest ? ' is-best' : ''}` }, text);
}
