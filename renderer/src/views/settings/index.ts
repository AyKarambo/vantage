/**
 * Settings — General (accounts, app behavior, coaching nudges, appearance,
 * diagnostics, data storage) and Master Data (heroes/maps/seasons) as tabs, so
 * neither one is a single long scroll.
 */
import { h, render } from '../../dom';
import { segmented } from '../../components/primitives';
import { store, type SettingsSection } from '../../store';
import { viewHead, type ViewContext } from '../view';
import { generalTab } from './general';
import { masterDataTab } from './masterData';

type SettingsTab = 'general' | 'masterData';

/**
 * The section rail (W1): every card on the General tab, in reading order —
 * clicking one switches to General (if needed) and scrolls/flashes that card
 * into view, the same idiom Maps' `highlight` param already uses for a map
 * bar. Each `key` must match a `data-settings-section` the card below it
 * carries (`general.ts`).
 */
const SETTINGS_SECTIONS: ReadonlyArray<{ key: SettingsSection; label: string }> = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'quickLog', label: 'Quick Log' },
  { key: 'coaching', label: 'Coaching' },
  { key: 'appBehavior', label: 'App behavior' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'diagnostics', label: 'Diagnostics' },
  { key: 'dataStorage', label: 'Data storage' },
  { key: 'import', label: 'Import' },
];

// Module-level (not per-render) so a same-view remount — e.g. a master-data
// edit calling store.refresh(), which gives the shell a new data snapshot and
// re-invokes this view function — doesn't visibly snap the user back to
// General mid-edit. `onLeftSettings` resets it the moment the user actually
// navigates elsewhere, so re-entering Settings still always starts on General.
let activeTab: SettingsTab = 'general';
let onSettings = false;
store.subscribe((state) => {
  if (state.view !== 'settings') onSettings = false;
});

/** Scroll a General-tab card into view and flash it (W1) — mirrors Maps' `highlight` idiom, targeted by a stable data attribute instead of text matching. */
function revealSection(root: HTMLElement, key: SettingsSection): void {
  setTimeout(() => {
    const target = root.querySelector<HTMLElement>(`[data-settings-section="${key}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.classList.add('is-highlighted');
    setTimeout(() => target.classList.remove('is-highlighted'), 2400);
  }, 0);
}

export function settings(ctx: ViewContext): HTMLElement {
  if (!onSettings) {
    activeTab = 'general';
    onSettings = true;
  }

  const body = h('div', { class: 'stack', style: { gap: '18px' } });
  const rail = h('div', {
    class: 'settings-rail',
    style: { display: activeTab === 'general' ? 'flex' : 'none' },
  });
  const draw = (tab: SettingsTab): void => {
    activeTab = tab;
    rail.style.display = tab === 'general' ? 'flex' : 'none';
    render(body, tab === 'general' ? generalTab(ctx) : masterDataTab(ctx));
  };

  render(rail, ...SETTINGS_SECTIONS.map(({ key, label }) =>
    h('button', {
      class: 'settings-rail-item',
      on: {
        click: () => {
          if (activeTab !== 'general') draw('general');
          revealSection(body, key);
        },
      },
    }, label),
  ));

  const tabs = segmented<SettingsTab>({
    options: [
      { value: 'general', label: 'General' },
      { value: 'masterData', label: 'Master Data' },
    ],
    value: activeTab,
    onChange: draw,
  });
  draw(activeTab);

  // A deep link (About/FAQ's cross-links, or the rail itself after a fresh
  // navigation) — General is already the default tab, so this only needs to
  // reveal the target card.
  if (ctx.params.section) revealSection(body, ctx.params.section);

  return h('div', { class: 'view' },
    viewHead('Settings', 'Accounts, app behavior, coaching nudges, appearance, diagnostics', tabs),
    rail,
    body,
  );
}
