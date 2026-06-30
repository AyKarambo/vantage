import type { Result } from '../model';

/**
 * Resolve the Notion `Result` from the raw GEP `match_outcome` string.
 * GEP has reported outcomes as victory/defeat/draw (and occasionally
 * win/loss/tie), so we accept the common spellings.
 */
export function resolveResult(outcome: string | undefined): Result | undefined {
  switch (normalize(outcome)) {
    case 'victory':
    case 'win':
    case 'won':
      return 'Win';
    case 'defeat':
    case 'loss':
    case 'lost':
    case 'lose':
      return 'Loss';
    case 'draw':
    case 'tie':
    case 'tied':
      return 'Draw';
    default:
      return undefined;
  }
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
