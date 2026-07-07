/**
 * Parse + validate the OverFast API payloads into Vantage entries. The response
 * is *untrusted* (spec Guardrail 5 / AC 14): every field is checked, malformed
 * rows are skipped, and an entirely unusable payload throws so the caller can
 * fall back to the compiled snapshot rather than storing garbage.
 *
 * OverFast shapes (subset we use):
 *   /heroes → [{ key, name, role: 'tank'|'damage'|'support', ... }]
 *   /maps   → [{ name, gamemodes: string[], ... }]
 */
import type { HeroEntry, HeroRole, MapEntry } from './types';
import { classifyGamemodes } from './modeMap';
import { isStadiumOnlyMap } from '../maps';

function normalizeRole(raw: unknown): HeroRole | null {
  if (typeof raw !== 'string') return null;
  switch (raw.trim().toLowerCase()) {
    case 'tank':
      return 'tank';
    case 'damage':
    case 'dps':
    case 'offense':
      return 'damage';
    case 'support':
    case 'healer':
      return 'support';
    default:
      return null;
  }
}

/** Parse OverFast `/heroes`. Throws when the payload yields no usable hero. */
export function parseOverfastHeroes(raw: unknown): HeroEntry[] {
  if (!Array.isArray(raw)) throw new Error('OverFast /heroes: expected a JSON array');
  const out: HeroEntry[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const name = typeof (h as any)?.name === 'string' ? (h as any).name.trim() : '';
    const role = normalizeRole((h as any)?.role);
    if (!name || !role) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, role });
  }
  if (out.length === 0) throw new Error('OverFast /heroes: no valid heroes in payload');
  return out;
}

/** Parse OverFast `/maps`. Arcade-only maps are dropped; throws when nothing usable remains. */
export function parseOverfastMaps(raw: unknown): MapEntry[] {
  if (!Array.isArray(raw)) throw new Error('OverFast /maps: expected a JSON array');
  const out: MapEntry[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    const name = typeof (m as any)?.name === 'string' ? (m as any).name.trim() : '';
    if (!name || seen.has(name)) continue;
    // Stadium-only maps are never part of the competitive pool; drop them so the
    // Update can't re-introduce them as additions (see STADIUM_ONLY_MAPS).
    if (isStadiumOnlyMap(name)) continue;
    const gamemodes = Array.isArray((m as any)?.gamemodes)
      ? ((m as any).gamemodes as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];
    const { mode, keep } = classifyGamemodes(gamemodes);
    if (!keep) continue;
    seen.add(name);
    // Fetched maps are always active by default; pool status is user-owned (AC 27/29).
    out.push({ name, mode, isActive: true });
  }
  if (out.length === 0) throw new Error('OverFast /maps: no valid maps in payload');
  return out;
}
