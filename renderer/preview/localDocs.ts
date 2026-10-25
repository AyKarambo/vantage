import type { JsonDocs } from '../../src/store/jsonDocs';

/**
 * The preview's storage location: each store's JSON document under
 * `<prefix>:<name>` in localStorage, so harness writes survive a reload the way
 * the app's survive a restart. Storage failures (private mode, quota) degrade
 * to an in-memory session instead of throwing.
 */
export function localDocs(prefix: string): JsonDocs {
  return (name) => {
    const key = `${prefix}:${name}`;
    return {
      read: () => {
        try {
          const raw = localStorage.getItem(key);
          return raw == null ? undefined : JSON.parse(raw);
        } catch {
          return undefined;
        }
      },
      write: (value) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* storage unavailable */
        }
      },
      clear: () => {
        try {
          localStorage.removeItem(key);
        } catch {
          /* storage unavailable */
        }
      },
      // There is no folder to move to in a browser.
      relocate: () => {},
    };
  };
}
