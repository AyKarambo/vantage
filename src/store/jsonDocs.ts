/**
 * Where the JSON side-stores keep their state: one named JSON document per
 * store. The stores only ever see this interface, so they carry no `fs`
 * import — main hands them {@link ./jsonFiles jsonFiles(dir)} (atomic files in
 * the data folder), the browser preview a localStorage-backed location.
 */
export interface JsonDoc {
  /** The parsed document; `undefined` when it is missing or unreadable. */
  read(): unknown;
  /** Replace the document atomically. */
  write(value: unknown): void;
  /** Remove the document. */
  clear(): void;
  /** Point at the same-named document under another directory (the data-folder move); content is not copied. */
  relocate(dir: string): void;
}

/** A storage location: the document of a given file name (e.g. `manual.json`). */
export type JsonDocs = (name: string) => JsonDoc;
