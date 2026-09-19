import { h, render } from '../../../dom';
import type { MasterData } from '../../../../../src/shared/contract';
import { classifyNetworkError, friendlyNetworkMessage } from '../../../../../src/core/netError';
import { bridge } from '../../../bridge';
import { button, card } from '../../../components/primitives';
import { toast } from '../../../components/toast';
import { store } from '../../../store';
import { relTime } from '../../../format';
import type { ViewContext } from '../../view';
import { heroSection } from './heroSection';
import { mapSection } from './mapSection';
import { seasonSection } from './seasonSection';
import { openUpdatePreview } from './updatePreview';

/** Past this age (or never checked) the "Last checked" line nudges toward a manual check (W1). */
const STALE_CHECK_DAYS = 60;

/** "Last checked 3 weeks ago · OverFast API (community mirror of Blizzard data) ·
 *  nothing about you is sent" (W1) — names the source and what leaves the
 *  device, since "Update from online source" used to say neither, and adds a
 *  soft nudge once the check is old enough a new hero/map release could have
 *  slipped by. `null` while the first fetch of `lastCheckedAt` is in flight. */
function lastCheckedLine(lastCheckedAt: number | undefined | null): HTMLElement {
  if (lastCheckedAt === null) return h('div', { class: 'hint' }, 'Checking when this was last updated…');
  const stale = lastCheckedAt == null || Date.now() - lastCheckedAt > STALE_CHECK_DAYS * 86400000;
  return h('div', { class: 'hint', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
    h('span', null,
      `${lastCheckedAt != null ? `Last checked ${relTime(lastCheckedAt)}` : 'Never checked'} · OverFast API (community mirror of Blizzard data) · nothing about you is sent`),
    stale ? h('span', { class: 'pill is-accent', style: { fontSize: '10.5px' } }, 'A new hero or map may be missing — check now') : null,
  );
}

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
  const checkedHost = h('div', null, lastCheckedLine(null));
  void bridge.getMasterDataCheck().then((c) => render(checkedHost, lastCheckedLine(c.lastCheckedAt ?? undefined)));

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
      // The fetch above is what stamps `lastCheckedAt` server-side — re-read it
      // so the line reflects "just now" the moment the check actually ran, not
      // only after the next full Settings remount.
      void bridge.getMasterDataCheck().then((c) => render(checkedHost, lastCheckedLine(c.lastCheckedAt ?? undefined)));
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
    checkedHost,
    body,
  );
}
