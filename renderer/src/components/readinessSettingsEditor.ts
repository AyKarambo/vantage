/**
 * The readiness on/off + launch-toast editor, shared by the Readiness screen and
 * the Settings screen (mirrors breakReminderEditor). Changes apply immediately
 * and re-render (no toast).
 */
import { h } from '../dom';
import type { ReadinessSettings } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { chip } from './primitives';
import type { ViewContext } from '../views/view';

export function readinessSettingsEditor(ctx: ViewContext): HTMLElement {
  const r = ctx.data.readinessSettings;

  const set = (patch: Partial<ReadinessSettings>): void => {
    void bridge.setReadiness({ ...r, ...patch }).then(() => {
      ctx.refresh();
    });
  };

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      chip(r.enabled ? 'Readiness coach: on' : 'Readiness coach: off', r.enabled, () => set({ enabled: !r.enabled })),
      r.enabled
        ? chip(r.launchToast ? 'Launch reminder: on' : 'Launch reminder: off', r.launchToast, () => set({ launchToast: !r.launchToast }))
        : null,
    ),
    h('div', { class: 'hint' },
      r.enabled
        ? 'Optional launch reminder: a one-time tray nudge at startup when you’re grinding into the hole (off by default).'
        : 'Turn on to track training load and get rest recommendations from your history and mental tracking.'),
  );
}
