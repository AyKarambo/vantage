/**
 * Match detail — the parameterized drill-down behind a Matches row click.
 * Every section renders only when its data exists, so the page degrades
 * tier-by-tier: a minimal legacy record still gets a full header, richer
 * records add scoreboard, tabs, progress, player history, and screenshots.
 * No share/publish affordance anywhere (spec: Share URL is out of scope).
 */
import { h, render } from '../dom';
import type { HeroStat, MatchDetail, PlayerEncounter } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { fmt, relTime, roleLabel, rankLabel, signed } from '../format';
import { button, card, pill, RESULT_STATE, segmented, statBar, statBox } from '../components/primitives';
import { scoreboard } from '../components/scoreboard';
import { PALETTE } from '../theme';
import type { ViewContext } from './view';

const RESULT_TEXT: Record<string, string> = { Win: 'Victory', Loss: 'Defeat', Draw: 'Draw' };

export function matchDetail(ctx: ViewContext): HTMLElement {
  const host = h('div', { class: 'view' });
  const matchId = ctx.params.matchId;
  if (!matchId) {
    render(host, backRow(ctx), card({}, h('div', { class: 'empty' }, 'No match selected.')));
    return host;
  }
  render(host, backRow(ctx), card({}, h('div', { class: 'hint' }, 'Loading match…')));
  bridge.matchDetail(matchId, ctx.data.filters).then((d) => {
    if (!d) {
      render(host, backRow(ctx), card({}, h('div', { class: 'empty' }, 'This match is no longer in your history.')));
      return;
    }
    render(host, backRow(ctx), ...sections(d));
  });
  return host;
}

function backRow(ctx: ViewContext): HTMLElement {
  return h('div', null, button('← Matches', { variant: 'ghost', onClick: () => ctx.navigate('matches') }));
}

function sections(d: MatchDetail): Node[] {
  return [
    header(d),
    scoreboardSection(d),
    perHeroSection(d.perHero),
    competitiveSection(d.competitive),
    playerHistorySection(d),
    screenshotsSection(d.screenshots),
  ].filter((n): n is HTMLElement => n != null);
}

// --- header (always renders — derives from fields every record has) ----------

function header(d: MatchDetail): HTMLElement {
  const state = RESULT_STATE[d.result];
  const meta = h('div', { class: 'detail-meta' },
    pill(d.mapType, 'accent'),
    h('span', null, d.gameType),
    h('span', null, '·'),
    h('span', null, `${roleLabel(d.role)} · ${d.account}`),
    h('span', null, '·'),
    h('span', null, relTime(d.timestamp)),
  );
  const flags = mentalFlags(d);
  return card({ class: 'detail-head' },
    h('div', { class: 'detail-head-main' },
      h('div', { class: `detail-result is-${state}` }, RESULT_TEXT[d.result] ?? d.result),
      h('h1', { class: 'detail-map' }, d.map),
      meta,
      flags,
    ),
    h('div', { class: 'detail-head-side' },
      d.finalScore ? statBox(h('span', { class: 'mono' }, d.finalScore), 'Round score') : null,
      d.durationMinutes != null ? statBox(`${d.durationMinutes}m`, 'Duration') : null,
      d.heroes.length
        ? h('div', { class: 'detail-heroes' },
            h('div', { class: 'stat-box-label' }, 'Heroes played'),
            h('div', { class: 'detail-hero-pills' }, ...d.heroes.map((name) => pill(name))),
          )
        : null,
    ),
  );
}

function mentalFlags(d: MatchDetail): HTMLElement | null {
  const m = d.mental;
  if (!m) return null;
  const flags: Node[] = [];
  if (m.tilt) flags.push(pill('Tilt', 'loss'));
  if (m.toxicMates) flags.push(pill('Toxic mates', 'loss'));
  if (m.leaver) flags.push(pill('Leaver', 'draw'));
  if (m.positiveComms) flags.push(pill('Positive comms', 'win'));
  return flags.length ? h('div', { class: 'detail-flags' }, ...flags) : null;
}

// --- scoreboard (roster tier → full board; per-hero tier → your rows only) ---

function scoreboardSection(d: MatchDetail): HTMLElement | null {
  if (!d.scoreboard?.length) return null;
  const localOnly = d.scoreboard.every((e) => e.isLocal);
  return card(
    {
      title: 'Scoreboard',
      sub: localOnly ? 'only your own line was recorded for this match' : 'as reported by the game feed',
      class: 'card--flush detail-scoreboard',
    },
    scoreboard(d.scoreboard),
  );
}

