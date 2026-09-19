/**
 * Live — the match you are in right now.
 *
 * Three parts: the live scoreboard (the same component the stored match detail
 * uses, fed from the GEP roster as it ticks), an elimination tally from the kill
 * feed, and the players on this roster you have met before, split into your
 * record WITH them and AGAINST them.
 *
 * ## No score, and why
 *
 * Overwatch's event feed reports no objective score of any kind — the documented
 * `match_info` updates are map, match id, outcome and a Stadium-only round
 * outcome. So this shows an ELIMINATION count derived from the kill feed and
 * labels it as one. Inventing a scoreline from what the feed does give would be
 * exactly the sort of fabrication guardrail #1 exists to prevent.
 */
import { h, render } from '../dom';
import type { DashboardData, LiveMatchPayload, PlayerRecord, TargetSummary } from '../../../src/shared/contract';
import { dayPartAt } from '../../../src/core/analytics';
import { bridge } from '../bridge';
import { getLiveMatch, subscribeLiveMatch } from '../liveMatch';
import { getGepStatus, subscribeGepStatus } from '../gepStatus';
import { scoreboard } from '../components/scoreboard';
import { button, card, emptyState, pill, resultPill } from '../components/primitives';
import { inlineLink } from '../components/inlineLink';
import { fmt, games, net, pct, relTime, RELATION_LABEL } from '../format';
import { wrColor } from '../theme';
import { readinessCard } from './overview';
import { stopRuleLine } from '../components/stopRuleLine';
import { viewHead, type ViewContext } from './view';

export function live(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });

  /**
   * A live board repaints about once a second. Replacing the subtree between a
   * pointerdown and its pointerup makes the browser drop the click (they must
   * share a target) — and every player name here is a link into their history,
   * so that would be the normal case, not a corner one. The shell's own press
   * guard only covers renders it drives, so this view keeps its own: defer the
   * repaint while a pointer is held, and flush it on release.
   */
  let pressed = false;
  let pendingPaint = false;
  host.addEventListener('pointerdown', () => { pressed = true; }, true);
  const release = (): void => {
    if (!pressed) return;
    pressed = false;
    if (!pendingPaint) return;
    pendingPaint = false;
    // A macrotask runs after the native click that follows pointerup, so this
    // never removes the element that click still needs.
    setTimeout(paint, 0);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);

  /** Known-player records, refetched only when the roster's names change. */
  let records: PlayerRecord[] = [];
  let recordsKey = '';
  let recordsLoading = false;

  const refreshRecords = (payload: LiveMatchPayload | null): void => {
    const names = (payload?.roster ?? [])
      .filter((p) => !p.isLocal && p.name && p.name !== 'Unknown')
      .map((p) => p.name);
    const key = names.join('|');
    if (key === recordsKey) return;
    recordsKey = key;
    if (!names.length) {
      records = [];
      return;
    }
    recordsLoading = true;
    void bridge.playerRecords(names).then((rows) => {
      // A later roster may have superseded this request while it was in flight.
      if (recordsKey !== key) return;
      records = rows;
      recordsLoading = false;
      paint();
    }).catch(() => { recordsLoading = false; });
  };

  function paint(): void {
    if (pressed) { pendingPaint = true; return; }
    const payload = getLiveMatch();
    render(host, ...sections(payload, records, recordsLoading, ctx));
  }

  const unsubscribe = subscribeLiveMatch((payload) => {
    // Self-cleaning: views are rebuilt on navigation and there is no unmount
    // hook, so the subscription drops itself once its host leaves the DOM.
    if (!host.isConnected) {
      unsubscribe();
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      unsubscribeGep();
      return;
    }
    refreshRecords(payload);
    paint();
  });
  // Repaints the stale-feed card (S6) the moment the feed goes quiet or
  // recovers, rather than waiting for the next unrelated live-match tick.
  const unsubscribeGep = subscribeGepStatus(() => { if (host.isConnected) paint(); });

  refreshRecords(getLiveMatch());
  paint();
  return host;
}

