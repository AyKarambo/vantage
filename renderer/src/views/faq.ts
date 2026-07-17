/**
 * FAQ — a static, in-app help reference (Overwolf's product guidelines expect
 * one reachable from a help area, linked from onboarding and error states).
 * Content is fixed, in-bundle copy grouped by topic; the few answers that are
 * better served by another screen jump there via `ctx.navigate` rather than
 * duplicating it. Account-agnostic like About, so the shell suppresses the
 * global filter bar here. Zero network requests.
 */
import { h } from '../dom';
import { bridge } from '../bridge';
import { button, card, emptyState } from '../components/primitives';
import { openOnboarding } from '../app/onboarding';
import { changelogHistory, type ChangelogEntry } from '../../../src/core/whatsNew';
import { CHANGELOG } from '../generated/changelog';
import { viewHead, type ViewContext } from './view';

const SUPPORT_EMAIL = 'timo.seikel@gmail.com';

interface FaqEntry {
  q: string;
  a: string;
  /** Optional in-app jump rendered under the answer — see the About screen's
   *  `aboutLink` for the same "button styled as a link" idiom. */
  link?: { label: string; go: (ctx: ViewContext) => void };
}

interface FaqTopic {
  topic: string;
  entries: FaqEntry[];
}

const FAQ: FaqTopic[] = [
  {
    topic: 'Live tracking',
    entries: [
      {
        q: 'What do I need for live match tracking to work?',
        a: 'Vantage reads match data only through Overwolf’s Game Events Provider (GEP) — the same ' +
          'sanctioned events feed other Overwolf apps use. It never reads game memory, injects, or exposes ' +
          'hidden information. Until Vantage is approved by Overwolf for GEP, no live match data flows in ' +
          '(Overwolf Dev Mode aside) — you’ll see a realistic “Demo data” dataset instead, and it’s replaced ' +
          'automatically by your own games once tracking starts.',
      },
      {
        q: 'I started Vantage after a match was already underway — why does that game look incomplete?',
        a: 'GEP has to attach before or right at the start of a match to catch every event. If Vantage (or ' +
          'Overwatch) was launched after a match had already begun, the events before it attached were never ' +
          'sent, so that one match’s stats can be partial. It only affects that specific match — leave Vantage ' +
          'running, or start it before you queue, to avoid it.',
      },
    ],
  },
  {
    topic: 'Your data',
    entries: [
      {
        q: 'Where is my data stored?',
        a: 'Locally on this PC only, inside your Windows user-data folder — files such as history.db, ' +
          'outbox.json, and config.local.json. Nothing is uploaded anywhere. Deleting that folder, or ' +
          'uninstalling Vantage, removes the data.',
        link: { label: 'See the exact folder in Settings →', go: (ctx) => ctx.navigate('settings') },
      },
    ],
  },
  {
    topic: 'Notion export',
    entries: [
      {
        q: 'How do I set up Notion sync?',
        a: 'It’s entirely optional and opt-in. Create an internal integration at notion.so/my-integrations, ' +
          'share your Overwatch page with it, then paste the token on the Notion sync screen — Vantage can ' +
          'create the right databases for you or use ones you already have. The token is stored encrypted at ' +
          'rest, exports go to a database you own, and you can disconnect any time by clearing the token.',
        link: { label: 'Open Notion sync →', go: (ctx) => ctx.navigate('notion') },
      },
    ],
  },
  {
    topic: 'Getting help',
    entries: [
      {
        q: 'How do I report a bug?',
        a: 'On the About screen, “Report a bug” opens a prefilled GitHub issue with your version and build ' +
          `info attached — or email ${SUPPORT_EMAIL} directly if you’d rather not use GitHub. “Save debug ` +
          'log…” there exports a copy with BattleTags and other identifying details stripped, but that’s ' +
          'best-effort — look it over yourself before attaching it to a public issue.',
        link: { label: 'Open About →', go: (ctx) => ctx.navigate('about') },
      },
    ],
  },
];

export function faq(ctx: ViewContext): HTMLElement {
  const emailSupport = (): void => {
    void bridge.openExternal(`mailto:${SUPPORT_EMAIL}`);
  };

  return h('div', { class: 'view' },
    viewHead(
      'FAQ',
      'Quick answers on live tracking, your data, Notion, and getting help — nothing here calls out to the network.',
      button('Replay the intro tour', { variant: 'soft', onClick: () => openOnboarding(ctx.data.isSample) }),
    ),
    ...FAQ.map((section) => topicCard(section, ctx)),
    changelogCard(),
    card({ title: 'Still stuck?' },
      h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } },
        h('div', { class: 'u-muted', style: { fontSize: '12.5px' } }, `Email ${SUPPORT_EMAIL} and we’ll help you out.`),
        button('Email support', { variant: 'soft', onClick: emailSupport }),
      ),
    ),
  );
}

function topicCard(section: FaqTopic, ctx: ViewContext): HTMLElement {
  return card({ title: section.topic },
    h('div', { class: 'stack', style: { gap: '14px', marginTop: '4px' } },
      ...section.entries.map((entry) => faqItem(entry, ctx)),
    ),
  );
}

function faqItem(entry: FaqEntry, ctx: ViewContext): HTMLElement {
  return h('div', null,
    h('div', { style: { fontSize: '13px', fontWeight: '600' } }, entry.q),
    h('div', { class: 'u-muted', style: { fontSize: '12.5px', marginTop: '3px', lineHeight: '1.5' } }, entry.a),
    entry.link ? h('div', { style: { marginTop: '5px' } }, jumpLink(entry.link.label, () => entry.link!.go(ctx))) : null,
  );
}

/** The browsable "What's new" history — every stamped release, newest first,
 *  compiled into the bundle at build time (see `renderer/src/generated/changelog.ts`)
 *  so it reads offline, same as the rest of this screen. This is the always-available
 *  half of AC-8; the highlight modal (`app/whatsNewPrompt.ts`) is the one-time half. */
function changelogCard(): HTMLElement {
  const history = changelogHistory(CHANGELOG);
  return card({ title: 'What’s new', sub: 'release history, newest first' },
    history.length
      ? h('div', { class: 'stack', style: { gap: '14px', marginTop: '4px' } },
          ...history.map(changelogEntryItem),
        )
      : emptyState('No release history yet.'),
  );
}

function changelogEntryItem(entry: ChangelogEntry): HTMLElement {
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
      h('span', { style: { fontSize: '13px', fontWeight: '600' } }, `v${entry.version}`),
      entry.date ? h('span', { class: 'u-dim', style: { fontSize: '11.5px' } }, entry.date) : null,
    ),
    h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' } },
      ...entry.notes.map((note) => h('li', { class: 'u-muted', style: { fontSize: '12.5px', lineHeight: '1.5' } }, note)),
    ),
  );
}

/** A button styled as a link, for in-app jumps — the same idiom as About's `aboutLink`. */
function jumpLink(label: string, onClick: () => void): HTMLElement {
  return h('button', {
    style: {
      background: 'none', border: 'none', padding: '0', cursor: 'pointer',
      font: 'inherit', fontSize: '12.5px', color: 'var(--accent)',
    },
    on: { click: onClick },
  }, label);
}
