/**
 * PII-safe **export** redaction for the release log.
 *
 * The local log (`core/logging.ts` + `main/logger.ts`) is deliberately left
 * unredacted for third-party PII: it exists so the user can debug their own
 * machine, and their own BattleTag showing up there is expected and theirs to
 * see. GEP's raw dispatch (`main/gep.ts`'s `dispatch`) also logs every
 * `roster_0..roster_11` payload verbatim — teammates' and opponents' names and
 * BattleTags included — because that's the only way to verify GEP's field
 * spellings against a real capture (see `matchAggregator/keys.ts`).
 *
 * None of that is safe to hand to a stranger. Once "Report a bug" lets a user
 * attach their log to a **public** GitHub issue, the other people who happened
 * to be in that match never agreed to appear in it. This module is a
 * redaction pass that runs ONLY when a log is exported — it never touches the
 * on-disk log file or the in-app viewer, both of which stay raw for local
 * debugging.
 *
 * What it strips, from both `message` and every string value in `fields`:
 *  - **BattleTags** (`Name#1234`) wherever they appear — bare in a message
 *    (`... battle_tag = Karambo#1234`) or inside a JSON blob
 *    (`"battlenet_tag":"Karambo#1234"`).
 *  - **Values keyed by a roster identity field** — `battleTag`, `battletag`,
 *    `battle_tag`, `battlenet_tag`, `name`, `player`, `playerName`,
 *    `player_name` (the exact aliases `matchAggregator/gepValues.ts`'s
 *    `parseRoster` reads) — inside stringified JSON, even when the value has
 *    no `#discriminator`. A bare display name can't be found by pattern
 *    matching alone; key-based redaction is what covers an opponent whose
 *    roster entry carries just a name.
 *  - **Windows user-profile paths** (`C:\Users\<name>\...` or
 *    `C:/Users/<name>/...`, case-insensitive) — the path shape is kept, the
 *    name segment is dropped.
 *  - It then runs the existing `redactEntry`/`redactSecrets` from
 *    `core/logging.ts`, so registered secrets and Notion-token shapes
 *    (`secret_…` / `ntn_…`) are still caught. This module adds a pass in
 *    front of that one; it does not fork or replace it.
 *
 * Honesty check: none of this is provably exhaustive. GEP payload shapes
 * drift between game patches (the whole reason the raw dispatch logs
 * everything it sees), and a regex can never prove it has found every
 * name-shaped string in arbitrary captured text. This is best-effort
 * defence-in-depth, not a guarantee — the user is expected to review the
 * exported log before attaching it to a public issue, the same way they'd
 * review a screenshot before posting it.
 *
 * Trade-off made explicitly: the BattleTag pattern requires the name part to
 * be 3-12 letters/digits *starting with a letter* (Blizzard's own BattleTag
 * rule) before the `#`. That's narrower than "any run of characters before a
 * hash", so a version/build string like `1.2.3#4567` survives untouched — no
 * run of letters-starting-with-a-letter sits directly against that `#`. The
 * symmetrical cost: a coincidental token matching the shape (e.g. a build tag
 * `beta12#4567`) would be redacted even though it isn't a person. Given the
 * artifact is headed for a public bug report, over-redaction is the side we
 * err on.
 *
 * Pure, Electron-free (guardrail 3) — safe to unit test and to drive from the
 * export flow without touching Notion or Electron.
 */
import { redactEntry, type LogEntry } from './logging';

const PLAYER_PLACEHOLDER = '«player»';
const USER_PLACEHOLDER = '«user»';

/**
 * Real Blizzard BattleTags are 3-12 letters/digits, starting with a letter,
 * then `#` and a 4+ digit discriminator. Anchored on word boundaries so it
 * doesn't bite into a longer alnum run.
 */
const BATTLETAG_PATTERN = /\b[A-Za-z][A-Za-z0-9]{2,11}#\d{4,}\b/g;

/**
 * The roster identity-field aliases `matchAggregator/gepValues.ts`'s
 * `parseRoster` reads via `pick(...)`. Kept in sync with that list — a new
 * alias added there should be added here too.
 */
const NAME_KEYS = [
  'battleTag', 'battletag', 'battle_tag', 'battlenet_tag',
  'name', 'player', 'playerName', 'player_name',
] as const;

/** Matches a JSON `"key":"value"` pair for one of {@link NAME_KEYS}, case-insensitively. */
const NAME_KEY_PATTERN = new RegExp(`("(?:${NAME_KEYS.join('|')})"\\s*:\\s*")([^"]*)(")`, 'gi');

/** Windows user-profile path prefix: drive letter, `Users`, either slash style, case-insensitive. */
const USER_PATH_PATTERN = /([A-Za-z]:[\\/]users[\\/])([^\\/"]+)/gi;

/**
 * Best-effort PII scrub of one string: roster identity fields inside
 * stringified JSON, bare BattleTags, and Windows user-profile paths. Text with
 * none of those shapes is returned unchanged. Never throws; non-string input
 * (defensive — callers should not pass it) is returned as-is.
 */
export function redactPii(text: string): string {
  if (typeof text !== 'string') return text;
  try {
    let out = text.replace(NAME_KEY_PATTERN, (_m, pre: string, _val: string, post: string) => `${pre}${PLAYER_PLACEHOLDER}${post}`);
    out = out.replace(BATTLETAG_PATTERN, PLAYER_PLACEHOLDER);
    out = out.replace(USER_PATH_PATTERN, (_m, prefix: string) => `${prefix}${USER_PLACEHOLDER}`);
    return out;
  } catch {
    return text;
  }
}

/**
 * Redact third-party PII and secrets from log entries destined for export
 * (the "Report a bug" attachment). Composes {@link redactPii} over `message`
 * and every string field value, then runs the existing
 * `redactEntry`/`redactSecrets` so registered secrets and Notion-token shapes
 * are still caught. Entry count, order, and non-string field values are
 * preserved exactly. Never throws — malformed input is left as given rather
 * than crashing the export flow.
 */
export function redactForExport(entries: LogEntry[] | null | undefined, secrets: readonly string[] = []): LogEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => redactOneEntry(e, secrets));
}

function redactOneEntry(e: LogEntry, secrets: readonly string[]): LogEntry {
  try {
    if (!e || typeof e !== 'object') return e;
    const message = typeof e.message === 'string' ? redactPii(e.message) : e.message;
    const fields = e.fields
      ? Object.fromEntries(
          Object.entries(e.fields).map(([k, v]) => [k, typeof v === 'string' ? redactPii(v) : v]),
        )
      : undefined;
    const piiPass: LogEntry = { ...e, message, ...(fields ? { fields } : {}) };
    return redactEntry(piiPass, secrets);
  } catch {
    return e;
  }
}
