/**
 * BattleTag identity normalization, isolated because both live capture
 * (local-player detection) and history queries (the player-encounter index)
 * need the same comparison form.
 */

/**
 * A BattleTag's normalized identity: the name before `#`, trimmed and
 * lowercased. GEP sometimes drops the discriminator, so identity comparisons
 * (local-player detection, the player-encounter index) all use this one form.
 */
export function battleTagName(tag: string): string {
  const hash = tag.indexOf('#');
  return (hash >= 0 ? tag.slice(0, hash) : tag).trim().toLowerCase();
}
