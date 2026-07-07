/**
 * External-link safety. The dashboard window is navigation-hardened
 * (`hardenWebContents` denies popups and cancels in-window navigation), so every
 * outbound link is opened by the main process via `shell.openExternal`. This is
 * the allowlist guarding that path: only well-formed URLs with a safe scheme are
 * ever handed to the OS. Pure and Electron-free, so it's unit-testable and the
 * same guard runs in the browser preview.
 */

/** Schemes permitted for `shell.openExternal` (support mailto + secure web). */
const ALLOWED_SCHEMES = new Set(['mailto:', 'https:']);

/** True only for a parseable URL whose scheme is on the allowlist. */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_SCHEMES.has(parsed.protocol);
}

/**
 * Invoke `open` with `url` only when it passes {@link isAllowedExternalUrl};
 * returns whether it opened. The seam the provider composes over Electron's
 * `shell.openExternal`, kept pure so the guard is testable without the shell.
 */
export async function openIfAllowed(url: string, open: (u: string) => void | Promise<void>): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) return false;
  await open(url);
  return true;
}
