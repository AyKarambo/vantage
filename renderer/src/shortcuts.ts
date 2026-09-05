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
    // An IME composition's Escape/arrows are for the candidate window, not us.
    if (e.isComposing || e.keyCode === 229) return;
    const combo = comboOf(e);
    if (!combo) return;
    const typing = isTyping(e.target);
    const overlayOpen = overlayCapturing();
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

/**
 * An open overlay/popover/palette owns the keyboard AND the pointer. Shared by
 * the key dispatcher and the shell's mouse-back binding so the two can't drift.
 * Broader than `overlay.ts`'s own check, which sees only `.overlay`.
 */
export function overlayCapturing(): boolean {
  return document.querySelector('.overlay, .popover-backdrop') !== null;
}

/** The structural subset {@link comboOf} reads, so a test can build one. */
export interface ComboSource {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Modifiers are emitted in a FIXED order — `ctrl+` then `alt+` — so a binding
 * writes 'ctrl+alt+x', never 'alt+ctrl+x'. Ctrl and Cmd stay folded so one
 * binding covers both platforms. Alt now gets its own prefix: previously it was
 * ignored entirely, so Alt+ArrowLeft produced 'arrowleft' and stepped the match
 * list. Separating it is what lets the stepper (←) and Back (Alt+←) coexist on a
 * match detail. Every existing binding is unmodified, so every existing combo
 * string is unchanged.
 */
export function comboOf(e: ComboSource): string | null {
  const key = e.key.toLowerCase();
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return null;
  const ctrl = e.ctrlKey || e.metaKey ? 'ctrl+' : '';
  const alt = e.altKey ? 'alt+' : '';
  return `${ctrl}${alt}${key}`;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
