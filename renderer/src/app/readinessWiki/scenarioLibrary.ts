/**
 * The browsable curated scenario library — the trimmed archetype set grouped in
 * four plain-language buckets, with the user's current closest read highlighted.
 * Pure content over `CURATED_SCENARIOS`; usable with zero personalized data.
 */
import { h } from '../../dom';
import { matchScenarios, CURATED_SCENARIOS } from '../../../../src/core/readiness';
import type { CuratedScenario, ScenarioGroup } from '../../../../src/core/readiness';
import { wikiPara } from './ui';
import type { WikiNav } from './types';
import type { ViewContext } from '../../views/view';

const GROUPS: Array<[ScenarioGroup, string]> = [
  ['healthy', 'Your normal'],
  ['recovery', 'Rest & recovery'],
  ['overload', 'Overload → red'],
  ['guardrail', 'Guardrails'],
];

/** One scenario tile — reused by the library and the personalized "closest to you" strip. */
export function scenarioTile(s: CuratedScenario, opts: { closest?: boolean } = {}): HTMLElement {
  return h('div', { class: `wiki-scenario${opts.closest ? ' is-closest' : ''}` },
    opts.closest ? h('div', { class: 'wiki-closest-tag', style: { marginBottom: '4px' } }, 'Closest to you') : null,
    h('div', { class: 'wiki-scenario-title' }, s.title),
    h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.55' } }, s.plain),
    h('div', { class: 'wiki-scenario-teaches' }, s.teaches),
  );
}

export function scenarioLibrary(ctx: ViewContext, _nav: WikiNav): HTMLElement {
  const match = ctx.data.readinessSettings.enabled ? matchScenarios(ctx.data.readiness) : null;
  const closestId = match?.primary.id;
  return h('div', null,
    h('div', { class: 'wiki-title' }, 'Player scenarios'),
    wikiPara('A handful of real situations and the score each produces — enough to show how the model thinks, not every possible case.'),
    match ? wikiPara(h('span', { class: 'hint' }, 'Your current read is closest to the highlighted one below.')) : null,
    ...GROUPS.flatMap(([group, label]) => {
      const scenarios = CURATED_SCENARIOS.filter((s) => s.group === group);
      if (scenarios.length === 0) return [];
      return [
        h('div', { class: 'wiki-group-title' }, label),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          ...scenarios.map((s) => scenarioTile(s, { closest: s.id === closestId })),
        ),
      ];
    }),
  );
}
