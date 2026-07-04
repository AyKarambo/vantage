/**
 * Cold-start skeletons: shimmer placeholders shaped like the dashboard's
 * KPI row + cards, shown only while the very first snapshot loads. Background
 * refreshes never show these — the previous content stays visible.
 */
import { h } from '../dom';

function block(style: Partial<CSSStyleDeclaration>): HTMLElement {
  return h('div', { class: 'skeleton-block', style });
}

export function skeletonView(): HTMLElement {
  return h('div', { class: 'view skeleton' },
    block({ width: '38%', height: '30px' }),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' } },
      ...Array.from({ length: 4 }, () => block({ height: '86px' })),
    ),
    block({ height: '300px' }),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } },
      block({ height: '180px' }), block({ height: '180px' }),
    ),
  );
}
