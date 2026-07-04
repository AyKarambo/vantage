/**
 * The Ctrl+K command palette: fuzzy-matched navigation, actions, and data
 * search (maps, heroes, recent matches — the current snapshot). Keyboard
 * driven: type to filter, ↑/↓ to move, Enter to run, Escape to close.
 */
import { h, render } from '../dom';
import type { ViewId } from '../store';
import { fuzzyRank } from '../fuzzy';
import { relTime, roleLabel } from '../format';
import { openModal } from '../components/overlay';
import type { ViewContext } from '../views/view';
import { openHeroDrawer } from '../views/heroes';

interface PaletteItem {
  label: string;
  hint?: string;
  group: string;
  /** Extra match text beyond the label (e.g. hero names on a match row). */
  keywords?: string;
  run: () => void;
}

export interface PaletteNav {
  id: ViewId;
  label: string;
}

export interface PaletteExtras {
  nav: PaletteNav[];
  /** Extra actions the shell contributes (log match, tour, …). */
  actions: Array<{ label: string; hint?: string; run: () => void }>;
}

export function openPalette(ctx: ViewContext, extras: PaletteExtras): void {
  const items = buildItems(ctx, extras);

  openModal((close) => {
    const input = h('input', {
      class: 'palette-input',
      type: 'text',
      placeholder: 'Jump to a screen, run an action, find a map / hero / match…',
      'aria-label': 'Command palette',
    }) as HTMLInputElement;
    const list = h('div', { class: 'palette-list' });

    let ranked: PaletteItem[] = [];
    let selected = 0;

    const paint = (): void => {
      const q = input.value;
      // Empty query: curated default order (actions first — Enter = log match).
      ranked = q
        ? fuzzyRank(q, items, (i) => `${i.label} ${i.keywords ?? ''}`).slice(0, 12)
        : items.slice(0, 12);
      selected = Math.min(selected, Math.max(0, ranked.length - 1));
      render(list,
        ranked.length
          ? ranked.map((item, i) =>
              h('div', {
                class: `palette-item${i === selected ? ' is-selected' : ''}`,
                on: {
                  click: () => {
                    close();
                    item.run();
                  },
                  mousemove: () => {
                    if (selected !== i) {
                      selected = i;
                      paint();
                    }
                  },
                },
              },
                h('span', { class: 'palette-group' }, item.group),
                h('span', { class: 'palette-label' }, item.label),
                item.hint ? h('span', { class: 'palette-hint' }, item.hint) : null,
              ),
            )
          : [h('div', { class: 'empty', style: { padding: '14px' } }, 'No matches.')],
      );
    };

    input.addEventListener('input', () => {
      selected = 0;
      paint();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        selected = (selected + d + ranked.length) % Math.max(1, ranked.length);
        paint();
      } else if (e.key === 'Enter' && ranked[selected]) {
        e.preventDefault();
        close();
        ranked[selected].run();
      }
    });

    paint();
    setTimeout(() => input.focus(), 0);
    return h('div', { class: 'palette' }, input, list);
  });
}

function buildItems(ctx: ViewContext, extras: PaletteExtras): PaletteItem[] {
  const d = ctx.data;
  const items: PaletteItem[] = [];

  for (const a of extras.actions) {
    items.push({ label: a.label, hint: a.hint, group: 'Action', run: a.run });
  }
  for (const n of extras.nav) {
    items.push({ label: n.label, group: 'Screen', run: () => ctx.navigate(n.id) });
  }
  for (const m of d.byMap) {
    items.push({
      label: m.key,
      hint: `${m.games} games`,
      group: 'Map',
      run: () => ctx.navigate('maps', { highlight: m.key }),
    });
  }
  for (const hs of d.heroStats) {
    items.push({
      label: hs.hero,
      hint: `${roleLabel(hs.role ?? '')} · ${hs.games} games`,
      group: 'Hero',
      run: () => openHeroDrawer(ctx, hs.hero),
    });
  }
  for (const m of d.matches.slice(0, 30)) {
    items.push({
      label: `${m.result} · ${m.map}`,
      hint: relTime(m.timestamp),
      group: 'Match',
      keywords: `${m.heroes.join(' ')} ${m.gameType} ${m.account}`,
      run: () => ctx.navigate('matchDetail', { matchId: m.matchId }),
    });
  }
  return items;
}
