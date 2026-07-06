export type GameTypeCategory =
  | 'competitive'
  | 'quickplay'
  | 'arcade'
  | 'stadium'
  | 'custom'
  | 'other';

/** Classify the raw GEP game type into a coarse category. */
export function classifyGameType(gameType: string | undefined): GameTypeCategory {
  const g = (gameType ?? '').toLowerCase();
  // Check "unranked"/quick play BEFORE "ranked" — "unranked" contains "ranked".
  if (g.includes('unranked') || g.includes('quick') || g === 'qp') return 'quickplay';
  if (g.includes('comp') || g.includes('ranked')) return 'competitive';
  if (g.includes('stadium')) return 'stadium';
  if (g.includes('custom') || g.includes('private') || g.includes('workshop')) return 'custom';
  if (g.includes('arcade')) return 'arcade';
  return 'other';
}

/** Human label for the Notion `Game Type` select. */
export function gameTypeLabel(gameType: string | undefined): string {
  switch (classifyGameType(gameType)) {
    case 'competitive':
      return 'Competitive';
    case 'quickplay':
      return 'Quick Play';
    case 'stadium':
      return 'Stadium';
    case 'custom':
      return 'Custom';
    case 'arcade':
      return 'Arcade';
    default:
      return gameType ? gameType : 'Unknown';
  }
}

/** True iff the raw GEP game type classifies as competitive. Vantage is competitive-only. */
export function isCompetitive(gameType: string | undefined): boolean {
  return classifyGameType(gameType) === 'competitive';
}
