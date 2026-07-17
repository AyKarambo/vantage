/**
 * Decides whether — and what — to show in "What's new" after an update.
 *
 * Two rules carry the whole feature, and both are about not being annoying:
 *
 * 1. **A fresh install shows nothing.** With no last-seen version recorded we
 *    cannot tell a first launch from an upgrade, and a first launch already has
 *    the intro tour. Guessing wrong here greets a brand-new user with release
 *    notes for software they have never run, so the unknown case resolves to
 *    "don't show".
 * 2. **Only ever forward.** Equal, older, or unparseable versions show nothing —
 *    a downgrade or a mangled version is not an occasion for a changelog.
 *
 * Pure and Electron-free (guardrail 3); the changelog itself is compiled into the
 * renderer bundle at build time (`renderer/src/generated/changelog.ts`), because the
 * renderer's CSP forbids fetching anything at runtime — even a local file.
 */

/** One released version's user-facing notes, as generated from CHANGELOG.md. */
export interface ChangelogEntry {
  /** Release version, e.g. `'0.32.0'`. */
  version: string;
  /** Human date as written in the changelog, e.g. `'15 July 2026'`; absent for Unreleased. */
  date?: string;
  /** Flat, user-facing bullets, already stripped of markdown headings. */
  notes: string[];
}

/** A version we can order: three numeric parts. Anything else is unusable. */
type Parsed = [number, number, number];

/**
 * Parse `'1.2.3'` into comparable parts. Returns undefined for anything that
 * isn't three plain numbers — including `'unreleased'`, an empty string, or a
 * prerelease tag we have no ordering rule for. Callers treat undefined as
 * "don't show", never as "show".
 */
function parseVersion(v: string | undefined): Parsed | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 / 0 / 1, comparing major, then minor, then patch. */
function compare(a: Parsed, b: Parsed): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True when `current` is strictly newer than `lastSeen` — i.e. the user updated
 * and hasn't been shown these notes yet.
 *
 * Returns false when `lastSeen` is unset (fresh install — see rule 1 above), when
 * either version is unparseable, and when `current` is equal to or older than
 * `lastSeen`. Never throws.
 */
export function shouldShowWhatsNew(lastSeen: string | undefined, current: string | undefined): boolean {
  const seen = parseVersion(lastSeen);
  const now = parseVersion(current);
  if (!seen || !now) return false;
  return compare(now, seen) > 0;
}

/**
 * The entries a user hasn't seen: everything strictly newer than `lastSeen`, newest
 * first. Entries without a parseable version (e.g. an `Unreleased` heading that never
 * got stamped at release time) are skipped rather than shown to everyone forever.
 *
 * With `lastSeen` unset this returns nothing, matching `shouldShowWhatsNew` — the
 * two must agree, or the prompt would open on an empty list.
 */
export function changelogSince(
  entries: readonly ChangelogEntry[],
  lastSeen: string | undefined,
): ChangelogEntry[] {
  const seen = parseVersion(lastSeen);
  if (!seen) return [];
  return entries
    .map((e) => ({ entry: e, parsed: parseVersion(e.version) }))
    .filter((x): x is { entry: ChangelogEntry; parsed: Parsed } => x.parsed !== undefined)
    .filter((x) => compare(x.parsed, seen) > 0)
    .sort((a, b) => compare(b.parsed, a.parsed))
    .map((x) => x.entry);
}

/**
 * Every entry that has a real version, newest first — for the browsable history
 * (Help/About), which is not gated on what the user has seen.
 */
export function changelogHistory(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  return entries
    .map((e) => ({ entry: e, parsed: parseVersion(e.version) }))
    .filter((x): x is { entry: ChangelogEntry; parsed: Parsed } => x.parsed !== undefined)
    .sort((a, b) => compare(b.parsed, a.parsed))
    .map((x) => x.entry);
}
