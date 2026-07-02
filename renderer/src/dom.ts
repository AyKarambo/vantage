/**
 * A tiny hyperscript helper — the composition primitive the whole UI is built
 * from. `h(tag, props, ...children)` returns a real element, so views compose
 * components by nesting function calls. No framework, no virtual DOM.
 */

type StyleInput = Partial<CSSStyleDeclaration> | string;
type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  style?: StyleInput;
  dataset?: Record<string, string | number | undefined>;
  html?: string;
  title?: string;
  /** Event listeners: `{ click: () => …, input: (e) => … }`. */
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
  /** Any other attribute (aria-*, role, type, value, …). */
  [attr: string]: unknown;
}

const KNOWN = new Set(['class', 'style', 'dataset', 'html', 'on', 'title']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el: HTMLElement, props: Props): void {
  if (props.class) el.className = props.class;
  if (props.title != null) el.title = props.title;
  if (props.style) applyStyle(el, props.style);
  if (props.html != null) el.innerHTML = props.html;
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) {
      if (v != null) el.dataset[k] = String(v);
    }
  }
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(type, fn as EventListener);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (KNOWN.has(k) || v == null || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function applyStyle(el: HTMLElement, style: StyleInput): void {
  if (typeof style === 'string') el.style.cssText = style;
  else Object.assign(el.style, style);
}

function append(el: HTMLElement, children: Array<Child | Child[]>): void {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

/** Replace all children of `el` with `content`. */
export function render(el: HTMLElement, ...content: Array<Child | Child[]>): void {
  el.replaceChildren();
  append(el, content);
}

export const clear = (el: HTMLElement): void => el.replaceChildren();

/** Query a required element, throwing a clear error if the markup drifts. */
export function must<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Expected element "${selector}" not found`);
  return el;
}
