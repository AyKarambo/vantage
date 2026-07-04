/**
 * The shared hover-tooltip layer for charts (the pattern the scatter and donut
 * established): one absolutely-positioned tip per chart wrapper, following the
 * cursor, with a native <title> fallback added to SVG targets.
 */
import { h } from '../dom';
import { svgEl } from './svg';

export interface TooltipLayer {
  /** Append this to the chart wrapper (position: relative). */
  tip: HTMLElement;
  /** Wire hover on a target to show `text` (call once per target). */
  attach(target: Element, text: string): void;
}

export function tooltipLayer(wrap: HTMLElement): TooltipLayer {
  const tip = h('div', { class: 'chart-tooltip' });
  const move = (e: MouseEvent): void => {
    const r = wrap.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left}px`;
    tip.style.top = `${e.clientY - r.top}px`;
  };
  return {
    tip,
    attach(target, text) {
      target.addEventListener('mouseenter', (e) => {
        tip.textContent = text;
        tip.classList.add('is-visible');
        move(e as MouseEvent);
      });
      target.addEventListener('mousemove', (e) => move(e as MouseEvent));
      target.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
      if (target instanceof SVGElement) {
        const title = svgEl('title');
        title.textContent = text;
        target.appendChild(title);
      } else if (target instanceof HTMLElement && !target.title) {
        target.title = text;
      }
    },
  };
}
