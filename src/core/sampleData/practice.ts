import type { GameRecord, TargetGrade } from '../analytics';
import type { CheckInEnergy, CheckInMood, CheckInSleep, SessionCheckIn } from '../checkIn';
import { sittingsOf } from '../practice/sittings';
import { mulberry32 } from './generate';

/**
 * The demo season's practice layer (issue #321): focus choices, self-grades,
 * break marks and extended check-ins over the generated games, so Mental's
 * practice cards and the Review recap have something to show on demo data.
 *
 * An OVERLAY with its own seeded stream, applied by the dashboard only to the
 * new practice reads — the generated season itself (and every existing demo
 * number) stays exactly as {@link ./generate generateSampleGames} made it, and
 * the demo Review inbox keeps its ungraded games.
 */

/** The sample library's self-rated targets ({@link ../targets/sampleTargets}). */
const SAMPLE_SELF_TARGETS = ['t-ult', 't-comms'];

/** Games newer than this stay ungraded, so the demo Review inbox isn't empty. */
const KEEP_INBOX_MS = 2 * 24 * 60 * 60_000;

export interface SamplePracticeLayer {
  games: GameRecord[];
  checkIns: SessionCheckIn[];
}

export function samplePracticeLayer(games: readonly GameRecord[], now = Date.now(), seed = 321): SamplePracticeLayer {
  const rnd = mulberry32(seed);
  const pick = <T>(weighted: Array<[T, number]>): T => {
    let r = rnd();
    for (const [v, w] of weighted) {
      if ((r -= w) < 0) return v;
    }
    return weighted[weighted.length - 1][0];
  };
  const out = new Map<string, GameRecord>();
  const checkIns: SessionCheckIn[] = [];

  for (const sitting of sittingsOf(games)) {
    // How the sitting went, as the player rated it — the check-in leans on it
    // so the demo's "What shapes your performance" table has a story to tell.
    const rated = sitting.filter((g) => typeof g.performance === 'number');
    const avg = rated.length ? rated.reduce((a, g) => a + g.performance!, 0) / rated.length : 55;
    const rough = avg < 52;
    if (rnd() < 0.75) {
      const sleep: CheckInSleep = rough ? pick([['poor', 0.55], ['ok', 0.35], ['good', 0.1]]) : pick([['good', 0.5], ['ok', 0.4], ['poor', 0.1]]);
      const energy: CheckInEnergy = rough ? pick([['foggy', 0.5], ['ok', 0.4], ['sharp', 0.1]]) : pick([['sharp', 0.45], ['ok', 0.45], ['foggy', 0.1]]);
      const mood: CheckInMood = pick([['calm', 0.6], ['edgy', 0.27], ['tilted', 0.13]]);
      const first = sitting[0];
      checkIns.push({
        at: first.timestamp - ((first.durationMinutes ?? 12) + 5) * 60_000,
        mood, sleep, energy, ate: rnd() < 0.78,
      });
    }
    // One focus target per sitting, mostly — the habit the chooser nudges toward.
    const focus = SAMPLE_SELF_TARGETS[Math.floor(rnd() * SAMPLE_SELF_TARGETS.length)];
    sitting.forEach((g, i) => {
      const brk = i > 0 && rnd() < 0.12;
      if (now - g.timestamp < KEEP_INBOX_MS || g.review) return;
      const late = i >= 3;
      const hit = (rough ? 0.38 : 0.62) - (late ? 0.15 : 0);
      const grade: TargetGrade = pick([['hit', hit], ['partial', 0.22], ['missed', 1 - hit - 0.22]]);
      out.set(g.matchId, {
        ...g,
        review: {
          at: g.timestamp + 60_000,
          grades: { [focus]: grade },
          flags: {},
          focusTargetIds: [focus],
          ...(brk ? { breakBefore: true } : {}),
        },
      });
    });
  }

  return { games: games.map((g) => out.get(g.matchId) ?? g), checkIns };
}
