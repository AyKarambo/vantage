/**
 * Characterization: the Log Match dialog (renderer/src/app/log-match.ts) —
 * what it sends to `logMatch` (and the rank/placement calls around it) for the
 * paths a player takes: a full Save, a first log that anchors a rank, Save &
 * next (and what it carries into the next form), and a placement-run match.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { $, byText, click, flush, key, modal, mountApp, NOW, type, until, type MountedApp } from './appHarness';

let app: MountedApp;

beforeAll(async () => {
  app = await mountApp();
  // A self-rated target, so the form offers a grade row.
  await window.owstats.saveTarget({ name: 'Use cover', mode: 'self', rule: 'Stay behind cover' });
  // Main's Support track is anchored (the Change ±% path); Climb's Tank track
  // is in placements (the predicted-rank path). Everything else is untracked.
  await window.owstats.setRankAnchor({ account: 'Main', role: 'support', tier: 'Diamond', division: 3, progressPct: 40 });
  await window.owstats.startPlacementRun({ account: 'Climb', role: 'tank' });
  await app.store.refresh();
  app.calls.length = 0;
});

afterEach(async () => {
  // Leave no dialog behind for the next test.
  while (modal()) {
    key(document, 'Escape');
    await flush();
  }
  app.calls.length = 0;
});

async function openLog(): Promise<HTMLElement> {
  click(byText('button', '+ Log match', document, true));
  return until(modal);
}

function pick(form: HTMLElement, label: string): void {
  click(byText('button', label, form, true));
}

function setMap(form: HTMLElement, name: string): void {
  const input = $('input[placeholder^="start typing"]', form);
  type(input, name);
  input.dispatchEvent(new FocusEvent('blur'));
}

function setAccount(form: HTMLElement, account: string): void {
  const select = $('select.log-header-account', form) as HTMLSelectElement;
  select.value = account;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The tier and division selects of the rank picker (not the header's account select). */