// --- per-hero tabs ------------------------------------------------------------

function perHeroSection(perHero: HeroStat[]): HTMLElement | null {
  if (!perHero.length) return null;
  const body = h('div', { class: 'stat-grid stat-grid--wide' });
  const draw = (hero: string): void => {
    const s = perHero.find((x) => x.hero === hero) ?? perHero[0];
    const kda = (s.eliminations + s.assists) / Math.max(s.deaths, 1);
    render(body,
      statBox(String(s.eliminations), 'Eliminations'),
      statBox(String(s.assists), 'Assists'),
      statBox(String(s.deaths), 'Deaths'),
      statBox(kda.toFixed(1), 'KDA'),
      statBox(fmt(s.damage), 'Damage'),
      statBox(fmt(s.healing), 'Healing'),
      statBox(fmt(s.mitigation), 'Mitigation'),
    );
  };
  draw(perHero[0].hero);
  const tabs = perHero.length > 1
    ? segmented({
        options: perHero.map((s) => ({ value: s.hero, label: s.hero })),
        value: perHero[0].hero,
        onChange: draw,
      })
    : null;
  return card({ title: 'Per hero', sub: 'your line on each hero this match', actions: tabs }, body);
}

// --- competitive progress (estimate — the feed does not report rank) ----------

function competitiveSection(c: MatchDetail['competitive']): HTMLElement | null {
  if (!c) return null;
  const estimate = c.note === 'estimate';
  const withinDivision = c.sr != null ? (c.sr % 100) / 100 : null;
  return card(
    {
      title: 'Competitive progress',
      sub: estimate ? 'estimated from recent results — the game feed does not report rank' : 'reported by the game feed',
      actions: pill(estimate ? 'Estimate' : 'Reported', 'accent'),
    },
    h('div', { class: 'detail-progress' },
      c.tier != null && c.division != null
        ? h('span', { class: 'detail-rank' }, rankLabel(c.tier, c.division))
        : null,
      withinDivision != null
        ? statBar({ label: 'Division', frac: withinDivision, valueText: String(c.sr), color: PALETTE.accent })
        : null,
      c.delta != null
        ? h('span', {
            class: 'mono',
            style: { fontSize: '12px', color: c.delta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' },
          }, `${signed(c.delta)} over the range`)
        : null,
    ),
  );
}

// --- player history -------------------------------------------------------------

function playerHistorySection(d: MatchDetail): HTMLElement {
  const hasRoster = Boolean(d.scoreboard?.some((e) => !e.isLocal));
  const body = d.playerHistory.length
    ? d.playerHistory.map(encounterRow)
    : [h('div', { class: 'hint' },
        hasRoster
          ? 'No players from this match in your tracked history yet.'
          : 'No roster was recorded for this match.',
      )];
  return card({ title: 'Player history', sub: 'players from this match you have met before' }, ...body);
}

function encounterRow(p: PlayerEncounter): HTMLElement {
  const wl = p.results ? ` · ${p.results.wins}W ${p.results.losses}L together` : '';
  return h('div', { class: 'row' },
    h('span', { class: 'row-main', style: { fontSize: '12.5px', fontWeight: '500' } }, p.name),
    h('span', { class: 'u-muted', style: { fontSize: '11.5px' } },
      `${p.encounters} prior ${p.encounters === 1 ? 'match' : 'matches'}${wl}`),
    h('span', { class: 'u-dim mono', style: { fontSize: '11px', minWidth: '46px', textAlign: 'right' } },
      relTime(p.lastSeen)),
  );
}

// --- screenshots gallery ---------------------------------------------------------

function screenshotsSection(shots: string[]): HTMLElement {
  if (!shots.length) {
    // Collapsed: the section is reserved, not populated (capture is best-effort).
    return card({ title: 'Screenshots', sub: 'end-of-match captures' },
      h('div', { class: 'hint' }, 'No screenshots were captured for this match.'));
  }
  return card({ title: 'Screenshots', sub: 'end-of-match captures' },
    h('div', { class: 'shot-grid' },
      ...shots.map((src) => h('img', { class: 'shot', src, alt: 'End-of-match screenshot', loading: 'lazy' })),
    ),
  );
}
