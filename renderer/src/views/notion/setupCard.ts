/**
 * Notion setup card — the token entry step (create/update). Owns the step-by-step
 * instructions and the save/disconnect actions; validation is a light client-side
 * shape check, the bridge is the source of truth for whether the token actually works.
 */
import { h } from '../../dom';
import type { NotionStatus } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card } from '../../components/primitives';

export function setupCard(s: NotionStatus | null, refresh: () => Promise<void>): HTMLElement {
  const msg = h('div', { class: 'hint', style: { minHeight: '16px', marginTop: '10px' } });
  const input = h('input', {
    class: 'target-name-input',
    type: 'password',
    placeholder: 'Paste token — ntn_… or secret_…',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const save = button('Save token', {
    variant: 'primary',
    onClick: async () => {
      const token = input.value.trim();
      if (!/^(ntn_|secret_)/.test(token) || token.length < 20) {
        setMsg(msg, '⚠ That doesn’t look like a Notion token (it starts with "ntn_" or "secret_").', 'loss');
        return;
      }
      save.disabled = true;
      const next = await bridge.setNotionToken(token);
      input.value = '';
      save.disabled = false;
      setMsg(
        msg,
        next.tokenSet ? '✓ Token saved and encrypted on this machine.' : '⚠ Could not save the token.',
        next.tokenSet ? 'win' : 'loss',
      );
      await refresh();
    },
  });

  const disconnect = s?.tokenSet
    ? button('Disconnect', { variant: 'ghost', onClick: async () => { await bridge.clearNotionToken(); await refresh(); } })
    : null;

  return card({ variant: 'raised', title: s?.tokenSet ? 'Update token' : 'Connect Notion', sub: 'internal integration' },
    stepList(),
    h('div', { class: 'field-label', style: { marginTop: '16px' } }, 'Integration token'),
    input,
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } }, save, disconnect),
    msg,
  );
}

function setMsg(el: HTMLElement, text: string, kind: 'win' | 'loss' | 'muted'): void {
  el.className = `hint${kind === 'win' ? ' is-win' : kind === 'loss' ? ' is-loss' : ''}`;
  el.textContent = text;
}

/** The numbered create-integration → share → paste-token instructions. */
function stepList(): HTMLElement {
  const step = (n: number, text: string) =>
    h('li', { class: 'notion-step' }, h('span', { class: 'notion-step-n' }, String(n)), h('span', null, text));
  return h('ol', { class: 'notion-steps' },
    step(1, 'Create an internal integration at notion.so/my-integrations and copy its secret.'),
    step(2, 'In Notion, open your Overwatch page → ••• → Connections → add that integration so it can write rows.'),
    step(3, 'Paste the token below and save — then sync with one click.'),
  );
}
