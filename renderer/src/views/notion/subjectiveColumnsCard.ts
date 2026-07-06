/**
 * Per-column sync diagnostics for the five optional "subjective" Gametracker
 * columns (Comms, Improvement Target, Leaver, Tilt, Toxic Mates). Renders one
 * row per column with an available/skipped status and, for a skip, the
 * reason — wrong type, or a near-miss name (trim/case-fold match) the user
 * probably meant. Schema-level only; per-match "no value" skips are reported
 * in the sync result, not here (see spec A3). Rendered as a section appended
 * to `statusCard`, not a standalone card shell.
 */
import { h } from '../../dom';
import type { SubjectiveColumnDiag, SubjectiveColumnStatus } from '../../../../src/shared/contract';

/**
 * Expected Notion property type per canonical column name, for display copy
 * only (e.g. "expected select"). Mirrors `OPTIONAL_SUBJECTIVE_PROPERTIES` in
 * `src/notion/gametrackerSchema.ts`, duplicated here because the renderer
 * doesn't import the notion edge — this is just wording, not behavior.
 */
const EXPECTED_TYPE: Record<string, string> = {
  Comms: 'select',
  'Improvement Target': 'select',
  Leaver: 'select',
  Tilt: 'checkbox',
  'Toxic Mates': 'checkbox',
};

/**
 * The subjective-columns section for `statusCard`: one row per diagnosed
 * column. Returns `null` when there's nothing to show yet (not validated).
 */
export function subjectiveColumnsSection(diags: SubjectiveColumnDiag[] | null | undefined): HTMLElement | null {
  if (!diags || diags.length === 0) return null;
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line, rgba(255,255,255,0.08))' } },
    h('div', { class: 'u-dim', style: { fontSize: '11px', marginBottom: '8px' } }, 'Subjective columns'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      ...diags.map(columnRow),
    ),
  );
}

function columnRow(d: SubjectiveColumnDiag): HTMLElement {
  const { label, tone } = statusText(d);
  return h('div', { class: 'row', style: { padding: '4px 0' } },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, d.column),
      h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } }, reason(d)),
    ),
    h('span', { class: `mono ${tone}`, style: { fontSize: '12px', whiteSpace: 'nowrap' } }, label),
  );
}

function statusText(d: SubjectiveColumnDiag): { label: string; tone: string } {
  switch (d.status) {
    case 'available':
      return { label: 'available', tone: 'is-win' };
    case 'wrong-type':
    case 'missing':
      return { label: 'skipped', tone: 'is-loss' };
    case 'near-miss':
      return { label: 'skipped', tone: 'u-muted' };
  }
}

/** Human-readable reason shown under the column name, per {@link SubjectiveColumnStatus}. */
function reason(d: SubjectiveColumnDiag): string {
  switch (d.status) {
    case 'available':
      return 'Ready to sync.';
    case 'wrong-type': {
      const expected = EXPECTED_TYPE[d.column];
      return `Skipped — wrong type${expected ? ` (expected ${expected})` : ''}${d.actualType ? `, found ${d.actualType}` : ''}.`;
    }
    case 'near-miss':
      return `Skipped — column not found, but "${d.actualName}" looks like a match. Rename it to "${d.column}" to enable.`;
    case 'missing':
      return 'Skipped — column missing from this database.';
  }
}