function sections(
  p: LiveMatchPayload | null,
  records: PlayerRecord[],
  recordsLoading: boolean,
  ctx: ViewContext,
): Node[] {
  if (!p?.live) {
    // A very-recently-ended match gets its own card with a direct link to
    // where it landed (S2); anything older falls back to the plain idle
    // copy below — `endedAt` stays set until the next match starts, so
    // without this a match from hours ago would still claim to have "just"
    // finished.
    const justFinished = p?.endedAt && Date.now() - p.endedAt < JUST_FINISHED_WINDOW_MS
      ? justFinishedCard(p, ctx)
      : null;
    return [
      viewHead('Live', idleSubtitle(p)),
      justFinished ?? idleCard(p),
      ...preQueueCards(ctx),
    ];
  }
  return [
    viewHead('Live', liveSubtitle(p)),
    getGepStatus()?.state === 'stale' ? staleCard(ctx) : null,
    tallyCard(p),
    card({ variant: 'raised' },
      h('div', { class: 'review-section-label' }, 'Scoreboard'),
      p.roster.length
        ? scoreboard(p.roster, (name) => ctx.navigate('playerHistory', { playerName: name }))
        : h('div', { class: 'hint' }, 'Waiting for the game to report the scoreboard…'),
    ),
    knownPlayersCard(p, records, recordsLoading, ctx),
    p.feed.length ? feedCard(p) : null,
  ].filter((n): n is HTMLElement => n != null);
}

function liveSubtitle(p: LiveMatchPayload): string {
  const parts = [p.map ?? 'Map not reported yet'];
  if (p.gameType) parts.push(p.gameType);
  if (p.startedAt) parts.push(`started ${relTime(p.startedAt)}`);
  return parts.join(' · ');
}

function idleSubtitle(p: LiveMatchPayload | null): string {
  return p?.endedAt ? `Last match ended ${relTime(p.endedAt)}` : 'Nothing in progress';
}

/** Prepended to the live-match branch while the feed has gone quiet (S6) —
 *  the app-wide banner (shell.ts `renderGepBanner`) says the same thing on
 *  every screen, but Live is where a stalled scoreboard actually needs the
 *  context right next to it. */
function staleCard(ctx: ViewContext): HTMLElement {
  return card({ variant: 'raised' },
    h('div', { class: 'hint', style: { lineHeight: '1.5' } },
      'No data from the game for a while — the scoreboard below may be behind. ',
      inlineLink('Open Logs →', { onClick: () => ctx.navigate('logs') }),
    ),
  );
}

function idleCard(p: LiveMatchPayload | null): HTMLElement {
  return card({ variant: 'raised' }, emptyState(
    p?.endedAt
      ? 'That match is over — it’s in Matches now. This screen fills in again the moment the next one starts.'
      : 'No match in progress. Queue up and this fills in live — the scoreboard, and who on it you’ve played with before.',
    true,
  ));
}

/** How long after a match ends {@link justFinishedCard} replaces the plain idle copy (S2). */
const JUST_FINISHED_WINDOW_MS = 30 * 60_000;

/**
 * A direct link to the match that JUST ended, so alt-tabbing back doesn't land
 * on a screen that cleared everything with nowhere to go (S2). Checks the
 * review inbox first (unfiltered) since a fresh tracked game lands there,
 * then the filtered match list, then the held-pending set (a competitive
 * match GEP delivered with no win/loss), for a row timestamped at/after
 * `endedAt` minus a small grace window for clock skew between the two writes.
 */
function justFinishedCard(p: LiveMatchPayload, ctx: ViewContext): HTMLElement {
  const cutoff = p.endedAt! - 5 * 60_000;
  const found = ctx.data.reviewInbox.find((m) => m.timestamp >= cutoff)
    ?? ctx.data.matches.find((m) => m.timestamp >= cutoff);
  if (found) {
    const inInbox = ctx.data.reviewInbox.some((m) => m.matchId === found.matchId);
    return card({ variant: 'raised' },
      h('div', { class: 'review-section-label' }, 'Just finished'),
      h('div', { class: 'row', style: { padding: '2px 0' } },
        resultPill(found.result),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, found.map),
          h('div', { class: 'row-meta' }, found.heroes.join(', ') || '—'),
        ),
        found.eliminations !== undefined
          ? h('span', { class: 'mono u-dim', style: { fontSize: '11px' }, title: 'Eliminations / Assists / Deaths' },
              `${found.eliminations}/${found.assists}/${found.deaths}`)
          : null,
      ),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
        button('Open match →', { variant: 'soft', onClick: () => ctx.navigate('matchDetail', { matchId: found.matchId }) }),
        inInbox ? button('Grade it on Review →', { variant: 'soft', onClick: () => ctx.navigate('review') }) : null,
      ),
    );
  }
  // No recorded row yet — a competitive match GEP delivered with no win/loss
  // is held separately (never in history/analytics until confirmed), so it
  // never shows up in reviewInbox/matches at all.
  const pending = ctx.data.pendingMatches.find((m) => m.timestamp >= cutoff);
  if (pending) {
    return card({ variant: 'raised' },
      h('div', { class: 'review-section-label' }, 'Just finished'),
      h('div', { class: 'row', style: { padding: '2px 0' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, pending.map),
          h('div', { class: 'row-meta' }, pending.heroes.join(', ') || '—'),
        ),
      ),
      h('div', { class: 'hint', style: { marginTop: '4px', lineHeight: '1.5' } },
        'The game didn’t report a win or loss for this one.'),
      h('div', { style: { marginTop: '10px' } },
        button('Set result on Review →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('review') }),
      ),
    );
  }
  // The refetch this match triggers hasn't landed yet, or it fell outside
  // the current filter scope — still say where it went instead of nothing.
  return card({ variant: 'raised' },
    emptyState('That match is over — it’s in Matches now.', true),
    h('div', { style: { marginTop: '10px' } },
      button('Open Matches →', { variant: 'soft', class: 'btn--block', onClick: () => ctx.navigate('matches') }),
    ),
  );
}

