/**
 * Pure formatting for the About screen. Turns an {@link AppInfo} into the
 * ordered build/runtime rows shown on screen and the plain-text diagnostics
 * block copied for bug reports — one source for both, so they can never drift.
 *
 * No Electron, no clock/env reads: the same `AppInfo` always yields the same
 * output, so it's unit-testable and drives the browser preview harness.
 */
import type { AppInfo } from '../shared/contract';

/** One label/value line in the About build-info list. */
export interface AboutRow {
  label: string;
  value: string;
}

/** The ordered build & runtime rows shown on the About screen. */
export function buildAboutRows(info: AppInfo): AboutRow[] {
  return [
    { label: 'Version', value: info.version },
    { label: 'Build', value: info.packaged ? 'Installed' : 'Dev build' },
    { label: 'Electron', value: info.electron },
    { label: 'Chromium', value: info.chromium },
    { label: 'Node', value: info.node },
    { label: 'V8', value: info.v8 },
    { label: 'Platform', value: info.platform },
    { label: 'OS', value: info.osRelease },
  ];
}

/**
 * The plain-text block behind "Copy diagnostics": a product/version header plus
 * one `label: value` line per row, the labels padded so values line up when
 * pasted into a bug report.
 */
export function formatDiagnostics(info: AppInfo): string {
  const rows = buildAboutRows(info);
  const width = Math.max(...rows.map((r) => r.label.length));
  const lines = rows.map((r) => `${r.label.padEnd(width)}  ${r.value}`);
  return [`Vantage ${info.version}`, ...lines].join('\n');
}
