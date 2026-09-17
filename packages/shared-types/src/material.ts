/** Imported learning material, normalised to a single deterministic shape. */
export type MaterialFormat = 'text' | 'markdown' | 'pdf';
export type MaterialSource = 'builtin' | 'imported';

export interface MaterialSection {
  readonly id: string;
  readonly heading: string;
  readonly body: string;
  /** Zero-based position inside the document. */
  readonly order: number;
  /** Best-effort heading depth (1 for `#`, 2 for `##`, ...). */
  readonly depth: number;
}

export interface MaterialDocument {
  readonly id: string;
  readonly title: string;
  readonly format: MaterialFormat;
  readonly source: MaterialSource;
  readonly sections: readonly MaterialSection[];
  /** SHA-256 hex of the normalised raw content. Used for dedupe + determinism. */
  readonly contentHash: string;
  readonly importedAt: string;
  readonly warnings: readonly string[];
}

export interface MaterialImportInput {
  readonly fileName: string;
  readonly content: string;
}

export interface MaterialImportResult {
  readonly document: MaterialDocument;
  readonly warnings: readonly string[];
}
