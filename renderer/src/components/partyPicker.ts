/**
 * The "Queued with" picker shared by Review, Log Match and the match editor:
 * who the player was grouped with for one match. A Solo chip, one chip per
 * own-team teammate (★ marks a tagged friend), and a free-text box for anyone
 * else — manual logs have no roster, and GEP sometimes reports only part of it.
 * Names compare by BattleTag name (case-insensitive, `#tag` ignored), the same
 * identity the Players screen and the friend tags use.
 */
import { h, render } from '../dom';
import { typeahead } from './typeahead';
import { battleTagName, type MatchParty } from '../../../src/core/model';
import type { DashboardFilters, PartyInput } from '../../../src/shared/contract';
import { bridge } from '../bridge';

export interface PartyPickerOpts {
  /** The party already recorded on the match, if any. */
  party?: MatchParty;
  /** Own-team players other than you, from the match roster (empty for manual logs). */
  teammates?: readonly string[];
  /** Display names of the players tagged as friends — starred and offered as suggestions. */
  friends?: readonly string[];
  /**
   * The group size the game itself reported, when no party is recorded. Above 1
   * the Solo chip is the correction ("I was alone after all"); otherwise the
   * match already counts as Solo and the chip shows that default.
   */
  detectedGroupSize?: number;
}

export interface PartyPicker {
  el: HTMLElement;
  /** What to save: `undefined` = untouched, `null` = cleared, `{ members: [] }` = Solo. */
  value(): PartyInput | undefined;
  /** Swap in teammates / friends that arrived after the picker was built (they load lazily). */
  update(next: Pick<PartyPickerOpts, 'teammates' | 'friends'>): void;
}

export function partyPicker(opts: PartyPickerOpts = {}): PartyPicker {
  let teammates = [...(opts.teammates ?? [])];
  let friends = [...(opts.friends ?? [])];
  let friendKeys = new Set(friends.map(battleTagName));
  const detectedGroup = !opts.party && (opts.detectedGroupSize ?? 1) > 1;
  // Lit for an explicit Solo AND for the default one: nothing recorded and no
  // group detected already counts as Solo, so the chip says so up front.
  let solo = opts.party ? opts.party.members.length === 0 : !detectedGroup;
  let members = [...(opts.party?.members ?? [])];
  let touched = false;

  const has = (name: string): boolean => members.some((m) => battleTagName(m) === battleTagName(name));
  const changed = (): void => { touched = true; paint(); };

  const toggle = (name: string): void => {
    members = has(name) ? members.filter((m) => battleTagName(m) !== battleTagName(name)) : [...members, name];
    solo = false;
    changed();
  };

  const add = (raw: string): void => {
    const name = raw.trim();
    if (!battleTagName(name) || has(name)) return;
    members = [...members, name];
    solo = false;
    changed();
  };

  const label = (name: string): string => (friendKeys.has(battleTagName(name)) ? `★ ${name}` : name);

  const chips = h('div', { class: 'party-picker__chips' });
  const paint = (): void => {
    const teamKeys = new Set(teammates.map(battleTagName));
    const extras = members.filter((m) => !teamKeys.has(battleTagName(m)));
    const soloChip = h('button', {
      class: `chip${solo ? ' is-on' : ''}`,
      title: detectedGroup
        ? `The game saw a group of ${opts.detectedGroupSize} — click if you actually queued alone`
        : 'Queued alone — the default when no group is detected',
      on: { click: () => { solo = !solo; if (solo) members = []; changed(); } },
    }, 'Solo');
    render(chips,
      soloChip,
      ...teammates.map((t) => h('button', {
        class: `chip${has(t) ? ' is-on' : ''}`,
        on: { click: () => toggle(t) },
      }, label(t))),
      ...extras.map((m) => h('button', {
        class: 'chip is-on',
        title: `Remove ${m}`,
        on: { click: () => toggle(m) },
      }, `${label(m)} ×`)),
    );
  };

  let typed = '';
  // Read on every keystroke, so friends that load after build still suggest.
  const suggestions: string[] = friends;
  const box = typeahead({
    placeholder: 'Type a name, Enter to add',
    suggestions,
    onChange: (v) => { typed = v; },
  });
  const input = box.querySelector('input');
  // The typeahead swallows Enter while its list is open (that Enter picks a
  // suggestion into the box), so this only fires to commit what is in the box.
  box.addEventListener('keydown', (e) => {
    // An empty box lets Enter through, so the form's Enter-to-save still works here.
    if (e.key !== 'Enter' || !input || !typed.trim()) return;
    e.preventDefault();
    e.stopPropagation(); // adding a name must not reach a surrounding Enter-to-save handler
    add(typed);
    input.value = '';
    typed = '';
  });

  paint();
  return {
    el: h('div', { class: 'party-picker stack', style: { gap: '8px' } }, chips, box,
      detectedGroup && !touched
        ? h('div', { class: 'hint' }, `The game saw a group of ${opts.detectedGroupSize}. Pick who it was, or Solo if you were alone.`)
        : null),
    value: () => {
      if (!touched) return undefined;
      if (solo) return { members: [] };
      return members.length ? { members: [...members] } : null;
    },
    update: (next) => {
      if (next.teammates) teammates = [...next.teammates];
      if (next.friends) {
        friends = [...next.friends];
        friendKeys = new Set(friends.map(battleTagName));
        suggestions.splice(0, suggestions.length, ...friends);
      }
      paint();
    },
  };
}

/**
 * Fill a picker's friends (always) and, for a recorded match, its own-team
 * teammates — both arrive over IPC after the form is already on screen.
 */
export function loadPartyContext(picker: PartyPicker, match?: { matchId: string; filters: DashboardFilters }): void {
  void bridge.friends().then((f) => picker.update({ friends: f.map((x) => x.name) }));
  if (match) {
    void bridge.matchDetail(match.matchId, match.filters).then((d) => {
      if (d?.teammates?.length) picker.update({ teammates: d.teammates });
    });
  }
}
