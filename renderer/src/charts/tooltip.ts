/**
 * The shared hover-tooltip layer for charts (the pattern the scatter and donut
 * established): one absolutely-positioned tip per chart wrapper, following the
 * cursor on hover and pinned to the target's own box on keyboard focus.
 *
 * K8: this used to ALSO inject a native SVG `<title>` (or set `element.title`)
 * as a "fallback" — Chromium renders both, so hovering a point for about a
 * second popped a second, unstyled OS tooltip with the same text beside the
 * styled one. The fallback helped nobody anyway: it was still hover-only. A
 * chart point reachable by keyboard (the caller sets `tabindex="0"` on
 * anything clickable) now gets the one real, styled tip via `focusin`.
 */
import { h } from '../dom';

export interface TooltipLayer {
  /** Append this to the chart wrapper (position: relative). */
  tip: HTMLElement;
  /** Wire hover + keyboard focus on a target to show `text` (call once per target). */
  attach(target: Element, text: string): void;
}

export function tooltipLayer(wrap: HTMLElement): TooltipLayer {
  const tip = h('div', { class: 'chart-tooltip' });
  const moveTo = (x: number, y: number): void => {
    const r = wrap.getBoundingClientRect();
    tip.style.left = `${x - r.left}px`;
    tip.style.top = `${y - r.top}px`;
  };
  const moveToCursor = (e: MouseEvent): void => moveTo(e.clientX, e.clientY);
  // A focused SVG point has no cursor position to follow, so the tip pins to
  // the CENTRE of the target's own box instead — stable, and always over the
  // thing that's actually focused.
  const moveToTarget = (target: Element): void => {
    const r = target.getBoundingClientRect();
    moveTo(r.left + r.width / 2, r.top + r.height / 2);
  };
  const show = (text: string): void => {
    tip.textContent = text;
    tip.classList.add('is-visible');
  };
  const hide = (): void => tip.classList.remove('is-visible');
  return {
    tip,
    attach(target, text) {
      target.addEventListener('mouseenter', (e) => { show(text); moveToCursor(e as MouseEvent); });
      target.addEventListener('mousemove', (e) => moveToCursor(e as MouseEvent));
      target.addEventListener('mouseleave', hide);
      target.addEventListener('focusin', () => { show(text); moveToTarget(target); });
      target.addEventListener('focusout', hide);
    },
  };
}
