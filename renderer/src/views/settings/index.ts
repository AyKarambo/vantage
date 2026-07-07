/**
 * Settings — General (accounts, app behavior, coaching nudges, appearance,
 * diagnostics, data storage) and Master Data (heroes/maps/seasons) as tabs, so
 * neither one is a single long scroll.
 */
import { h, render } from '../../dom';
import { segmented } from '../../components/primitives';
import { store } from '../../store';
import { viewHead, type ViewContext } from '../view';
import { generalTab } from './general';
import { masterDataTab } from './masterData';

type SettingsTab = 'general' | 'masterData';

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

export function settings(ctx: ViewContext): HTMLElement {
  if (!onSettings) {
    activeTab = 'general';
    onSettings = true;
  }

  const body = h('div', { class: 'stack', style: { gap: '18px' } });
  const draw = (tab: SettingsTab): void => {
    activeTab = tab;
    render(body, tab === 'general' ? generalTab(ctx) : masterDataTab(ctx));
  };

  const tabs = segmented<SettingsTab>({
    options: [
      { value: 'general', label: 'General' },
      { value: 'masterData', label: 'Master Data' },
    ],
    value: activeTab,
    onChange: draw,
  });
  draw(activeTab);

  return h('div', { class: 'view' },
    viewHead('Settings', 'Accounts, app behavior, coaching nudges, appearance, diagnostics', tabs),
    body,
  );
}