/**
 * The idle screen's "before you queue" briefing (S1): everything a player
 * would otherwise gather from four different screens before their next
 * game, assembled from data the dashboard snapshot already carries — no new
 * IPC. Live is filterless (`FILTERLESS_VIEWS`), so these read the unscoped
 * shape of each field rather than pretending the hidden filter bar applies.
 */
function preQueueCards(ctx: ViewContext): HTMLElement[] {
  const d = ctx.data;
  const cards: HTMLElement[] = [];

  const sensor = getGepStatus()?.sensor;
  if (d.isSample || sensor !== 'gep') {
    cards.push(card({ variant: 'raised' },
      h('div', { class: 'hint', style: { lineHeight: '1.5' } },
        d.isSample
          ? 'You’re on demo data — this screen only fills in from Overwatch’s own game feed, so sample data never produces a live match. '
          : 'Live tracking needs Overwolf’s Game Events feed and Dev Mode approval. ',
        inlineLink('What live tracking needs →', { onClick: () => ctx.navigate('faq') }),
      ),
    ));
  }

  cards.push(beforeYouQueueCard(d, ctx));
  const rc = readinessCard(ctx);
  if (rc) cards.push(rc);
  const priority = d.focusMaps.filter((f) => f.net > 0).slice(0, 3);
  if (priority.length) cards.push(priorityCard(priority, ctx));

  return cards;
}

/** This sitting, the time-of-day read, and the targets worth executing tonight. */
function beforeYouQueueCard(d: DashboardData, ctx: ViewContext): HTMLElement {
  const s = d.session;
  const active = d.targets.filter((t) => t.isActive);
  const dayPart = dayPartAt(new Date().getHours());
  const window = d.timeOfDay.find((g) => g.key === dayPart);

  return card({ variant: 'raised', title: 'Before you queue' },
    s
      ? h('div', { class: 'row', style: { padding: '2px 0', cursor: 'pointer' }, on: { click: () => ctx.navigate('matches', { day: s.date }) } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-name' }, `${s.wins}W ${s.losses}L this sitting`),
            h('div', { class: 'row-meta' }, `${net(s.wins - s.losses)} · ${s.topMaps[0]?.key ?? 'no repeats yet'}`),
          ),
          h('span', { class: 'u-dim', style: { fontSize: '11px' } }, 'Open today’s matches →'),
        )
      : h('div', { class: 'hint' }, 'No games yet today — this fills in once you’ve logged your first.'),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      window && window.wins + window.losses >= 5
        ? `It’s ${dayPart.toLowerCase()} — you’re ${pct(window.winrate)} over ${window.wins + window.losses} decided ${dayPart.toLowerCase()} games.`
        : `It’s ${dayPart.toLowerCase()} — not enough ${dayPart.toLowerCase()} games yet to say how you do then.`),
    stopRuleLine(ctx),
    active.length
      ? h('div', { class: 'stack', style: { gap: '6px', marginTop: '10px' } },
          h('div', { class: 'u-muted', style: { fontSize: '11px' } }, 'Focus this game'),
          ...active.slice(0, 3).map((t) => targetRow(t, ctx)),
        )
      : null,
  );
}

function targetRow(t: TargetSummary, ctx: ViewContext): HTMLElement {
  return h('div', {
    class: 'row',
    style: { padding: '2px 0', cursor: 'pointer' },
    on: { click: () => ctx.navigate('targetDetail', { targetId: t.id }) },
  },
    h('div', { class: 'row-main', style: { fontSize: '12.5px' } }, t.name),
    h('span', { class: 'mono', style: { fontSize: '12px' } }, t.attempts ? pct(t.hitRate) : 'New'),
  );
}

