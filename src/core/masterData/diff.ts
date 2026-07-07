/**
 * Diff the effective catalog against a freshly-fetched one to build the Update
 * preview: additions (not currently known) and changes (differing role/mode).
 *
 * Deliberate rules (spec Update-interaction note):
 *  - Maps compare on name + mode only; `isActive` is excluded, so a map whose
 *    only local difference is its pool toggle is never surfaced as a change and
 *    Update never proposes reverting it (AC 27).
 *  - A change's `to` map preserves the *current* `isActive`, so accepting a mode
 *    correction keeps a user's inactive flag (AC 28).
 *  - A fetched `Unknown` mode never downgrades an already-known mode.
 */
import type { FetchedCatalog, MasterData, UpdatePreview } from './types';
import { heroKey, mapKey } from './keys';

export function diffMasterData(effective: MasterData, fetched: FetchedCatalog): UpdatePreview {
  const preview: UpdatePreview = {
    heroes: { additions: [], changes: [] },
    maps: { additions: [], changes: [] },
  };

  const curHeroes = new Map(effective.heroes.map((h) => [heroKey(h.name), h]));
  for (const h of fetched.heroes) {
    const cur = curHeroes.get(heroKey(h.name));
    if (!cur) preview.heroes.additions.push(h);
    else if (cur.role !== h.role) preview.heroes.changes.push({ from: cur, to: h });
  }

  const curMaps = new Map(effective.maps.map((m) => [mapKey(m.name), m]));
  for (const m of fetched.maps) {
    const cur = curMaps.get(mapKey(m.name));
    if (!cur) {
      preview.maps.additions.push(m);
    } else if (cur.mode !== m.mode && m.mode !== 'Unknown') {
      // Preserve the user's current pool flag on the proposed entry.
      preview.maps.changes.push({ from: cur, to: { ...m, isActive: cur.isActive } });
    }
  }

  return preview;
}
