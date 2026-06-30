/**
 * Resolve a GEP BattleTag (e.g. "Karambo#21234") to the Notion `Account` select
 * value (e.g. "Karambo"), using a user-configured map.
 *
 * Matching, in order:
 *   1. exact BattleTag match
 *   2. case-insensitive BattleTag match
 *   3. name-only match (the part before `#`), case-insensitive — lets the user
 *      configure `"Karambo": "Karambo"` without knowing the discriminator.
 */
export function resolveAccount(
  battleTag: string | undefined,
  accountMap: Record<string, string>,
): string | undefined {
  if (!battleTag) return undefined;

  if (accountMap[battleTag]) return accountMap[battleTag];

  const lowerTag = battleTag.toLowerCase();
  const tagName = nameOf(lowerTag);

  for (const [key, value] of Object.entries(accountMap)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === lowerTag) return value;
    if (nameOf(lowerKey) === tagName) return value;
  }

  return undefined;
}

function nameOf(battleTag: string): string {
  const hash = battleTag.indexOf('#');
  return (hash >= 0 ? battleTag.slice(0, hash) : battleTag).trim();
}
