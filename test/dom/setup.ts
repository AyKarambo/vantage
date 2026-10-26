/**
 * The DOM tests pin rendered text ("Monday, September 21", "20:00"), which
 * Intl formats per the machine's locale. The time zone is pinned to UTC by the
 * vitest project's env; this pins the default locale to en-US — Node on
 * Windows takes it from the OS, with no env var to override it — by filling
 * in the locale wherever the renderer leaves it to the default.
 */
const LOCALE = 'en-US';

const INTL_CONSTRUCTORS = ['DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'Collator', 'ListFormat'] as const;
for (const name of INTL_CONSTRUCTORS) {
  const Original = Intl[name] as unknown as new (...args: unknown[]) => object;
  (Intl as unknown as Record<string, unknown>)[name] = new Proxy(Original, {
    construct: (target, [locales, options], newTarget) => Reflect.construct(target, [locales ?? LOCALE, options], newTarget),
    apply: (target, self, [locales, options]) => Reflect.apply(target as unknown as (...a: unknown[]) => unknown, self, [locales ?? LOCALE, options]),
  });
}

type LocaleMethod = (this: unknown, locales?: string | string[], options?: object) => string;
function pinLocaleArg(proto: object, method: string): void {
  const original = (proto as Record<string, LocaleMethod>)[method];
  (proto as Record<string, LocaleMethod>)[method] = function (locales, options) {
    return original.call(this, locales ?? LOCALE, options);
  };
}
for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) pinLocaleArg(Date.prototype, m);
pinLocaleArg(Number.prototype, 'toLocaleString');
pinLocaleArg(Array.prototype, 'toLocaleString');

const localeCompare = String.prototype.localeCompare;
String.prototype.localeCompare = function (that: string, locales?: string | string[], options?: Intl.CollatorOptions) {
  return localeCompare.call(this, that, locales ?? LOCALE, options);
};
