import type { Role } from '../model';

/**
 * Resolve the Notion `Role` from the GEP queue type and the local player's hero role.
 *
 * - Open-queue matches map to `openQ` regardless of hero (the DB tracks open queue
 *   as its own "role").
 * - Otherwise the hero role maps to `tank` / `damage` / `support`. GEP has used a
 *   few spellings over time (`offense`/`dps` for damage), so we normalize them.
 */
export function resolveRole(
  queueType: string | undefined,
  heroRole: string | undefined,
): Role | undefined {
  if (isOpenQueue(queueType)) return 'openQ';

  switch (normalize(heroRole)) {
    case 'tank':
      return 'tank';
    case 'damage':
    case 'dps':
    case 'offense':
    case 'offence':
      return 'damage';
    case 'support':
    case 'healer':
      return 'support';
    default:
      return undefined;
  }
}

function isOpenQueue(queueType: string | undefined): boolean {
  const q = normalize(queueType);
  return q === 'open' || q === 'openqueue' || q === 'open_queue';
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}
