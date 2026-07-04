/**
 * Notion connection status card — reads the current `NotionStatus` snapshot and
 * renders one of: loading, shape mismatch, connected, or not-connected (with reason).
 */
import { h } from '../../dom';
import type { NotionStatus } from '../../../../src/shared/contract';
import { card } from '../../components/primitives';

/** Top-of-screen status readout; `s === null` means the initial fetch hasn't resolved yet. */
export function statusCard(s: NotionStatus | null): HTMLElement {
  if (!s) {
    return card({ variant: 'raised' }, h('div', { class: 'u-muted' }, 'Checking connection…'));
  }
  const dot = (color: string) => h('span', { class: 'status-dot', style: { background: color } });

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
    );
  }

  if (s.connected) {
    return card({ variant: 'raised' },
      h('div', { class: 'notion-status' },
        dot('var(--win)'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name', style: { color: 'var(--win-text)' } }, 'Connected to Notion'),
          h('div', { class: 'u-dim', style: { fontSize: '11.5px', marginTop: '2px' } },
            s.databaseTitle
              ? `${s.databaseTitle} — ${s.trackedGames} tracked game${s.trackedGames === 1 ? '' : 's'} ready to sync`
              : `${s.trackedGames} tracked game${s.trackedGames === 1 ? '' : 's'} ready to sync`),
        ),
      ),
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
