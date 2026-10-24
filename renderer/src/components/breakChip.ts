/**
 * "Took a break before this game" (issue #321) — the player's own break mark,
 * shared by the Review card and Log Match. Seeded from automatic detection
 * (`MatchRow.autoBreak`); `changed()` says whether the player overrode that
 * seed, so the save only sends `breakBefore` when it actually carries the
 * player's word — an untouched chip leaves the review following detection.
 */
import { h } from '../dom';

export function breakChip(seed: boolean, opts: { autoDetected?: boolean } = {}): {
  el: HTMLElement;
  value: () => boolean;
  changed: () => boolean;
} {
  let on = seed;
  const el = h('button', {
    class: `chip${on ? ' is-on' : ''}`,
    title: opts.autoDetected
      ? 'Detected from the gap since your last game — click if that wasn’t a real break'
      : 'Mark that you took a break before this game',
  }, 'Took a break before this game');
  el.addEventListener('click', () => {
    on = !on;
    el.classList.toggle('is-on', on);
  });
  return { el, value: () => on, changed: () => on !== seed };
}
