import type { Role } from '../model';
import { MAP_MODES } from '../maps';

/**
 * Static tables backing the sample-data generator: hero pools, demo accounts,
 * the recurring player pool, and the winrate-shaping constants. Pure data —
 * the generation algorithm lives in `./generate`.
 */

/** Maps available to the sample generator, reusing the real map→mode table. */
export const MAPS = MAP_MODES;

/**
 * Hero pool per role, used to pick plausible per-match heroes. Deliberately a
 * frozen subset (not derived from core/heroes ALL_HEROES): the pick order
 * feeds the seeded generator, so reordering would silently change the whole
 * demo dataset.
 */
export const HEROES: Record<Role, string[]> = {
  tank: ['Reinhardt', 'Orisa', 'Sigma', 'Winston', 'Zarya', 'D.Va', 'Junker Queen', 'Ramattra', 'Mauga', 'Hazard'],
  damage: ['Tracer', 'Genji', 'Cassidy', 'Soldier: 76', 'Ashe', 'Sojourn', 'Sombra', 'Mei', 'Reaper', 'Echo'],
  support: ['Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko', 'Lúcio', 'Mercy', 'Moira', 'Zenyatta'],
  openQ: ['Reinhardt', 'Tracer', 'Ana'],
};

/** Demo account names cycled through generated games. */
export const ACCOUNTS = ['Main', 'Smurf', 'Alt', 'Climb'];
/** Role-queue roles cycled through generated games. */
export const ROLES: Role[] = ['tank', 'damage', 'support'];

/** Role-queue team composition used for sample rosters. */
export const ROSTER_ROLES: Role[] = ['tank', 'damage', 'damage', 'support', 'support'];

/**
 * A small recurring pool of other players so the Player History index has
 * repeat encounters to find. A few entries deliberately lack the `#`
 * discriminator to exercise name normalization.
 */
export const PLAYER_POOL = [
  'Nova#11214', 'Vex#2321', 'Mirage#1123', 'Falcon#21500', 'Kestrel#1441',
  'Onyx#3110', 'Drift#1998', 'Pixel', 'Rune#11841', 'Saber#2280',
  'Willow#1373', 'Ghost#21058', 'Ember#1550', 'Frost#31240', 'Blitz',
  'Lyric#1216', 'Quartz#1899', 'Havoc#23041', 'Zephyr#1002', 'Ash#31217',
];

/** Per-account baseline winrate used to bias generated results. */
export const ACCOUNT_WR: Record<string, number> = { Main: 0.56, Smurf: 0.49, Alt: 0.5, Climb: 0.44 };
/** Per-role winrate modifier used to bias generated results. */
export const ROLE_WR: Record<string, number> = { tank: 0.52, damage: 0.49, support: 0.54, openQ: 0.5 };
