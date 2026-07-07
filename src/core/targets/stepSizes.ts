/**
 * Wheel/stepper step sizes for the measured-target threshold field, per stat.
 * The threshold lives on wildly different scales — deaths in single digits,
 * damage-per-10 in the thousands — so one fixed step would be useless at one end
 * or the other. Pure, so the renderer's wheel handler and its tests share a
 * single source of truth.
 */

/** Holding Shift multiplies the base step for fast travel across big ranges. */
export const COARSE_FACTOR = 10;

/**
 * Base wheel/arrow step for a measured stat's threshold: ±1 for count stats,
 * ±0.1 for the KDA ratio, ±250 for the per-10-minute volume stats. Unknown
 * stats default to ±1.
 */
export function stepFor(stat: string): number {
  switch (stat) {
    case 'Damage':
    case 'Healing':
    case 'Mitigation':
      return 250;
    case 'KDA':
      return 0.1;
    default:
      // Deaths, Eliminations, Assists, and any unrecognized stat.
      return 1;
  }
}