/** The season's net-losing maps — the same read as Overview's scatter callout,
 *  compacted to a plain card since Live has no scatter chart to sit beside. */
function priorityCard(items: DashboardData['focusMaps'], ctx: ViewContext): HTMLElement {
  return card({ variant: 'raised', title: 'Top priority' },
    h('div', { class: 'stack', style: { gap: '8px' } },
      ...items.map((m) => h('div', {
        class: 'row', style: { cursor: 'pointer' },
        on: { click: () => ctx.navigate('matches', { map: m.key }) },
      },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, m.key),
          h('div', { class: 'row-meta' }, `${games(m.games)} · ${net(m.wins - m.losses)}`),
        ),
        h('span', { class: 'mono', style: { fontSize: '13px', color: wrColor(m.winrate) } }, pct(m.winrate)),
      )),
    ),
  );
}

/**
 * The elimination tally. Deliberately NOT called a score anywhere: Overwatch's
 * feed reports no objective score, and this is a kill count. When the feed never
 * said which side an attacker was on, nothing is shown at all — a 0–0 would read
 * as "nobody has died yet", which is a different (and wrong) claim.
 */
function tallyCard(p: LiveMatchPayload): HTMLElement | null {
  // Eliminations come from the kill feed; damage and healing from the roster —
  // so the two halves appear independently. With the kill feed switched off the
  // damage and healing rows stay, because they are TAB-screen numbers the game
  // is showing, not anything derived from kill events.
  const rows: Array<{ label: string; yours: number; theirs: number; compact: boolean }> = [];
  if (p.kills.known) rows.push({ label: 'eliminations', yours: p.kills.yours, theirs: p.kills.theirs, compact: false });
  if (p.totals.known) {
    rows.push({ label: 'damage', yours: p.totals.yours.damage, theirs: p.totals.theirs.damage, compact: true });
    rows.push({ label: 'healing', yours: p.totals.yours.healing, theirs: p.totals.theirs.healing, compact: true });
  }
  if (!rows.length) return null;

  return card({ variant: 'raised' },
    // The "this is not the score" caveat is a tooltip rather than a line of body
    // copy now: with three labelled stats side by side nothing reads as a
    // scoreline, but Overwatch's feed reporting no objective score is still
    // worth being able to find.
    h('div', {
      class: 'live-tally',
      title: 'Totals from the game’s own scoreboard. Overwatch’s event feed reports no objective score, so this is not one.',
    },
      h('div', { class: 'u-dim live-tally-head' }, 'your team'),
      h('span', null),
      h('div', { class: 'u-dim live-tally-head' }, 'enemy team'),
      ...rows.flatMap((r) => tallyRow(r)),
    ),
  );
}

/**
 * One `yours · label · theirs` row. Both sides keep their team colour; the side
 * that is AHEAD keeps full weight and the other is dimmed, so "who has more"
 * reads without adding a second colour language on top of the team one.
 */
function tallyRow(r: { label: string; yours: number; theirs: number; compact: boolean }): Node[] {
  const text = (n: number): string => (r.compact ? fmt(n) : String(n));
  const value = (n: number, tone: string, leads: boolean): HTMLElement =>
    h('div', {
      class: 'mono live-tally-value',
      style: { color: tone, opacity: leads ? '1' : '0.5', fontWeight: leads ? '600' : '500' },
    }, text(n));
  return [
    value(r.yours, 'var(--win-text)', r.yours >= r.theirs),
    h('div', { class: 'u-dim live-tally-label' }, r.label),
    value(r.theirs, 'var(--loss-text)', r.theirs >= r.yours),
  ];
}

/**
 * The players on this roster you have met before, and how those games went.
 *
 * "with" and "vs" describe THIS match's team relation — which side they are on
 * right now — while the W-L behind each is your record from the games you
 * actually shared. Both halves are shown when history has both, because "3–1
 * with them, 0–4 against them" is the interesting shape.
 */
