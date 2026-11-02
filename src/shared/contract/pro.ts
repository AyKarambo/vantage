/**
 * Vantage Pro purchase actions (spec #337). The tier itself rides on the
 * dashboard payload (`DashboardData.pro`); these are the user-initiated asks.
 */
export type ProAction = 'startTrial' | 'upgrade' | 'manage';

/**
 * `unavailable` = no purchase source is wired yet (the Overwolf/Tebex source is
 * pending DevRel) — the UI says "coming soon" instead of failing.
 */
export type ProActionResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'failed'; message?: string };
