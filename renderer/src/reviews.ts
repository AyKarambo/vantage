/**
 * The manual (◎) layer attached to auto-tracked (⚡) games. Each finished game is
 * detected automatically; this stores the human read the app can't detect — target
 * grades and habit flags — keyed by match id and persisted to localStorage so it
 * survives reloads. Mirrors how the other manual surfaces work today; wiring these
 * writes through to the main-process store is the shared next step.
 */
export type Grade = 'hit' | 'partial' | 'missed';

export interface Flags {
  tilted?: boolean;
  comms?: boolean;
  toxic?: boolean;
  leaver?: boolean;
}

export interface Review {
  matchId: string;
  at: number;
  targets: Record<string, Grade>; // keyed by target id
  flags: Flags;
}

const KEY = 'vantageReviews';

function load(): Record<string, Review> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function persist(all: Record<string, Review>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — grades just won't persist this session */
  }
}

export const reviews = {
  get: (id: string): Review | undefined => load()[id],
  has: (id: string): boolean => id in load(),
  set(review: Review): void {
    const all = load();
    all[review.matchId] = review;
    persist(all);
  },
  remove(id: string): void {
    const all = load();
    delete all[id];
    persist(all);
  },
  /** How many of these match ids still need a review. */
  pending: (matchIds: string[]): number => {
    const all = load();
    return matchIds.reduce((n, id) => (id in all ? n : n + 1), 0);
  },
};
