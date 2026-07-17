/**
 * Notion connection status card — reads the current `NotionStatus` snapshot and
 * renders one of: loading, transport error (can't verify), shape mismatch,
 * connected, or not-connected (with reason).
 */
import { h } from '../../dom';
import type { NotionStatus } from '../../../../src/shared/contract';
import { card } from '../../components/primitives';
import { subjectiveColumnsSection } from './subjectiveColumnsCard';
import { schemaProvisionSection } from './schemaProvisionCard';

/**
 * The connected-state summary: how many competitive games still need syncing, or
 * "up to date" (all synced) / "no competitive games yet" (nothing to sync ever) —
 * the two ways `unsyncedGames` can be `0` (spec E3).
 */
function syncSummary(s: NotionStatus): string {
  if (s.unsyncedGames > 0) return `${s.unsyncedGames} game${s.unsyncedGames === 1 ? '' : 's'} to sync`;
  return s.competitiveGames > 0 ? 'up to date' : 'no competitive games yet';
}

/** Top-of-screen status readout; `s === null` means the initial fetch hasn't resolved yet. */
export function statusCard(s: NotionStatus | null): HTMLElement {
  if (!s) {
    return card({ variant: 'raised' }, h('div', { class: 'u-muted' }, 'Checking connection…'));
  }
  const dot = (color: string) => h('span', { class: 'status-dot', style: { background: color } });

  // Takes precedence over both the shape-mismatch and connected states below:
  // when the last shape-validation attempt failed with a classified network
  // error, `shapeValid`/`shapeIssues` are deliberately left undefined (the
  // verdict is genuinely unknown, not false) — so without this branch an
  // offline user would fall through into a false "Connected to Notion".
  // `transportError` already carries a friendly, actionable message (never a
  // raw `String(err)`) from `main/notionRuntime.ts`.
  if (s.transportError) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--dim)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, 'Can’t verify database'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } }, s.transportError),
        ),
      ),
    );
  }

  if (s.connected && s.shapeValid === false) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--loss)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--loss-text)' } }, 'Database shape mismatch'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } },
            s.shapeIssues?.length ? `Missing: ${s.shapeIssues.join(', ')}` : 'One or more columns don’t match.'),
        ),
      ),
      // When auto-provisioning couldn't heal the shape (e.g. no schema-edit
      // permission), explain why the missing columns weren't added for the user.
      schemaProvisionSection(s.schemaProvision),
    );
  }

  if (s.connected) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--win)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--win-text)' } }, 'Connected to Notion'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } },
            s.databaseTitle ? `${s.databaseTitle} — ${syncSummary(s)}` : syncSummary(s)),
        ),
      ),
      subjectiveColumnsSection(s.subjectiveColumns),
      schemaProvisionSection(s.schemaProvision),
    );
  }
  const reason = !s.tokenSet
    ? 'No integration token yet — add one below.'
    : !s.databaseConfigured
      ? 'No database selected yet — pick one below or let Vantage create it.'
      : s.databaseSource === 'appsettings'
        ? 'Using database from appsettings.json (fallback) — pick one below to take over.'
        : 'Not ready.';
  return card({ variant: 'raised' },
    h('div', { class: 'notion-status' },
      dot('var(--dim)'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-name' }, 'Not connected'),
        h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } }, reason),
      ),
    ),
  );
}
