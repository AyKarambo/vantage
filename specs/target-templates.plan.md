# Techplan: `target-templates`

Derived from [`target-templates.spec.md`](./target-templates.spec.md).

## Decisions
1. **Templates live in core** (`src/core/targets/templates.ts`), pure data:
   `interface TargetTemplate { name: string; mode: TargetMode; rule: string; blurb: string }` +
   `TARGET_TEMPLATES` (~6 entries). Measured rules use the builder's exact
   `${stat} ${op} ${value}` string format with stats from the builder's STATS list
   (Deaths/Eliminations/…): the round-trip regex in `builder.ts` (`/^(.+) (≤|≥|=) (.+)$/`) is the
   compatibility contract — the test locks it. Export through `src/core/targets/index.ts`.
2. **Builder prefill = a `prefill(t)` sibling of `edit(t)`** on `BuilderHandle`
   (`renderer/src/views/targets/builder.ts`): same field loading as `edit`, but `editingId`
   stays/​resets to null and `saved` false (AC 1–2). The chip row renders inside the builder card
   under the title ("Start from a template" field-label + `.chip` per template, `title` = blurb).
3. **Focus quick-create**: `renderer/src/views/focus.ts` priority rows gain a small ghost
   "＋ target" button → `ctx.navigate('targets', { prefillName: `Practice ${map}: queue it
   unranked + review one replay` })`. `renderer/src/views/targets/index.ts` reads
   `ctx.params.prefillName` and calls `builder.prefill({ name, mode: 'self', rule: 'You grade
   it' })` after mount.
4. **Params**: `ViewParams.prefillName?: string` (`renderer/src/store.ts`) — the
   compiler-enforced `VIEW_PARAM_KEYS` forces the `sameParams` update; add the field to the
   shell's render key (`renderer/src/app/shell.ts`) like day/flag.

## Test plan
`test/targetTemplates.test.ts`: every template has non-empty name/blurb, mode ∈ self|measured,
self rules are exactly 'You grade it', measured rules match the builder regex with a stat from
the known list and a finite value, names unique.
Renderer behavior via preview walkthrough (AC 1–4), per repo convention.
