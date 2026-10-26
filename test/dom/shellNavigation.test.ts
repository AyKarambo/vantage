/**
 * Characterization: shell navigation (renderer/src/app/shell.ts) — the
 * sidebar routes, Back by the ← control and by Escape, Escape yielding to an
 * open dialog, and the render memo re-rendering the open view when only its
 * params change (fc59c44).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { $, byText, click, flush, key, modal, mountApp, nav, until, type MountedApp } from './appHarness';

let app: MountedApp;

beforeAll(async () => {
  app = await mountApp();
});

const view = (): HTMLElement => $('#app .view');
const activeNav = (): string[] =>
  [...document.querySelectorAll('.nav-item.is-active .nav-label')].map((n) => n.textContent ?? '');

describe('sidebar', () => {
  it('lists every screen, grouped, in this order', () => {
    const navList = document.querySelector('.nav-item')!.parentElement!;
    expect([...navList.querySelectorAll('.nav-group, .nav-item .nav-label')].map((n) => n.textContent)).toStrictEqual([
      'Now', 'Overview', 'Live',
      'After the session', 'Review', 'Matches', 'Players',
      'Improve', 'Focus', 'Targets', 'Mental', 'Readiness',
      'Reference', 'Heroes', 'Maps', 'Trends',
      'App', 'Notion sync', 'Logs', 'Settings', 'About', 'FAQ',
    ]);
  });

  it('routes each item to its view and marks it active', async () => {
    const routes: Array<[string, string]> = [];
    for (const label of [...document.querySelectorAll('.nav-item .nav-label')].map((n) => n.textContent!)) {
      nav(label);
      await flush();
      expect(activeNav()).toStrictEqual([label]);
      expect(view().isConnected).toBe(true);
      routes.push([label, app.store.get().view]);
    }
    expect(routes).toStrictEqual([
      ['Overview', 'overview'], ['Live', 'live'], ['Review', 'review'], ['Matches', 'matches'],
      ['Players', 'players'], ['Focus', 'focus'], ['Targets', 'targets'], ['Mental', 'mental'],
      ['Readiness', 'readiness'], ['Heroes', 'heroes'], ['Maps', 'maps'], ['Trends', 'trends'],
      ['Notion sync', 'notion'], ['Logs', 'logs'], ['Settings', 'settings'], ['About', 'about'], ['FAQ', 'faq'],
    ]);
  });
});

describe('Back', () => {
  async function openNewestMatch(): Promise<void> {
    nav('Matches');
    click(await until(() => document.querySelector<HTMLElement>('.view .match-row.is-clickable')));
    await until(() => document.querySelector('.detail-map'));
  }

  it('the ← on a match detail returns to Matches, which stays highlighted meanwhile', async () => {
    await openNewestMatch();
    expect(app.store.get().view).toBe('matchDetail');
    expect(activeNav()).toStrictEqual(['Matches']);
    const back = $('.view-back');
    expect(back.getAttribute('aria-label')).toBe('Back to Matches');
    click(back);
    await flush();
    expect(app.store.get().view).toBe('matches');
    expect(app.store.get().params).toStrictEqual({});
  });

  it('Escape goes back one screen at a time', async () => {
    nav('Overview');
    nav('Maps');
    await openNewestMatch();
    key(document, 'Escape');
    await flush();
    expect(app.store.get().view).toBe('matches');
    key(document, 'Escape');
    await flush();
    expect(app.store.get().view).toBe('maps');
    key(document, 'Escape');
    await flush();
    expect(app.store.get().view).toBe('overview');
  });

  it('Escape closes an open dialog first and leaves the screen alone', async () => {
    await openNewestMatch();
    click(byText('button', '+ Log match', document, true));
    await until(modal);
    key(document, 'Escape');
    await until(() => !modal() || null);
    expect(app.store.get().view).toBe('matchDetail');
  });
});

describe('render memo', () => {
  it('re-renders the open view when only its params change, and not for an identical route', async () => {
    nav('Settings');
    await flush();
    const before = view();
    app.store.setView('settings', { section: 'appBehavior' });
    await flush();
    const afterParams = view();
    expect(afterParams).not.toBe(before);
    expect(app.store.get().params).toStrictEqual({ section: 'appBehavior' });

    // The same route again is a no-op: same DOM, nothing pushed for Back.
    const backBefore = app.store.backLabel();
    app.store.setView('settings', { section: 'appBehavior' });
    await flush();
    expect(view()).toBe(afterParams);
    expect(app.store.backLabel()).toBe(backBefore);
  });
});
