/**
 * The small-coloured-label family — pills, badges, and chips used to tag
 * results, data provenance, and toggleable filters throughout the UI.
 */
import { h, type Child, type Props } from '../../dom';
import { infoTip } from '../infoTip';
import type { Result } from '../../../../src/shared/contract';

/** Visual tone for {@link pill}; drives the `is-*` colour class. */
export type PillState = 'win' | 'loss' | 'draw' | 'accent';

/** Small coloured label; `mono` renders the text in the monospace stat font. */
export function pill(text: Child, state?: PillState, opts: { mono?: boolean; title?: string } = {}): HTMLElement {
  return h('span', { class: `pill${state ? ' is-' + state : ''}${opts.mono ? ' is-mono' : ''}`, title: opts.title }, text);
}

/** Canonical match-result mappings, shared by every screen that colours a result. */
export const RESULT_STATE: Record<Result, PillState> = { Win: 'win', Loss: 'loss', Draw: 'draw' };
export const RESULT_LETTER: Record<Result, string> = { Win: 'W', Loss: 'L', Draw: 'D' };

/** Compact W/L/D result pill. */
export function resultPill(result: Result): HTMLElement {
  return pill(RESULT_LETTER[result] ?? result, RESULT_STATE[result], { mono: true });
}

/** Tags a value's data provenance — sample data vs. live-tracked vs. user-entered vs. blended. */
export function badge(
  text: Child,
  kind: 'demo' | 'auto' | 'manual' | 'hybrid' = 'demo',
  opts: { title?: string } = {},
): HTMLElement {
  return h('span', { class: `badge badge--${kind}`, title: opts.title }, text);
}

/** Toggleable filter tag; `on` reflects the current selection state. */
export function chip(label: string, on: boolean, onClick?: () => void): HTMLElement {
  return h('button', { class: `chip${on ? ' is-on' : ''}`, on: onClick ? { click: onClick } : undefined }, label);
}

/**
 * The small uppercase label above a control (`.field-label`), with an optional
 * ⓘ carrying the background prose (#339): the Settings pattern is
 * **Label** ⓘ · control, with at most one short muted line under it.
 */
export function fieldLabel(text: string, info?: string, opts: { style?: Props['style'] } = {}): HTMLElement {
  return h('div', { class: 'field-label', style: opts.style },
    text,
    info ? infoTip(info, { label: `About ${text}` }) : null);
}
