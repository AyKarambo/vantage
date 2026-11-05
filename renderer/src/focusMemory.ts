/**
 * Keep keyboard focus across a DOM rebuild (#339). The renderer has no virtual
 * DOM: a re-render replaces the subtree, so the control the player just flipped
 * — a toggle, a segmented button — is gone and focus falls back to <body>,
 * which also costs a keyboard user their place on the page. These helpers
 * remember the focused element as a child-index path from a root and find the
 * matching element in the rebuilt tree, refusing a match whose identity (tag,
 * role, accessible label) differs, so a structural change never lands focus on
 * an unrelated control.
 *
 * The path logic is written against a minimal node shape so it's unit-testable
 * without a DOM.
 */

/** The slice of `Element` the path logic needs. */
export interface PathNode {
  readonly parentElement: PathNode | null;
  readonly children: ArrayLike<PathNode>;
}

/** Child-index path from `root` down to `el`, or null when `el` isn't inside `root` (or is `root`). */
export function pathFrom<T extends PathNode>(root: T, el: T): number[] | null {
  const path: number[] = [];
  let cur: PathNode = el;
  while (cur !== root) {
    const parent: PathNode | null = cur.parentElement;
    if (!parent) return null;
    const idx = Array.prototype.indexOf.call(parent.children, cur);
    if (idx < 0) return null;
    path.unshift(idx);
    cur = parent;
  }
  return path.length ? path : null;
}

/** The node at `path` under `root`, or null when the rebuilt tree no longer has it. */
export function resolvePath<T extends PathNode>(root: T, path: readonly number[]): T | null {
  let cur: PathNode = root;
  for (const idx of path) {
    const next = cur.children[idx];
    if (!next) return null;
    cur = next;
  }
  return cur as T;
}

/** What makes two elements "the same control" across a rebuild. */
function identity(el: Element): string {
  return [
    el.tagName,
    el.getAttribute('role') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('data-value') ?? '',
    el.tagName === 'BUTTON' ? (el.textContent ?? '').trim() : '',
  ].join('|');
}

/** A remembered focus position under some root; see {@link captureFocus}. */
export interface FocusMemo {
  restore(): void;
}

/**
 * Snapshot the focused element under `root` (if any). Call `restore()` once the
 * subtree has been rebuilt: it re-focuses the equivalent element without
 * scrolling (the caller owns the scroll position).
 */
export function captureFocus(root: Element): FocusMemo {
  const active = document.activeElement;
  if (!active || active === document.body || !root.contains(active)) return { restore: () => {} };
  const path = pathFrom(root, active);
  const id = identity(active);
  return {
    restore: () => {
      if (!path) return;
      // The old element survived (an in-place update) — nothing to do.
      if (active.isConnected && root.contains(active)) {
        if (document.activeElement !== active) (active as HTMLElement).focus({ preventScroll: true });
        return;
      }
      const next = resolvePath(root, path);
      if (next && identity(next) === id && typeof (next as HTMLElement).focus === 'function') {
        (next as HTMLElement).focus({ preventScroll: true });
      }
    },
  };
}
