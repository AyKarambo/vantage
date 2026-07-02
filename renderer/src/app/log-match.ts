/**
 * The quick-log card — opens after a game, ~5 taps. Captures the fields the app
 * can't auto-detect and persists a real match to history via the bridge, so it
 * flows into every dashboard stat (including the mental composite, from the
 * flags below). Result / role / map are chosen here; hero and mode are optional.
 */
import { h } from '../dom';
import { time } from '../format';
import { badge, button, select } from '../components/primitives';
import { openModal } from '../components/overlay';
import { bridge } from '../bridge';
import { MAP_MODES } from '../../../src/core/maps';
import type { MatchMental, Result, Role } from '../../../src/shared/contract';
import type { ViewContext } from '../views/view';

const FLAGS = ['Tilt', 'Toxic mates', 'Leaver', 'Positive comms'];
const MAP_OPTIONS = Object.keys(MAP_MODES).sort().map((m) => ({ value: m, label: m }));
const MODES = ['Competitive', 'Quick Play'];

interface LogState {
  result: Result;
  role: Role;
  map: string;
  hero: string;
  mode: string;
  flags: Set<string>;
}

/** Turn the chip selection into the optional per-match mental self-report. */
function mentalFrom(flags: Set<string>): MatchMental | undefined {
  const m: MatchMental = {};
  if (flags.has('Tilt')) m.tilt = true;
  if (flags.has('Toxic mates')) m.toxicMates = true;
  if (flags.has('Leaver')) m.leaver = true;
  if (flags.has('Positive comms')) m.positiveComms = true;
  return Object.keys(m).length ? m : undefined;
}

export function openLogMatch(ctx: ViewContext): void {
  openModal((close) => {
    const state: LogState = {
      result: 'Win',
      role: 'damage',
      map: 'Ilios',
      hero: '',
      mode: 'Competitive',
      flags: new Set<string>(['Positive comms']),
    };

    const persist = async (): Promise<void> => {
      await bridge.logMatch({
        result: state.result,
        role: state.role,
        map: state.map,
        hero: state.hero.trim() || undefined,
        gameType: state.mode,
        mental: mentalFrom(state.flags),
      });
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

    const mapField = field('Map',
      select(MAP_OPTIONS, state.map, (v) => (state.map = v)),
    );

    const roleField = field('Role',
      choiceSegment(['Tank', 'Damage', 'Support'], 'Damage', (v) => (state.role = v.toLowerCase() as Role)),
    );

    const modeField = field('Mode',
      choiceSegment(MODES, 'Competitive', (v) => (state.mode = v)),
    );

    const heroField = field(
      h('span', null, h('span', { class: 'field-label', style: { display: 'inline', margin: '0' } }, 'Hero'), h('span', { class: 'u-dim', style: { fontSize: '11px', marginLeft: '6px' } }, '— optional')),
      h('input', {
        class: 'target-name-input', value: state.hero, placeholder: 'e.g. Tracer',
        on: { input: (e) => (state.hero = (e.target as HTMLInputElement).value) },
      }),
    );

    const flagsBlock = field(
      h('span', null, h('span', { class: 'field-label', style: { display: 'inline', margin: '0' } }, 'Flags'), h('span', { class: 'u-dim', style: { fontSize: '11px', marginLeft: '6px' } }, "— manual, the game doesn't report these")),
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

    const actions = h('div', { style: { display: 'flex', gap: '10px', paddingTop: '2px' } },
      button('Save ⏎', { variant: 'primary', class: 'btn--block', onClick: () => void persist().then(close) }),
      button('Save & next', { onClick: () => void persist().then(() => { close(); openLogMatch(ctx); }) }),
    );

    return h('div', null, header,
      h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' } },
        field('Result', resultRow), mapField, roleField, modeField, heroField, flagsBlock, actions),
    );
  });
}

// --- little local builders --------------------------------------------------

function field(label: Node | string, control: Node): HTMLElement {
  return h('div', null, typeof label === 'string' ? h('div', { class: 'field-label' }, label) : label, control);
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
