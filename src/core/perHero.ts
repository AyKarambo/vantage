/**
 * Per-hero merge and per-10-minute math for one match's local-player lines.
 *
 * GEP reports a fresh roster row on every hero swap, so a Tracer → Genji → Tracer
 * match yields three segments — two of them the same hero. {@link mergeHeroStats}
 * collapses those into one line per hero (summing counting stats and on-hero
 * minutes); {@link heroLines} turns the merged lines into the presentation shape
 * the match-detail panel renders. Pure and I/O-free (guardrail #3) so both the
 * aggregator (new matches) and the read path (existing records) share one merge.
 */
import type { HeroStat, Role } from './model';

/**
 * Merge same-hero segments into one line per hero, summing every counting stat
 * and the on-hero minutes, keeping first-seen order and the first role observed.
 * Idempotent: merging already-merged input is a no-op.
 */
export const MIN_PLAYED_SECONDS = 60;

/**
 * A hero segment counts as genuinely "played" when it has at least a minute of
 * tracked time, or any evidence of actual combat activity even under a minute
 * (a quick death or a lucky elimination) — the proxy this app uses for "not
 * just a spawn-room swap before the round started". A missing `minutes` (as
 * on manually-logged entries, which never reach this function today) is
 * treated the same as zero — only the stat-evidence branch can still qualify it.
 */
export function isPlayedSegment(stat: HeroStat): boolean {
  if ((stat.minutes ?? 0) * 60 >= MIN_PLAYED_SECONDS) return true;
  return (
    stat.eliminations > 0 ||
    stat.deaths > 0 ||
    stat.assists > 0 ||
    stat.damage > 0 ||
    stat.healing > 0 ||
    stat.mitigation > 0
  );
}

export function mergeHeroStats(perHero: HeroStat[]): HeroStat[] {
  const order: string[] = [];
  const byHero = new Map<string, HeroStat>();
  for (const s of perHero) {
    const existing = byHero.get(s.hero);
    if (!existing) {
      order.push(s.hero);
      byHero.set(s.hero, { ...s });
      continue;
    }
    existing.eliminations += s.eliminations;
    existing.deaths += s.deaths;
    existing.assists += s.assists;
    existing.damage += s.damage;
    existing.healing += s.healing;
    existing.mitigation += s.mitigation;
    existing.role = existing.role ?? s.role;
    if (s.minutes != null) existing.minutes = (existing.minutes ?? 0) + s.minutes;
  }
  return order.map((h) => byHero.get(h)!);
}

/** Per-10-minute counting-stat rates (raw numbers; the renderer rounds). */
export interface PerTen {
  eliminations: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  mitigation: number;
}

/** A merged hero's presentation line for the match-detail per-hero panel. */
export interface HeroLine {
  hero: string;
  role?: Role;
  /** Raw match totals for this hero. */
  totals: PerTen;
  /** (elims + assists) / max(deaths, 1) — always shown, even without minutes. */
  kda: number;
  /** Effective on-hero minutes (real, else an equal split); null when unknowable. */
  minutes: number | null;
  /** Per-10 rates, or null when the match duration is unknown / rounds to 0 (→ dash). */
  per10: PerTen | null;
}

const kdaOf = (s: { eliminations: number; assists: number; deaths: number }): number =>
  (s.eliminations + s.assists) / Math.max(s.deaths, 1);

/**
 * Effective on-hero minutes for the per-10 divisor: the recorded minutes when
 * present and positive, otherwise an equal split of `playedMinutes` — the
 * match's PLAYED time (see {@link ./playedTime}), never the wall clock — across
 * the hero lines. Null when the played time is unknown or is 0 — in which case
 * the counting stats show a dash (KDA still renders). Callers pass hero rows
 * whose `minutes` are already on the same played-time basis (the aggregator
 * writes them that way; `matchDetail` normalizes older records).
 */
export function effectiveHeroMinutes(
  hero: HeroStat,
  heroCount: number,
  playedMinutes: number | undefined,
): number | null {
  if (playedMinutes == null || playedMinutes <= 0 || heroCount <= 0) return null;
  if (hero.minutes != null && hero.minutes > 0) return hero.minutes;
  return playedMinutes / heroCount;
}

function per10Of(hero: HeroStat, minutes: number | null): PerTen | null {
  if (minutes == null || minutes <= 0) return null;
  const r = 10 / minutes;
  return {
    eliminations: hero.eliminations * r,
    deaths: hero.deaths * r,
    assists: hero.assists * r,
    damage: hero.damage * r,
    healing: hero.healing * r,
    mitigation: hero.mitigation * r,
  };
}

/**
 * Merge same-hero segments, then compute each hero's presentation line: raw
 * totals, KDA ratio, effective on-hero minutes and per-10 rates. `playedMinutes`
 * is the match's played time (the per-10 divisor), which the equal-split
 * fallback divides. The renderer only formats the numbers this returns.
 */
export function heroLines(perHero: HeroStat[], playedMinutes: number | undefined): HeroLine[] {
  const merged = mergeHeroStats(perHero);
  return merged.map((s) => {
    const minutes = effectiveHeroMinutes(s, merged.length, playedMinutes);
    return {
      hero: s.hero,
      role: s.role,
      totals: {
        eliminations: s.eliminations,
        deaths: s.deaths,
        assists: s.assists,
        damage: s.damage,
        healing: s.healing,
        mitigation: s.mitigation,
      },
      kda: kdaOf(s),
      minutes,
      per10: per10Of(s, minutes),
    };
  });
}

/**
 * The whole-match aggregate line for the "All" tab: every hero's counting stats
 * summed, KDA over the combined totals, and per-10 over the match's full
 * played time (all heroes together span it). Its `hero` label is `'All'`.
 * Returns `null` when there are no hero lines. Reuses {@link heroLines} so the
 * per-10 math and dash behaviour stay identical to the per-hero tabs.
 */
export function combinedHeroLine(perHero: HeroStat[], playedMinutes: number | undefined): HeroLine | null {
  if (!perHero.length) return null;
  const total = mergeHeroStats(perHero).reduce<HeroStat>(
    (a, s) => {
      a.eliminations += s.eliminations;
      a.deaths += s.deaths;
      a.assists += s.assists;
      a.damage += s.damage;
      a.healing += s.healing;
      a.mitigation += s.mitigation;
      return a;
    },
    { hero: 'All', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 },
  );
  // One synthetic hero spanning the whole match → per-10 divides by playedMinutes.
  return heroLines([total], playedMinutes)[0];
}
