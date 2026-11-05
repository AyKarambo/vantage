/**
 * Roving focus for button groups (#340) — one Tab stop per group instead of
 * one per button, with ←/→ (and Home/End) moving between the buttons. Used by
 * the Log Match and Edit Match dialogs so a whole match can be logged from the
 * keyboard without tabbing through every role, hero and grade button.
 *
 * Applied by delegation over a whole form: any element whose direct children
 * include two or more `button.segmented-opt` / `button.chip` / `button.choice`
 * is a group. Single-choice groups (segmented controls, the result chooser)
 * select on arrow like a radio group; chip groups (heroes, flags, focus
 * targets) are multi-select, so arrows only move focus and Space toggles.
 * ↑/↓ are deliberately left alone — the dialogs use them to move between
 * target grade rows.
 */

/** The button classes that make their parent a roving group. */
const ITEM_SELECTOR = ':scope > button.segmented-opt, :scope > button.chip, :scope > button.choice';

/**
 * Where an arrow / Home / End key moves within a group of `count` buttons
 * from `current`, wrapping at the ends — or `null` for any other key.
 */
export function rovingTarget(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * Which button of a group is its Tab stop: the first selected one (so Tab
 * lands on the current choice), else the first enabled one, else `-1`.
 */
export function tabStopIndex(items: ReadonlyArray<{ selected: boolean; disabled: boolean }>): number {
  const sel = items.findIndex((i) => i.selected && !i.disabled);
  if (sel >= 0) return sel;
  return items.findIndex((i) => !i.disabled);
}

function itemsOf(group: Element): HTMLButtonElement[] {
  return [...group.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR)];
}

function isSelected(b: HTMLButtonElement): boolean {
  return b.classList.contains('is-active') || b.classList.contains('is-on');
}

/** A group selects on arrow when it is a single-choice control (not a multi-select chip set). */
function selectsOnArrow(items: HTMLButtonElement[]): boolean {
  return !items.some((b) => b.classList.contains('chip'));
}

function groupOf(btn: HTMLElement): HTMLElement | null {
  const parent = btn.parentElement;
  if (!parent || !btn.matches('button.segmented-opt, button.chip, button.choice')) return null;
  return itemsOf(parent).length >= 2 ? parent : null;
}

function syncGroup(group: Element): void {
  const items = itemsOf(group);
  if (items.length < 2) return;
  // Keep a button that currently holds focus as the stop, so a repaint
  // elsewhere doesn't yank the tab stop out from under the user.
  const focused = items.findIndex((b) => b === document.activeElement);
  const stop = focused >= 0 ? focused : tabStopIndex(items.map((b) => ({ selected: isSelected(b), disabled: b.disabled })));
  items.forEach((b, i) => {
    b.tabIndex = i === stop ? 0 : -1;
    b.dataset.roving = '';
  });
}

function syncAll(root: HTMLElement): void {
  const parents = new Set<Element>();
  root.querySelectorAll('button.segmented-opt, button.chip, button.choice').forEach((b) => {
    if (b.parentElement) parents.add(b.parentElement);
  });
  parents.forEach(syncGroup);
}

/**
 * Turn every button group inside `root` into a roving group, now and after
 * any repaint (a role change re-renders the hero grid, the rank block swaps
 * controls, …). Returns a disposer.
 */
export function enableRovingGroups(root: HTMLElement): () => void {
  syncAll(root);
  // Repaints swap buttons in and out; selection changes flip classes.
  const observer = new MutationObserver(() => syncAll(root));
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const btn = e.target as HTMLElement;
    const group = groupOf(btn);
    if (!group) return;
    const items = itemsOf(group).filter((b) => !b.disabled);
    const next = rovingTarget(items.indexOf(btn as HTMLButtonElement), e.key, items.length);
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    const target = items[next];
    if (selectsOnArrow(items)) target.click();
    // The click may have repainted the group (a fresh set of buttons) — focus
    // whatever now sits at that position.
    const live = itemsOf(group).filter((b) => !b.disabled)[next] ?? target;
    live.focus();
  });
  return () => observer.disconnect();
}
