/**
 * Characterization: the expanded Review card (`expanded` in
 * renderer/src/views/review.ts) — what Save & next sends to `saveReview`
 * untouched and with every field filled, and that Skip sends nothing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { $, byText, click, flush, key, modal, mountApp, nav, type, until, type MountedApp } from './appHarness';

let app: MountedApp;

beforeAll(async () => {
  app = await mountApp();
  await window.owstats.saveTarget({ name: 'Use cover', mode: 'self', rule: 'Stay behind cover' });
  await app.store.refresh();
  app.calls.length = 0;
});

afterEach(async () => {
  while (modal()) {
    key(document, 'Escape');
    await flush();
  }
  app.calls.length = 0;
});

/** Review → the inbox's first card, which opens expanded. */
async function openCard(): Promise<HTMLElement> {
  nav('Review');
  return until(() => document.querySelector<HTMLElement>('.review-card'));
}

function pick(root: HTMLElement, label: string): void {
  click(byText('button', label, root));
}

describe('expanded Review card → saveReview', () => {
  it('shows the newest unreviewed match', async () => {
    const card = await openCard();
    expect($('.review-card-head', card).textContent).toBe('⚡ autoLRialto· Soldier: 76 · Damage · 14h · Main · 12 minOpen match ›');
  });

  it('Save & next with nothing touched', async () => {
    const card = await openCard();
    pick(card, 'Save & next');
    await until(() => app.callsTo('saveReview').length || null);
    expect(app.callsTo('saveReview')).toMatchInlineSnapshot(`
      [
        [
          {
            "flags": {},
            "focusTargetIds": [
              "t-1790013600000",
            ],
            "grades": {},
            "matchId": "sample-59",
            "performance": 40,
            "srDelta": -25,
          },
        ],
      ]
    `);
  });

  it('Save & next sends every field the card collected', async () => {
    // The previous save took that match out of the inbox; this is the next one.
    await flush(100);
    const card = await openCard();
    pick(card, 'Hit');
    type($('input[type="range"]', card), '82');
    pick(card, 'Tilt');
    pick(card, 'Toxic mates');
    pick(card, 'Abusive');
    pick(card, 'Took a break before this game');
    type($('input[type="number"]', card), '-20');
    pick(card, 'Save & next');
    await until(() => app.callsTo('saveReview').length || null);
    expect(app.callsTo('saveReview')).toMatchInlineSnapshot(`
      [
        [
          {
            "breakBefore": true,
            "flags": {
              "comms": "abusive",
              "tilt": true,
              "toxicMates": true,
            },
            "focusTargetIds": [
              "t-1790013600000",
            ],
            "grades": {
              "t-1790013600000": "hit",
            },
            "matchId": "sample-56",
            "performance": 82,
            "srDelta": -20,
          },
        ],
      ]
    `);
  });

  it('Skip sends nothing', async () => {
    await flush(100);
    const card = await openCard();
    pick(card, 'Skip');
    await flush();
    expect(app.calls.map((c) => c.method)).not.toContain('saveReview');
  });
});
