import { h } from '../../dom';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';
import { purchaseButtons, purchaseHint, runProAction } from '../../components/proLock';
import { toast } from '../../components/toast';
import { purchaseAvailable, tierDetail, tierLabel } from '../../proAccess';
import type { ViewContext } from '../view';

/** Settings › Vantage Pro (#337): tier status, purchase / manage buttons, and a manual entitlement re-check. */
export function proCard(ctx: ViewContext): HTMLElement {
  const access = ctx.data.pro;
  const paid = access.tier === 'trial' || access.tier === 'pro';

  const recheck = button('Re-check', {
    variant: 'ghost',
    onClick: () => {
      recheck.setAttribute('disabled', '');
      recheck.textContent = 'Checking…';
      bridge.refreshEntitlement()
        .then(() => ctx.refresh())
        .catch(() => {
          toast('Couldn’t re-check Vantage Pro — try again in a moment.');
          recheck.removeAttribute('disabled');
          recheck.textContent = 'Re-check';
        });
    },
  });

  return card({ title: 'Vantage Pro', sub: 'Readiness, Targets, Mental analytics and the MCP server' },
    h('div', { style: { marginTop: '4px' } }, h('strong', null, tierLabel(access, Date.now()))),
    h('div', { class: 'hint', style: { marginTop: '4px' } }, tierDetail(access)),
    access.demo
      ? h('div', { class: 'hint', style: { marginTop: '4px' } },
          'The demo dataset unlocks every Pro screen while it is showing.')
      : null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' } },
      ...(paid
        ? [button('Manage subscription', {
            variant: 'soft',
            disabled: !purchaseAvailable(access),
            title: purchaseAvailable(access) ? undefined : 'Coming soon',
            onClick: () => void runProAction('manage'),
          })]
        : purchaseButtons(access)),
      recheck,
    ),
    purchaseHint(access),
    access.source === 'simulated'
      ? h('div', { class: 'hint mono', style: { marginTop: '8px' } }, 'Simulated via OW_PRO_SIMULATE (dev)')
      : null,
    access.source === 'developer'
      ? h('div', { class: 'hint mono', style: { marginTop: '8px' } }, 'Activated by developer key')
      : null,
  );
}
