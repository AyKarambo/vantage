/**
 * GEP package version comparison. Overwolf's status feed names a minimum
 * package version; a loaded package below it is refused game injection, so the
 * app sees no `game-detected` at all and reads "No game" while Overwatch runs.
 * Pure and defensive: a version it can't read is "unknown", never "outdated".
 */

/** Parse '315.0.2' → [315, 0, 2]; null when it isn't a dotted numeric version. */
function parts(v: string | undefined): number[] | null {
  if (typeof v !== 'string' || !/^\d+(\.\d+){0,3}$/.test(v.trim())) return null;
  return v.trim().split('.').map(Number);
}

/** <0, 0, >0 like a comparator; null if either side is unreadable. */
export function compareGepVersions(a: string | undefined, b: string | undefined): number | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True only when both versions are readable and the loaded one is below the minimum. */
export function isGepOutdated(loaded: string | undefined, minimum: string | undefined): boolean {
  const c = compareGepVersions(loaded, minimum);
  return c !== null && c < 0;
}
