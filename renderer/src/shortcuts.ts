/**
 * The central keyboard-shortcut registry: one window keydown listener
 * dispatching declarative bindings, with the guards every binding needs
 * (never fire while typing in an input, never fight an open overlay).
 * The `?` cheatsheet renders itself from these declarations.
 */

export interface Shortcut {
  /** e.g. 'ctrl+k', 'ctrl+3', '?', 'escape', 'arrowleft', 'h'. */
  combo: string;
  /** Human-readable purpose (shown on the cheatsheet). */
  description: string;
  /** Cheatsheet section. */
  group: string;
  /** Extra gate — the shortcut only fires while this returns true. */
  when?: () => boolean;
  /** Fire even while an input/textarea/select has focus (rare). */
  allowInInput?: boolean;
  /** Omit from the cheatsheet (internal bindings). */
  hidden?: boolean;
  run: () => void;
}

const registry: Shortcut[] = [];
let bound = false;

export function registerShortcut(s: Shortcut): void {
  registry.push(s);
}

/** Cheatsheet source: visible shortcuts in registration order, grouped. */
export function shortcutGroups(): Array<{ group: string; items: Shortcut[] }> {
  const groups = new Map<string, Shortcut[]>();
  for (const s of registry) {
    if (s.hidden) continue;
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/** Bind the single dispatcher (idempotent). The shell calls this once. */
export function initShortcuts(): void {
  if (bound) return;
  bound = true;
  window.addEventListener('keydown', (e) => {
    const combo = comboOf(e);
    if (!combo) return;
    const typing = isTyping(e.target);
    const overlayOpen = Boolean(document.querySelector('.overlay, .popover-backdrop'));
    for (const s of registry) {
      if (s.combo !== combo) continue;
      if (typing && !s.allowInInput) continue;
      // Open overlays own the keyboard (their own Escape/arrows) — only
      // explicitly input-safe bindings (e.g. Ctrl+K) may fire over them.
      if (overlayOpen && !s.allowInInput) continue;
      if (s.when && !s.when()) continue;
      e.preventDefault();
      s.run();
      return;
    }
  });
}

function comboOf(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return null;
  return `${e.ctrlKey || e.metaKey ? 'ctrl+' : ''}${key}`;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
