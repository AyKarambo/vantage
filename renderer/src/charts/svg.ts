/** Minimal SVG builders — the composition primitives every chart is made of. */
const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
  children?: SVGElement[],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (children) for (const c of children) el.appendChild(c);
  return el;
}

export function svgRoot(w: number, h: number): SVGSVGElement {
  const s = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  });
  s.style.display = 'block';
  s.style.overflow = 'visible';
  return s;
}

export interface TextOpts {
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  size?: number;
  weight?: number;
  mono?: boolean;
}

export function svgText(x: number, y: number, str: string, opts: TextOpts = {}): SVGTextElement {
  const t = svgEl('text', {
    x,
    y,
    'text-anchor': opts.anchor ?? 'middle',
    fill: opts.fill ?? '#8a8a98',
    'font-size': opts.size ?? 10,
  });
  if (opts.weight) t.setAttribute('font-weight', String(opts.weight));
  if (opts.mono) t.setAttribute('font-family', "'Geist Mono', monospace");
  t.textContent = str;
  return t;
}
