import { h } from '../../../dom';
import type { HeroEntry, MapEntry, MasterData, UpdatePreview } from '../../../../../src/shared/contract';
import { bridge } from '../../../bridge';
import { button } from '../../../components/primitives';
import { openModal } from '../../../components/overlay';
import { toast } from '../../../components/toast';

/**
 * The Update preview modal: each proposed addition/change gets a checkbox
 * (checked by default). Accept applies only the ticked items; Discard leaves
 * everything untouched (spec AC 5/6). `isActive` is never a proposed change —
 * the diff excludes it — so a user's pool toggle is never reverted here.
 */
export function openUpdatePreview(preview: UpdatePreview, onApplied: (d: MasterData) => void): void {
  openModal((close) => {
    const picks: Array<{ cb: HTMLInputElement; hero?: HeroEntry; map?: MapEntry }> = [];

    const checkRow = (text: string, sel: { hero?: HeroEntry; map?: MapEntry }): HTMLElement => {
      const cb = h('input', { type: 'checkbox', checked: 'checked' }) as HTMLInputElement;
      picks.push({ cb, ...sel });
      return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } }, cb, h('span', null, text));
    };

    const groups: Node[] = [];
    if (preview.heroes.additions.length || preview.heroes.changes.length) {
      groups.push(h('div', { style: { fontWeight: '600', fontSize: '13px', marginTop: '4px' } }, 'Heroes'));
      for (const hentry of preview.heroes.additions) groups.push(checkRow(`+ ${hentry.name} · ${hentry.role}`, { hero: hentry }));
      for (const c of preview.heroes.changes) groups.push(checkRow(`~ ${c.to.name}: ${c.from.role} → ${c.to.role}`, { hero: c.to }));
    }
    if (preview.maps.additions.length || preview.maps.changes.length) {
      groups.push(h('div', { style: { fontWeight: '600', fontSize: '13px', marginTop: '4px' } }, 'Maps'));
      for (const m of preview.maps.additions) groups.push(checkRow(`+ ${m.name} · ${m.mode}`, { map: m }));
      for (const c of preview.maps.changes) groups.push(checkRow(`~ ${c.to.name}: ${c.from.mode} → ${c.to.mode}`, { map: c.to }));
    }

    const accept = (): void => {
      const heroes = picks.filter((p) => p.hero && p.cb.checked).map((p) => p.hero as HeroEntry);
      const maps = picks.filter((p) => p.map && p.cb.checked).map((p) => p.map as MapEntry);
      if (!heroes.length && !maps.length) { close(); return; }
      void bridge.masterDataApplyUpdate({ heroes, maps }).then((next) => {
        close();
        onApplied(next);
        toast(`Applied ${heroes.length + maps.length} update${heroes.length + maps.length === 1 ? '' : 's'}.`);
      });
    };

    return h('div', { class: 'stack', style: { gap: '12px', padding: '18px', width: '460px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Master data update'),
      h('div', { class: 'hint' }, 'New and changed entries from the online source. Untick anything you don’t want, then Accept.'),
      h('div', { class: 'stack', style: { gap: '6px', maxHeight: '46vh', overflowY: 'auto' } }, ...groups),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Accept selected', { variant: 'primary', onClick: accept }),
        button('Discard', { variant: 'ghost', onClick: close }),
      ),
    );
  });
}
