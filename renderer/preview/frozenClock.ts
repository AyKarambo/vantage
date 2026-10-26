/**
 * `?now=<epoch ms>` pins the preview's clock: `Date.now()`, `new Date()` and a
 * bare `Date()` all read that instant, while `new Date(x)` still parses `x`.
 * Everything the app shows is relative to "now" (the sample season, "3 days
 * ago", today's session), so a pinned clock renders the same screens on any
 * day — what the visual regression run (`npm run test:visual`) relies on.
 *
 * The preview imports this module first, so the pin is in place before any
 * other module (or the sample season) reads the time.
 */
export const pinnedNow: number | undefined = (() => {
  const raw = new URLSearchParams(location.search).get('now');
  const at = raw === null ? NaN : Number(raw);
  return Number.isFinite(at) && at > 0 ? at : undefined;
})();

if (pinnedNow !== undefined) {
  const at = pinnedNow;
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [at], newTarget),
    apply: () => new RealDate(at).toString(),
    get: (target, prop, receiver) => (prop === 'now' ? () => at : Reflect.get(target, prop, receiver)),
  });
}
