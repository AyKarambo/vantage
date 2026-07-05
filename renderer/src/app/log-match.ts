/**
 * The quick-log card — opens after a game, ~5 taps. Captures the fields the app
 * can't auto-detect and persists a real match to history via the bridge, so it
 * flows into every dashboard stat (including the mental composite, from the
 * flags below). Account / result / role / map are chosen here; hero and mode are
 * optional. For competitive matches it also captures the skill-rating % (and, the
 * first time for an account+role, the current rank anchor) and grades any active
 * improvement targets inline.
 */
import { h, render } from '../dom';
import { time, roleLabel } from '../format';
import { badge, button, select } from '../components/primitives';
import { openModal } from '../components/overlay';
import { typeahead } from '../components/typeahead';
import { targetGradeRow } from '../components/reviewControls';
import { toast } from '../components/toast';
import { bridge } from '../bridge';
import { prefs } from '../prefs';
import { MAP_MODES } from '../../../src/core/maps';
import { ALL_HEROES } from '../../../src/core/heroes';
import { TIERS } from '../../../src/core/rank';
import type { AccountSummary, MatchMental, RankSummary, Result, Role, TargetGrade } from '../../../src/shared/contract';
import type { ViewContext } from '../views/view';

const FLAGS = ['Tilt', 'Toxic mates', 'Leaver — my team', 'Leaver — enemy', 'Positive comms'];
const MAP_OPTIONS = Object.keys(MAP_MODES).sort().map((m) => ({ value: m, label: m }));
const MODES = ['Competitive', 'Quick Play'];
const ROLE_LABELS: Record<string, Role> = { Tank: 'tank', Damage: 'damage', Support: 'support' };
const DIVISIONS = [5, 4, 3, 2, 1];

interface LogState {
  result: Result;
  role: Role;
  map: string;
  hero: string;
  mode: string;
  account: string;
  flags: Set<string>;
  srDelta: string;
  anchorTier: string;
  anchorDivision: number;
  anchorPct: string;
}

/** Turn the chip selection into the optional per-match mental self-report. */
function mentalFrom(flags: Set<string>): MatchMental | undefined {
  const m: MatchMental = {};
  if (flags.has('Tilt')) m.tilt = true;
  if (flags.has('Toxic mates')) m.toxicMates = true;
  if (flags.has('Leaver — my team')) m.leaverMyTeam = true;
  if (flags.has('Leaver — enemy')) m.leaverEnemyTeam = true;
  if (flags.has('Positive comms')) m.positiveComms = true;
  return Object.keys(m).length ? m : undefined;
}

export function openLogMatch(ctx: ViewContext): void {
  // Accounts + current ranks decide the picker options and whether the first-time
  // rank anchor is still needed — fetch both before building the form.
  void Promise.all([bridge.listAccounts(), bridge.getRanks()]).then(([accounts, ranks]) => {
    openModal((close) => buildForm(ctx, close, accounts, ranks));
  });
}

