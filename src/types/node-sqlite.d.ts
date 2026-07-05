/**
 * Minimal ambient typings for Node's built-in `node:sqlite` (experimental, present
 * in the Node 22/24 runtimes Vantage runs on — ow-electron 39 bundles Node 22.22).
 * `@types/node@20` doesn't ship these declarations yet, so this covers only the
 * synchronous subset the storage layer uses. Delete this shim once `@types/node`
 * is bumped to a version that includes `node:sqlite`.
 */
declare module 'node:sqlite' {
  /** Values SQLite can bind as parameters / return in a column. */
  type SQLInputValue = null | number | bigint | string | Uint8Array;
  /** One result row: column name → value. */
  type SQLOutputRow = Record<string, SQLInputValue>;

  interface StatementSync {
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLInputValue[]): SQLOutputRow | undefined;
    all(...params: SQLInputValue[]): SQLOutputRow[];
  }

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    readonly isOpen: boolean;
  }

  export { DatabaseSync, StatementSync, DatabaseSyncOptions, SQLInputValue, SQLOutputRow };
}
