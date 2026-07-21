/**
 * The presentational component library. Every factory is a pure function of its
 * options that returns a detached element — views compose them by nesting. This
 * is where "use composition" lives: small, single-purpose pieces the views wire
 * together, rather than bespoke markup per screen.
 *
 * Public surface of the library; import from '../primitives', not from its siblings.
 */

// Card shell
export { card, emptyState } from './card';
export type { CardOpts } from './card';

// Interactive controls
export { button, confirmButton, segmented, select } from './controls';
export type { BtnOpts, ConfirmBtnOpts, SegOption, SelectOption } from './controls';

// Small coloured labels
export { pill, RESULT_STATE, RESULT_LETTER, resultPill, badge, chip } from './labels';
export type { PillState } from './labels';

// Numeric/statistical display
export { kpiCard, statBar, statBox, calendarHeatmap } from './stats';
export type { KpiOpts } from './stats';
