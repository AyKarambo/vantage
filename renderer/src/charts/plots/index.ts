/**
 * The chart set — dependency-free SVG, composed from the builders in ./svg.
 * Each function takes plain data and returns an <svg> ready to mount. Colours
 * come from the shared palette so charts and the rest of the UI stay in step.
 *
 * Public surface of the chart set; import from '../plots', not from its siblings.
 */

// Shared data shape
export type { WrPoint } from './shared';

// Chart factories
export { lineChart } from './lineChart';
export { scatterChart } from './scatterChart';
export type { ScatterPoint } from './scatterChart';
export { horizontalBars } from './bars';
export { sparkline } from './sparkline';
export { donutChart } from './donutChart';
export type { DonutSlice } from './donutChart';