function knownPlayersCard(
  p: LiveMatchPayload,
  records: PlayerRecord[],
  loading: boolean,
  ctx: ViewContext,
): HTMLElement {
  const body = (): Node => {
    if (!p.teamsKnown && !records.length) {
      return h('div', { class: 'hint' },
        'The game feed hasn’t reported teams for this match, so Vantage can’t tell who’s with you and who’s against you.');
    }
    if (loading && !records.length) return h('div', { class: 'hint' }, 'Checking your history…');
    if (!records.length) {
      return h('div', { class: 'hint' }, 'Nobody here you’ve played with before — or the feed hasn’t named them yet.');
    }
    const sideOf = new Map(p.roster.map((r) => [r.name, r.team]));
    const mine = p.roster.find((r) => r.isLocal)?.team;
    return h('div', { class: 'stack', style: { gap: '8px' } },
      ...records.map((r) => {
        const team = sideOf.get(r.name);
        // The relation is about THIS match; absent when the feed didn't say.
        const withYou = mine !== undefined && team !== undefined ? team === mine : undefined;
        return playerRow(r, withYou, ctx);
      }),
    );
  };
  return card({ variant: 'raised' },
    h('div', { class: 'review-section-label' }, 'Players you’ve met'),
    body(),
  );
}

function playerRow(r: PlayerRecord, withYou: boolean | undefined, ctx: ViewContext): HTMLElement {
  const wl = (s: { wins: number; losses: number }): string => `${s.wins}W ${s.losses}L`;
  const both = r.sameTeam.wins + r.sameTeam.losses > 0 && r.enemyTeam.wins + r.enemyTeam.losses > 0;
  const stats: Node[] = [];
  if (r.sameTeam.wins + r.sameTeam.losses > 0) {
    stats.push(pill(`with ${wl(r.sameTeam)}`, withYou === true ? 'accent' : undefined));
  }
  if (r.enemyTeam.wins + r.enemyTeam.losses > 0) {
    stats.push(pill(`vs ${wl(r.enemyTeam)}`, withYou === false ? 'accent' : undefined));
  }
  if (!stats.length) {
    // Met, but never in a game with a decided result and a known team relation.
    stats.push(h('span', { class: 'u-dim', style: { fontSize: '11.5px' } }, 'no decided games together'));
  }
  return h('div', { class: 'review-row' },
    h('span', {
      class: 'pill',
      title: withYou === undefined ? 'Team not reported this match' : withYou ? 'On your team now' : 'On the enemy team now',
      style: { minWidth: '38px', textAlign: 'center' },
    }, withYou === undefined ? '—' : withYou ? RELATION_LABEL.with.short : RELATION_LABEL.against.short),
    h('div', { class: 'row-main', style: { minWidth: '0' } },
      inlineLink(r.name, {
        style: { fontSize: '13px' },
        onClick: () => ctx.navigate('playerHistory', { playerName: r.name }),
      }),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
        `${r.encounters} shared ${r.encounters === 1 ? 'match' : 'matches'} · last ${relTime(r.lastSeen)}`),
    ),
    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, ...stats),
    both ? null : null,
  );
}

/** The recent kill feed. Only rendered when the user has it switched on. */
function feedCard(p: LiveMatchPayload): HTMLElement {
  return card({ variant: 'raised' },
    h('div', { class: 'review-section-label' }, 'Recent'),
    h('div', { class: 'stack', style: { gap: '4px' } },
      ...p.feed.map((k) => h('div', {
        class: 'u-dim',
        style: { fontSize: '11.5px', display: 'flex', gap: '6px', alignItems: 'baseline' },
      },
        h('span', {
          style: {
            color: k.attackerFriendly === undefined ? 'var(--text-2)'
              : k.attackerFriendly ? 'var(--win-text)' : 'var(--loss-text)',
          },
        // A distinct glyph per kind, so a destroyed turret never reads as a kill
        // at a glance any more than it counts as one.
        }, k.revive ? '✚' : k.deployable ? '⨯' : '▸'),
        h('span', null, killLine(k)),
      )),
    ),
  );
}

function killLine(k: LiveMatchPayload['feed'][number]): string {
  const who = (name?: string, hero?: string): string =>
    name && hero ? `${name} (${hero})` : name ?? hero ?? 'someone';
  if (k.revive) return `${who(k.attacker, k.attackerHero)} revived ${who(k.victim, k.victimHero)}`;
  // A destroyed deployable belongs to its owner, and reads as a possessive
  // rather than as one player killing another — because nobody died.
  if (k.deployable) {
    const owner = k.victim ? `${k.victim}’s ` : '';
    return `${who(k.attacker, k.attackerHero)} destroyed ${owner}${k.deployable.label}`;
  }
  return `${who(k.attacker, k.attackerHero)} → ${who(k.victim, k.victimHero)}`;
}
