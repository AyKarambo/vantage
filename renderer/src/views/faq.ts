/**
 * FAQ — a static, in-app help reference (Overwolf's product guidelines expect
 * one reachable from a help area, linked from onboarding and error states).
 * Content is fixed, in-bundle copy grouped by topic; the few answers that are
 * better served by another screen jump there via `ctx.navigate` rather than
 * duplicating it. Account-agnostic like About, so the shell suppresses the
 * global filter bar here. Zero network requests.
 */
import { h, render } from '../dom';
import { bridge } from '../bridge';
import { button, card, emptyState } from '../components/primitives';
import { inlineLink } from '../components/inlineLink';
import { openOnboarding } from '../app/onboarding';
import { changelogHistory, type ChangelogEntry } from '../../../src/core/whatsNew';
import { CHANGELOG } from '../generated/changelog';
import { viewHead, type ViewContext } from './view';

/** Until `getAppInfo()` resolves — same fallback `about.ts` uses. */
const FALLBACK_SUPPORT_EMAIL = 'timo.seikel@gmail.com';

/** Releases shown before "Show all" (F5) — enough to feel current without the full history by default. */
const WHATS_NEW_COLLAPSED = 2;

interface FaqEntry {
  q: string;
  a: string;
  /** Optional in-app jump rendered under the answer, via the shared `inlineLink`. */
  link?: { label: string; go: (ctx: ViewContext) => void };
}

interface FaqTopic {
  topic: string;
  entries: FaqEntry[];
}

/** `email` is threaded through rather than baked in — the "Getting help" answer
 *  embeds it, and it starts as {@link FALLBACK_SUPPORT_EMAIL} until `getAppInfo()`
 *  resolves (same fetch-then-repaint pattern `about.ts` uses). */