function rankSelects(form: HTMLElement): [HTMLSelectElement, HTMLSelectElement] {
  const [tier, division] = [...form.querySelectorAll<HTMLSelectElement>('select.vt-select')]
    .filter((s) => !s.classList.contains('log-header-account'));
  return [tier, division];
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Log Match → logMatch', () => {
  it('Save sends every field the form collected', async () => {
    const form = await openLog();
    setAccount(form, 'Main');
    pick(form, 'Loss');
    setMap(form, 'Ilios');
    pick(form, 'Support');
    pick(form, 'Ana');
    pick(form, 'Kiriko');
    // The SR mode is decided when the form opens (the default account, Smurf,
    // is untracked ⇒ "Set current rank"); switching account doesn't flip it.
    pick(form, 'Change (±%)');
    type($('input[type="number"]', form), '-18');
    const slider = $('input[type="range"]', form);
    type(slider, '70');
    pick(form, 'Banter');
    pick(form, 'Tilt');
    pick(form, 'Leaver — enemy');
    const grade = byText('.review-target', 'Use cover', form, true);
    pick(grade, 'Partial');
    pick(form, '1h ago');
    pick(form, 'Save ⏎');
    await until(() => !modal());

    expect(app.callsTo('logMatch')).toStrictEqual([[{
      result: 'Loss',
      role: 'support',
      map: 'Ilios',
      heroes: ['Ana', 'Kiriko'],
      gameType: 'Competitive',
      mental: { tilt: true, leaverEnemyTeam: true, comms: 'banter' },
      account: 'Main',
      srDelta: -18,
      // Practice mode is on by default: the graded target is also this game's focus.
      focusTargetIds: [`t-${NOW}`],
      performance: 70,
      grades: { [`t-${NOW}`]: 'partial' },
      playedAt: NOW - 3_600_000,
    }]]);
    expect(app.callsTo('setRankAnchor')).toStrictEqual([]);
    expect(app.callsTo('setPlacementPrediction')).toStrictEqual([]);
  });

  it('a first log on an untracked track anchors the rank instead of sending a ±%', async () => {
    const form = await openLog();
    setAccount(form, 'Alt');
    setMap(form, 'Busan');
    pick(form, 'Damage');
    // The form opened on the last-logged track (Main, anchored ⇒ "Change"); an
    // untracked track's first rank goes through "Set current rank".
    pick(form, 'Set current rank');
    const [tier, division] = rankSelects(form);
    choose(tier, 'Platinum');
    choose(division, '2');
    type($('input[type="number"]', form), '35');
    // Let the rank preview (an IPC round-trip per change) land, as it does
    // while a player moves on to the next field.
    await flush();
    pick(form, 'Save ⏎');
    await until(() => app.callsTo('setRankAnchor').length || null);

    expect(app.callsTo('logMatch')).toStrictEqual([[{
      result: 'Win',
      role: 'damage',
      map: 'Busan',
      heroes: [],
      gameType: 'Competitive',
      mental: undefined,
      account: 'Alt',
      focusTargetIds: [`t-${NOW}`],
    }]]);
    expect(app.callsTo('setRankAnchor')).toStrictEqual([[{
      account: 'Alt', role: 'damage', tier: 'Platinum', division: 2, progressPct: 35,
    }]]);
    // A track with no run yet gets the "start placements?" offer after the save.
    expect(app.callsTo('placementOffer')).toStrictEqual([[{ account: 'Alt', role: 'damage' }]]);
  });

  it('Save & next logs, then reopens the form carrying heroes and the backfilled time', async () => {
    const first = await openLog();
    setAccount(first, 'Main');
    setMap(first, 'Oasis');
    pick(first, 'Support');
    pick(first, 'Change (±%)');
    pick(first, 'Ana');
    pick(first, '2h ago');
    pick(first, 'Save & next');
    // The first form closes and a fresh one opens in its place.
    const second = await until(() => (modal() !== first && modal()) || null);
    await flush();

    expect(app.callsTo('logMatch')).toStrictEqual([[{
      result: 'Win',
      role: 'support',
      map: 'Oasis',
      heroes: ['Ana'],
      gameType: 'Competitive',
      mental: undefined,
      account: 'Main',
      srDelta: 25,
      focusTargetIds: [`t-${NOW}`],
      playedAt: NOW - 7_200_000,
    }]]);
    // Carried: the hero stays picked and the backfill sits on "Other…" at the same instant.
    expect(byText('button', 'Ana', second).classList.contains('is-on')).toBe(true);
    expect(byText('button', 'Other…', second).classList.contains('is-active')).toBe(true);
    // Account and role come back from the last-logged prefill.
    expect(($('select.log-header-account', second) as HTMLSelectElement).value).toBe('Main');
    expect(byText('button', 'Support', second).classList.contains('is-active')).toBe(true);

    pick(second, 'Draw');
    setMap(second, 'Nepal');
    key(second.querySelector('[tabindex="-1"]') ?? second, 'Enter');
    await until(() => !modal() || null);
    expect(app.callsTo('logMatch')[1]).toStrictEqual([{
      result: 'Draw',
      role: 'support',
      map: 'Nepal',
      heroes: ['Ana'],
      gameType: 'Competitive',
      mental: undefined,
      account: 'Main',
      srDelta: 0,
      focusTargetIds: [`t-${NOW}`],
      playedAt: NOW - 7_200_000,
    }]);
  });

  it('a match on a track in placements sends a predicted rank, not a ±%', async () => {
    const form = await openLog();
    setAccount(form, 'Climb');
    setMap(form, 'Dorado');
    pick(form, 'Tank');
    const [tier, division] = rankSelects(form);
    choose(tier, 'Gold');
    choose(division, '1');
    pick(form, 'Save ⏎');
    await until(() => app.callsTo('setPlacementPrediction').length || null);

    const [[logged]] = app.callsTo('logMatch') as [[{ account: string }]];
    expect(logged).toStrictEqual({
      result: 'Win',
      role: 'tank',
      map: 'Dorado',
      heroes: [],
      gameType: 'Competitive',
      mental: undefined,
      account: 'Climb',
      focusTargetIds: [`t-${NOW}`],
    });
    expect(app.callsTo('setPlacementPrediction')).toStrictEqual([[{
      account: 'Climb', role: 'tank', matchId: expect.any(String), prediction: { tier: 'Gold', division: 1 },
    }]]);
  });
});
