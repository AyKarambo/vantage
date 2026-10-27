/**
 * Characterization: the match editor (buildMatchEditor in
 * renderer/src/views/matchDetail.ts), opened from a match's detail page —
 * what it sends to `editMatch` untouched, with every field edited, and on
 * Cancel.
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

/** Matches → the newest match's detail page → ✎ Edit match. */
async function openEditor(): Promise<HTMLElement> {
  nav('Matches');
  click(await until(() => document.querySelector<HTMLElement>('.view .match-row.is-clickable')));
  await until(() => document.querySelector('.detail-map'));
  click(byText('button', 'Edit match', document, true));
  const form = await until(modal);
  await flush();
  return form;
}

function pick(root: HTMLElement, label: string): void {
  click(byText('button', label, root));
}

describe('match editor → editMatch', () => {
  it('opens on the newest match', async () => {
    await openEditor();
    expect(app.store.get().view).toBe('matchDetail');
    expect(app.store.get().params).toStrictEqual({ matchId: 'sample-59' });
    expect($('.detail-map').textContent).toBe('Rialto');
  });

  it('Save with nothing changed re-sends the match as it stands', async () => {
    const form = await openEditor();
    pick(form, 'Save');
    await until(() => app.callsTo('editMatch').length || null);
    expect(app.callsTo('editMatch')).toMatchInlineSnapshot(`
      [
        [
          {
            "grades": {},
            "heroes": [
              "Soldier: 76",
              "Ashe",
            ],
            "map": "Rialto",
            "matchId": "sample-59",
            "mental": {
              "comms": "banter",
              "tilt": false,
              "toxicMates": false,
            },
            "performance": 40,
            "result": "Loss",
            "role": "damage",
            "srDelta": -25,
          },
        ],
      ]
    `);
  });

  it('Save sends every edit', async () => {
    const form = await openEditor();
    pick(form, 'WinW');
    pick(form, 'Genji');
    pick(form, 'Ashe');
    type($('input[placeholder="mm:ss"]', form), '9:15');
    type($('input[type="number"]', form), '18');
    type($('input[type="range"]', form), '75');
    pick(form, 'Positive');
    pick(form, 'Tilt');
    pick(form, 'Leaver — my team');
    pick(form, 'Willow#1373');
    pick(byText('.review-target', 'Use cover', form, true), 'Hit');
    pick(form, 'Save');
    await until(() => !modal() || null);
    expect(app.callsTo('editMatch')).toMatchInlineSnapshot(`
      [
        [
          {
            "grades": {
              "t-1790013600000": "hit",
            },
            "heroes": [
              "Soldier: 76",
              "Genji",
            ],
            "map": "Rialto",
            "matchId": "sample-59",
            "mental": {
              "comms": "positive",
              "leaverMyTeam": true,
              "tilt": true,
              "toxicMates": false,
            },
            "party": {
              "members": [
                "Willow#1373",
              ],
            },
            "performance": 75,
            "playedMinutes": 9.25,
            "result": "Win",
            "role": "damage",
            "srDelta": 18,
          },
        ],
      ]
    `);
  });

  it('Cancel sends nothing', async () => {
    const form = await openEditor();
    pick(form, 'LossL');
    pick(form, 'Cancel');
    await until(() => !modal() || null);
    expect(app.calls.map((c) => c.method)).not.toContain('editMatch');
  });
});