function faqTopics(email: string): FaqTopic[] {
  return [
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
      topic: 'Accounts & ranks',
      entries: [
        {
          q: 'What is a rank anchor?',
          a: 'A rank you set once for an account + role — everything after it is projected forward from your ' +
            'logged competitive matches, not re-derived from scratch each time. Editing it re-anchors from ' +
            'whatever value you enter. A negative % means you’re in rank protection, not that you actually lost ' +
            'ground.',
          link: { label: 'Set or edit a rank anchor →', go: (ctx) => ctx.navigate('settings', { section: 'accounts' }) },
        },
        {
          q: 'What’s a placement run, and why does it show N/10 instead of a rank?',
          a: 'Overwatch itself shows no rank — no ±%, no protection, no movement — until 10 placement matches ' +
            'complete on a track. Vantage mirrors that honestly: while a run is open it shows “Placements N/10” ' +
            'and the game’s own predicted rank after each match, instead of a fabricated percentage. Once the ' +
            '10th match counts, it asks you to confirm the real rank the game gave you.',
        },
        {
          q: 'What’s the “Unknown” bucket I sometimes see?',
          a: 'A placeholder for games GEP logged without a value for that dimension — most often a map field ' +
            'that never populated. It’s never counted toward any ranking, floor, or focus list; it just keeps ' +
            'the game itself visible in your history instead of silently dropping it.',
        },
      ],
    },
    {
      topic: 'Demo data',
      entries: [
        {
          q: 'What is “Demo data”, and how do I turn it off?',
          a: 'A realistic sample season shown so a new install isn’t a blank dashboard — every screen behaves ' +
            'exactly like it would with your own games, just with invented numbers. It retires automatically ' +
            'the moment your first real tracked game lands, or you can turn it off anytime in Settings → App ' +
            'behavior. Nothing real is ever mixed with it — you’re looking at one or the other, never both.',
          link: { label: 'Turn demo data on or off →', go: (ctx) => ctx.navigate('settings', { section: 'appBehavior' }) },
        },
      ],
    },
    {
      topic: 'Coaching nudges',
      entries: [
        {
          q: 'What do the break reminder and stop rule actually do?',
          a: 'The break reminder is a tray nudge after N losses in a row, so a tilt spiral doesn’t run ' +
            'unnoticed — you set N in Settings. The stop rule is different: a sample-aware, data-derived read ' +
            'of when your OWN sessions tend to turn (“end after game 2, or 2 losses in a row” for example), ' +
            'shown on Overview, Live and Mental once there’s enough session history to say something honest — ' +
            'it’s a read, not a setting.',
          link: { label: 'Open Coaching settings →', go: (ctx) => ctx.navigate('settings', { section: 'coaching' }) },
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
          link: { label: 'See the exact folder in Settings →', go: (ctx) => ctx.navigate('settings', { section: 'dataStorage' }) },
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
      topic: 'AI coach (MCP)',
      entries: [
        {
          q: 'How do I connect an AI coach (MCP)?',
          a: 'Turn on “MCP endpoint” in Settings → App behavior — it lets Claude Desktop or Claude Code read your ' +
            'stats and log matches for you, over a local-only connection; nothing is sent anywhere by Vantage ' +
            'itself. Once it’s on, the card shows the exact path to the bridge script and a “Copy Claude Desktop ' +
            'config” button, so you don’t have to hand-type the JSON block or hunt for the path yourself.',
          link: { label: 'Open Settings →', go: (ctx) => ctx.navigate('settings', { section: 'appBehavior' }) },
        },
      ],
    },
    {
      topic: 'Getting help',
      entries: [
        {
          q: 'How do I report a bug?',
          a: 'On the About screen, “Report a bug” opens a prefilled GitHub issue with your version and build ' +
            `info attached — or email ${email} directly if you’d rather not use GitHub. “Save debug ` +
            'log…” there exports a copy with BattleTags and other identifying details stripped, but that’s ' +
            'best-effort — look it over yourself before attaching it to a public issue.',
          link: { label: 'Open About →', go: (ctx) => ctx.navigate('about') },
        },
      ],
    },
  ];
}

/** Case-insensitive substring match over a Q&A's question + answer text. */
function matches(entry: FaqEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return entry.q.toLowerCase().includes(needle) || entry.a.toLowerCase().includes(needle);
}

export function faq(ctx: ViewContext): HTMLElement {
  let supportEmail = FALLBACK_SUPPORT_EMAIL;
  let query = '';
  let showAllHistory = false;

  const topicsHost = h('div', { class: 'stack', style: { gap: '18px' } });
  const emailSupport = (): void => {
    void bridge.openExternal(`mailto:${supportEmail}`);
  };

  const paint = (): void => {
    // Topic cards hide entirely once nothing in them matches the filter (F5)
    // — an empty card would just be a dead end with a title and nothing under it.
    const filtered = faqTopics(supportEmail)
      .map((section) => ({ ...section, entries: section.entries.filter((e) => matches(e, query)) }))
      .filter((section) => section.entries.length > 0);
    render(topicsHost,
      filtered.length
        ? filtered.map((section) => topicCard(section, ctx))
        : emptyState(`No FAQ entries match “${query}”.`),
      changelogCard(showAllHistory, () => { showAllHistory = true; paint(); }),
      card({ title: 'Still stuck?' },
        h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } },
          h('div', { class: 'u-muted', style: { fontSize: '12.5px' } }, `Email ${supportEmail} and we’ll help you out.`),
          button('Email support', { variant: 'soft', onClick: emailSupport }),
        ),
      ),
    );
  };

  void bridge.getAppInfo().then((info) => {
    supportEmail = info.supportEmail;
    paint();
  });

  const searchInput = h('input', {
    class: 'search-input', type: 'search', placeholder: 'Filter questions…',
    on: { input: (e: Event) => { query = (e.target as HTMLInputElement).value; paint(); } },
  });

  const head = viewHead(
    'FAQ',
    'Quick answers on live tracking, your data, Notion, and getting help — nothing here calls out to the network.',
    [searchInput, button('Replay the intro tour', { variant: 'soft', onClick: () => openOnboarding() })],
  );

  paint();
  return h('div', { class: 'view' }, head, topicsHost);
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
    entry.link ? h('div', { style: { marginTop: '5px' } }, inlineLink(entry.link.label, { onClick: () => entry.link!.go(ctx) })) : null,
  );
}

/**
 * The browsable "What's new" history — every stamped release, newest first,
 * compiled into the bundle at build time (see `renderer/src/generated/changelog.ts`)
 * so it reads offline, same as the rest of this screen. This is the always-available
 * half of AC-8; the highlight modal (`app/whatsNewPrompt.ts`) is the one-time half.
 * Collapsed to the {@link WHATS_NEW_COLLAPSED} most recent releases by default
 * (F5) — a first-time visitor doesn't need the full history scrolling past
 * before they reach "Still stuck?"; "Show all" expands it in place.
 */
function changelogCard(showAll: boolean, onShowAll: () => void): HTMLElement {
  const history = changelogHistory(CHANGELOG);
  const shown = showAll ? history : history.slice(0, WHATS_NEW_COLLAPSED);
  return card({ title: 'What’s new', sub: 'release history, newest first' },
    shown.length
      ? h('div', { class: 'stack', style: { gap: '14px', marginTop: '4px' } },
          ...shown.map(changelogEntryItem),
          !showAll && history.length > shown.length
            ? h('div', { style: { marginTop: '2px' } }, inlineLink(`Show all (${history.length}) →`, { onClick: onShowAll }))
            : null,
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