function buildForm(ctx: ViewContext, close: () => void, accounts: AccountSummary[], ranks: RankSummary[]): HTMLElement {
  const accountOptions = accounts.length
    ? accounts.map((a) => ({ value: a.label, label: a.label }))
    : [{ value: 'You', label: 'You' }];
  const prefill = prefs.get('logPrefill');
  const defaultAccount = accountOptions.find((o) => o.value === prefill?.account)?.value ?? accountOptions[0].value;

  const state: LogState = {
    result: 'Win',
    role: (prefill?.role as Role) ?? 'damage',
    map: 'Ilios',
    hero: '',
    mode: prefill?.mode ?? 'Competitive',
    account: defaultAccount,
    flags: new Set<string>(),
    srDelta: '',
    anchorTier: 'Gold',
    anchorDivision: 3,
    anchorPct: '',
  };

  const hasAnchor = (account: string, role: Role): boolean =>
    ranks.some((r) => r.account === account && r.role === role);

  const grades: Record<string, TargetGrade> = {};
  const activeTargets = ctx.data.targets.filter((t) => t.isActive && !t.archivedAt);

  const persist = async (): Promise<void> => {
    const isComp = state.mode === 'Competitive';
    const srDelta = isComp && state.srDelta.trim() !== '' ? Number(state.srDelta) : undefined;
    await bridge.logMatch({
      result: state.result,
      role: state.role,
      map: state.map,
      hero: state.hero.trim() || undefined,
      gameType: state.mode,
      mental: mentalFrom(state.flags),
      account: state.account,
      ...(srDelta != null && Number.isFinite(srDelta) ? { srDelta } : {}),
      ...(Object.keys(grades).length ? { grades } : {}),
    });
    // First competitive match for this account+role → persist the rank anchor.
    if (isComp && !hasAnchor(state.account, state.role) && state.anchorTier) {
      await bridge.setRankAnchor({
        account: state.account,
        role: state.role,
        tier: state.anchorTier,
        division: state.anchorDivision,
        progressPct: Number(state.anchorPct) || 0,
      });
    }
    prefs.set('logPrefill', { role: state.role, mode: state.mode, account: state.account });
    toast(`Match logged — ${state.result} · ${state.map}`);
    ctx.refresh();
  };

  const header = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' } },
    h('div', { style: { fontFamily: 'var(--font-head)', fontSize: '16px', fontWeight: '600' } }, 'Log match'),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      badge(`◎ manual · ${time(Date.now())}`, 'manual'),
      h('button', { class: 'overlay-close', on: { click: close } }, '✕'),
    ),
  );

  const resultRow = choiceRow(['Win', 'Loss', 'Draw'], state.result, {
    Win: 'win', Loss: 'loss', Draw: 'draw',
  }, (v) => (state.result = v as Result));

  const accountField = field('Account',
    select(accountOptions, state.account, (v) => { state.account = v; paintRank(); }),
  );

  const mapField = field('Map', select(MAP_OPTIONS, state.map, (v) => (state.map = v)));

  const roleLabelInitial = Object.keys(ROLE_LABELS).find((k) => ROLE_LABELS[k] === state.role) ?? 'Damage';
  const roleField = field('Role',
    choiceSegment(Object.keys(ROLE_LABELS), roleLabelInitial, (v) => { state.role = ROLE_LABELS[v]; paintRank(); }),
  );

  const modeField = field('Mode',
    choiceSegment(MODES, MODES.includes(state.mode) ? state.mode : 'Competitive', (v) => { state.mode = v; paintRank(); }),
  );

  const heroField = field(
    optionalLabel('Hero'),
    typeahead({
      value: state.hero,
      placeholder: 'e.g. Tracer',
      suggestions: heroSuggestions(ctx),
      onChange: (v) => (state.hero = v),
    }),
  );

  // Competitive rank block: SR % every match, plus the one-time anchor. Re-paints
  // when account / role / mode change, since those decide anchor existence.
  const rankHost = h('div');
  const paintRank = (): void => {
    if (state.mode !== 'Competitive') {
      render(rankHost);
      return;
    }
    const srField = field(
      optionalLabel('Skill rating change (%)'),
      numInput(state.srDelta, 'e.g. +22 or -19', (v) => (state.srDelta = v)),
    );
    if (hasAnchor(state.account, state.role)) {
      render(rankHost, srField,
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          `Rank tracked for ${roleLabel(state.role)} on ${state.account} — the % above moves it.`));
      return;
    }
    render(rankHost, srField,
      field(
        optionalLabel('Current rank — set once'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          select(TIERS.map((t) => ({ value: t, label: t })), state.anchorTier, (v) => (state.anchorTier = v)),
          select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(state.anchorDivision),
            (v) => (state.anchorDivision = Number(v))),
          numInput(state.anchorPct, '% into division', (v) => (state.anchorPct = v)),
        ),
      ),
      h('div', { class: 'hint', style: { marginTop: '4px' } },
        `First competitive ${roleLabel(state.role)} match on ${state.account} — set your current rank so it can be tracked from here.`),
    );
  };
  paintRank();

  const flagsBlock = field(
    optionalLabel('Flags', "— manual, the game doesn't report these"),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
      ...FLAGS.map((f) => {
        const el = h('button', { class: `chip${state.flags.has(f) ? ' is-on' : ''}` }, f);
        el.addEventListener('click', () => {
          state.flags.has(f) ? state.flags.delete(f) : state.flags.add(f);
          el.classList.toggle('is-on');
        });
        return el;
      }),
    ),
  );

  const targetsBlock = activeTargets.length
    ? field(
        optionalLabel('Targets', '— grade now or later on Review'),
        h('div', { class: 'stack', style: { gap: '10px' } },
          ...activeTargets.map((t) => targetGradeRow(t, grades[t.id], (g) => { grades[t.id] = g; }).el),
        ),
      )
    : null;

  const actions = h('div', { style: { display: 'flex', gap: '10px', paddingTop: '2px' } },
    button('Save ⏎', { variant: 'primary', class: 'btn--block', onClick: () => void persist().then(close) }),
    button('Save & next', { onClick: () => void persist().then(() => { close(); openLogMatch(ctx); }) }),
  );

  return h('div', null, header,
    h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' } },
      field('Result', resultRow), accountField, mapField, roleField, modeField, heroField,
      rankHost, flagsBlock, targetsBlock, actions),
  );
}

// --- little local builders --------------------------------------------------

/** Canonical hero list plus anything already seen in this player's data. */
function heroSuggestions(ctx: ViewContext): string[] {
  const seen = new Set<string>(ALL_HEROES);
  for (const hs of ctx.data.heroStats) seen.add(hs.hero);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function field(label: Node | string, control: Node): HTMLElement {
  return h('div', null, typeof label === 'string' ? h('div', { class: 'field-label' }, label) : label, control);
}

/** A field label with a dimmed "— optional / …" suffix. */
function optionalLabel(label: string, suffix = '— optional'): HTMLElement {
  return h('span', null,
    h('span', { class: 'field-label', style: { display: 'inline', margin: '0' } }, label),
    h('span', { class: 'u-dim', style: { fontSize: '11px', marginLeft: '6px' } }, suffix),
  );
}

/** A text/number input styled like the rest of the form. */
function numInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder,
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}

/** A row of large colour-coded choices (Result). */
function choiceRow(
  options: string[],
  initial: string | null,
  state: Record<string, 'win' | 'loss' | 'mid' | 'draw'>,
  onPick: (value: string) => void,
): HTMLElement {
  const row = h('div', { style: { display: 'flex', gap: '8px' } });
  const buttons = options.map((opt) => {
    const btn = h('button', { class: `choice choice--${state[opt]}${opt === initial ? ' is-active' : ''}` }, opt);
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('is-active');
      btn.classList.add('is-active');
      onPick(opt);
    });
    return btn;
  });
  row.append(...buttons);
  return row;
}

/** Compact segmented choice (Role, Mode). */
function choiceSegment(options: string[], initial: string, onPick: (value: string) => void): HTMLElement {
  const seg = h('div', { class: 'segmented segmented--fill' });
  const buttons = options.map((opt) => {
    const btn = h('button', { class: `segmented-opt${opt === initial ? ' is-active' : ''}` }, opt);
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('is-active');
      btn.classList.add('is-active');
      onPick(opt);
    });
    return btn;
  });
  seg.append(...buttons);
  return seg;
}
