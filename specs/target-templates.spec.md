# Spec: `target-templates`

## Intent (WHAT & WHY)
The Targets builder starts from a blank field, and the Focus screen names your losing maps but
its only CTA drops you on that blank builder — the audit's "identifies the problem, offers no
action" gap. Give players a **curated starter library of proven Overwatch improvement targets**
(one click → prefilled builder) and make Focus's priority maps **create a map-specific practice
target directly**, so the diagnose → practice loop closes in one step.

## In-Scope
- A pure, curated template list in `src/core/targets/` (name, mode, rule, one-line blurb —
  ~6 entries mixing self-rated and measured), exported through the targets barrel.
- Builder: a "Start from a template" chip row; picking one prefills name/mode/rule (measured
  rules populate the stat/op/value controls), marks the form dirty, and always **creates** on
  save (never mutates an existing target, even if the builder was in edit mode).
- Focus: each priority-map row gets a "＋ target" affordance that opens Targets with the builder
  prefilled to a self-rated `Practice <map>: queue it unranked + review one replay` target.
- `ViewParams.prefillName` plumbing (store `sameParams` + shell render key already
  compiler-enforced via `VIEW_PARAM_KEYS`).

## Out-of-Scope (non-goals)
- Per-map/per-hero target *scoping* (targets stay global); template management UI; syncing
  templates; changing the rule-string format or the grading pipeline.

## Acceptance Criteria (Given / When / Then)
1. Given the Targets builder, when a template chip is clicked, then name/mode/rule fill in
   (measured templates round-trip through the existing `${stat} ${op} ${value}` format), the
   Save button reads "Save to library", and saving creates a NEW target.
2. Given the builder was editing an existing target, when a template chip is clicked, then edit
   mode is abandoned (editingId cleared) — saving never overwrites the previously edited target.
3. Given the Focus screen with net-losing maps, when "＋ target" is clicked on a map row, then
   Targets opens with the builder prefilled to the map-practice target; saving adds it and it
   appears in the library and on Review.
4. Given a prefillName param, then it composes with the params plumbing (no stale renders,
   cleared on navigation) and an unknown/absent param leaves the builder default.
5. DoD: template data ships with unit tests (non-empty names, valid modes, measured rules parse
   against the builder's round-trip regex, no duplicate names); `npm test` + typecheck green;
   README mentions templates + the Focus quick-create.
