import { describe, it, expect } from 'vitest';
import { registerShortcut, shortcutGroups } from '../renderer/src/shortcuts';

describe('shortcutGroups (M5)', () => {
  it('orders groups by the fixed GROUP_ORDER regardless of registration order, and sorts Navigate by digit with 0 last', () => {
    // Registered in the exact order the real bug produced: the context-only
    // groups (Log match, Review) register at their module's import time,
    // ahead of Global/Navigate, which only register once the shell runs
    // bindGlobals() — plus an unlisted group and an out-of-digit-order Navigate set.
    registerShortcut({ combo: 'w', description: 'Win', group: 'Log match', run: () => {} });
    registerShortcut({ combo: 'h', description: 'Hit', group: 'Review', run: () => {} });
    registerShortcut({ combo: 'ctrl+3', description: 'Go to Targets', group: 'Navigate', run: () => {} });
    registerShortcut({ combo: 'ctrl+0', description: 'Go to Players', group: 'Navigate', run: () => {} });
    registerShortcut({ combo: 'ctrl+1', description: 'Go to Overview', group: 'Navigate', run: () => {} });
    registerShortcut({ combo: 'escape', description: 'Back', group: 'Navigate', run: () => {} });
    registerShortcut({ combo: 'ctrl+k', description: 'Command palette', group: 'Global', run: () => {} });
    registerShortcut({ combo: 'x', description: 'Something else', group: 'Somewhere Else', run: () => {} });
    // A hidden binding never reaches the cheatsheet at all.
    registerShortcut({ combo: 'y', description: 'internal', group: 'Global', hidden: true, run: () => {} });

    const groups = shortcutGroups();

    expect(groups.map((g) => g.group)).toEqual(['Global', 'Navigate', 'Review', 'Log match', 'Somewhere Else']);

    const global = groups.find((g) => g.group === 'Global')!;
    expect(global.items.map((i) => i.combo)).toEqual(['ctrl+k']);

    const nav = groups.find((g) => g.group === 'Navigate')!;
    expect(nav.items.map((i) => i.combo)).toEqual(['ctrl+1', 'ctrl+3', 'ctrl+0', 'escape']);
  });
});
