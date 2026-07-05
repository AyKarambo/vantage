/**
 * Improvement Targets — the flexible, user-defined focus system. A target is
 * either self-rated (◎ you grade it after the game) or measured (⚡ bound to a
 * stat). Both are graded on the Review screen today; grades persist on the
 * match record (`GameRecord.review`) and drive the hit-rates, sparklines and
 * win-splits below. {@link sampleTargets} produces a representative library
 * for demo mode, grounded in the current dataset so it feels real.
 *
 * Public surface of targets; import from '../targets', not from its siblings.
 */

// Shared shapes
export type { TargetMode, AuthoredTarget, TargetSummary } from './types';

// Sample and scoring paths
export { sampleTargets } from './sampleTargets';
export { buildTargets } from './scoring';

// Curated starter templates for the builder's "Start from a template" chips
export type { TargetTemplate } from './templates';
export { TARGET_TEMPLATES } from './templates';
