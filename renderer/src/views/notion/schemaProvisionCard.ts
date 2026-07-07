/**
 * Transparency note for the schema auto-provisioning pass: when Vantage adds
 * columns its export schema needs but the configured database lacked (so the
 * database stays in step with the app), or when that schema update couldn't be
 * applied (e.g. a token without permission to edit the schema — the sync still
 * runs for the columns that do exist). Rendered as a section appended to
 * `statusCard`, not a standalone card shell. Returns `null` on the steady state
 * (nothing created, nothing failed) so it adds no visual noise.
 */
import { h } from '../../dom';
import type { SchemaProvisionStatus } from '../../../../src/shared/contract';

export function schemaProvisionSection(p: SchemaProvisionStatus | null | undefined): HTMLElement | null {
  if (!p) return null;
  const rows: HTMLElement[] = [];

  if (p.created.length) {
    rows.push(
      h('div', { class: 'row', style: { padding: '4px 0' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' },
            `Added ${p.created.length} column${p.created.length === 1 ? '' : 's'} to your database`),
          h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } }, p.created.join(', ')),
        ),
        h('span', { class: 'mono is-win', style: { fontSize: '12px', whiteSpace: 'nowrap' } }, 'added'),
      ),
    );
  }

  if (p.error) {
    rows.push(
      h('div', { class: 'row', style: { padding: '4px 0' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--loss-text)' } }, 'Couldn’t update the database schema'),
          h('div', { class: 'u-dim', style: { fontSize: '11px', marginTop: '2px' } },
            `${p.error} — existing columns still sync.`),
        ),
        h('span', { class: 'mono is-loss', style: { fontSize: '12px', whiteSpace: 'nowrap' } }, 'skipped'),
      ),
    );
  }

  if (rows.length === 0) return null;
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line, rgba(255,255,255,0.08))' } },
    h('div', { class: 'u-dim', style: { fontSize: '11px', marginBottom: '8px' } }, 'Schema'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, ...rows),
  );
}
