/**
 * A 0-100 self-rated performance slider — a native <input type="range"> laid
 * over a statBar-style track/track-fill pair so the fill can use the same
 * continuous winrate color ramp used elsewhere, with a distinct "not rated"
 * state until the player first interacts with it.
 */
import { h, applyStyle } from '../dom';
import { wrHsl } from '../theme';

const DEFAULT_POSITION = 50;

export function performanceSlider(
  value: number | undefined,
  onChange: (v: number | undefined) => void,
): HTMLElement {
  let current = value;

  const fill = h('div', { class: 'track-fill' });
  const track = h('div', { class: 'track' }, fill);
  const input = h('input', {
    class: 'perf-slider-input', type: 'range', min: '0', max: '100', step: '1',
    value: String(current ?? DEFAULT_POSITION),
  }) as HTMLInputElement;
  const valueText = h('span', { class: 'perf-slider-value' });
  const clearBtn = h('button', { class: 'perf-slider-clear', title: 'Clear rating' }, '✕');

  const wrap = h('div', { class: 'perf-slider' },
    h('div', { class: 'perf-slider-track' }, track, input),
    valueText,
    clearBtn,
  );

  const paint = (): void => {
    const unset = current == null;
    wrap.classList.toggle('is-unset', unset);
    const shown = current ?? DEFAULT_POSITION;
    applyStyle(fill, { width: `${shown}%`, background: unset ? 'var(--track)' : wrHsl(shown / 100) });
    valueText.textContent = unset ? 'Not rated' : String(current);
    clearBtn.classList.toggle('hidden', unset);
  };
  paint();

  input.addEventListener('input', () => {
    current = Number(input.value);
    onChange(current);
    paint();
  });

  clearBtn.addEventListener('click', () => {
    current = undefined;
    input.value = String(DEFAULT_POSITION);
    onChange(undefined);
    paint();
  });

  return wrap;
}
