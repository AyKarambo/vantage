import { h, render } from '../../../dom';
import type { MasterData } from '../../../../../src/shared/contract';
import { classifyNetworkError, friendlyNetworkMessage } from '../../../../../src/core/netError';
import { bridge } from '../../../bridge';
import { button, card } from '../../../components/primitives';
import { toast } from '../../../components/toast';
import { store } from '../../../store';
import type { ViewContext } from '../../view';
import { heroSection } from './heroSection';
import { mapSection } from './mapSection';
import { seasonSection } from './seasonSection';
import { openUpdatePreview } from './updatePreview';

/**
 * The Master Data editor: add/edit/remove heroes, maps (incl. the competitive
 * pool `isActive` toggle) and seasons, plus an "Update" that fetches the latest
 * heroes & maps from the online source and previews additions/changes for
 * accept/discard. Seeds synchronously from `ctx.data.masterData` (already on the
 * dashboard payload) so there's no loading flash; mutations round-trip through
 * the bridge and `store.refresh()` so every consumer (log-match, match detail,
 * analytics) sees the change.
 */
export function masterDataTab(ctx: ViewContext): HTMLElement {
  let data: MasterData = ctx.data.masterData;
  const body = h('div', { class: 'stack', style: { gap: '18px', marginTop: '4px' } });

  /** Adopt fresh effective data, repaint, and propagate to the rest of the app. */
  const apply = (next: MasterData): void => {
    data = next;
    paint();
    void store.refresh();
  };

  const updateBtn = button('Update from online source', {
    variant: 'soft',
    onClick: () => void runUpdate(),
  });

  async function runUpdate(): Promise<void> {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Checking…';
    try {
      const preview = await bridge.masterDataFetchUpdate();
      const empty =
        !preview.heroes.additions.length && !preview.heroes.changes.length &&
        !preview.maps.additions.length && !preview.maps.changes.length;
      if (empty) toast('Master data is already up to date.');
      else openUpdatePreview(preview, apply);
    } catch (err) {
      toast(friendlyNetworkMessage(classifyNetworkError(err), 'update the hero and map list'));
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update from online source';
    }
  }

  function paint(): void {
    render(body,
      heroSection(data.heroes, apply),
      mapSection(data.maps, apply),
      seasonSection(data.seasons, apply),
    );
  }

  paint();
  return card(
    {
      title: 'Master data',
      sub: 'Heroes, maps & seasons — edit them, or pull new ones from the online source',
      actions: updateBtn,
    },
    body,
  );
}
