import { createHash } from 'node:crypto';
import type {
  MaterialDocument,
  MaterialFormat,
  MaterialImportInput,
  MaterialImportResult,
  MaterialSection,
} from '@focusloop/shared-types';

export type MaterialParseFailure = 'unsupported-format' | 'empty-content' | 'too-large';

export class MaterialParseError extends Error {
  readonly reason: MaterialParseFailure;

  constructor(reason: MaterialParseFailure, message: string) {
    super(message);
    this.name = 'MaterialParseError';
    this.reason = reason;
  }
}

/** 5 MiB of text is far beyond anything the demo needs and keeps parsing snappy. */
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

const EXTENSION_FORMATS: Record<string, MaterialFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.txt': 'text',
  '.text': 'text',
};

/** `.pdf` is a stretch goal; recognising it lets us fail with a clear message. */
const KNOWN_UNSUPPORTED = ['.pdf', '.docx', '.doc', '.epub', '.html', '.htm'];

export function detectFormat(fileName: string): MaterialFormat | null {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = lower.slice(dot);
  return EXTENSION_FORMATS[extension] ?? null;
}

export function isKnownUnsupported(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return KNOWN_UNSUPPORTED.includes(lower.slice(dot));
}

/**
 * Normalises raw text so the same document always produces the same hash:
 * LF line endings, no trailing spaces, no runs of blank lines.
 */
export function normalizeContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  // A leading dot means the whole name is an extension (e.g. ".md") — there is
  // no stem to use, so fall back rather than inventing a title.
  const withoutExtension = dot > 0 ? base.slice(0, dot) : dot === 0 ? '' : base;
  return withoutExtension.replace(/[_-]+/g, ' ').trim() || 'Untitled material';
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface Heading {
  readonly depth: number;
  readonly title: string;
  readonly line: number;
}

function findHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match !== null) {
      headings.push({ depth: match[1]!.length, title: match[2]!, line: index });
    }
  });
  return headings;
}

function splitMarkdown(content: string, fallbackTitle: string): MaterialSection[] {
  const lines = content.split('\n');
  const headings = findHeadings(lines);
  const sections: MaterialSection[] = [];

  if (headings.length === 0) {
    return [
      {
        id: 'sec-1',
        heading: fallbackTitle,
        body: content,
        order: 0,
        depth: 1,
      },
    ];
  }

  const preamble = lines.slice(0, headings[0]!.line).join('\n').trim();
  if (preamble.length > 0) {
    sections.push({ id: 'sec-1', heading: fallbackTitle, body: preamble, order: 0, depth: 1 });
  }

  headings.forEach((heading, index) => {
    const start = heading.line + 1;
    const end = index + 1 < headings.length ? headings[index + 1]!.line : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    sections.push({
      id: `sec-${sections.length + 1}`,
      heading: heading.title,
      body,
      order: sections.length,
      depth: heading.depth,
    });
  });

  return sections;
}

function splitPlainText(content: string): MaterialSection[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.map((paragraph, index) => {
    const firstLine = paragraph.split('\n')[0] ?? '';
    const heading = firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}...`;
    return { id: `sec-${index + 1}`, heading, body: paragraph, order: index, depth: 1 };
  });
}

export interface ParseMaterialInput extends MaterialImportInput {
  /**
   * Import timestamp. Injected rather than read from the clock so the parser
   * stays a pure function and tests can assert on the whole document.
   */
  readonly now?: string;
}

/**
 * Parses an imported `.txt`/`.md` file into the normalised document shape the
 * rest of the pipeline consumes. Pure: no IO, no randomness.
 */
export function parseMaterial(input: ParseMaterialInput): MaterialImportResult {
  const format = detectFormat(input.fileName);
  if (format === null) {
    throw new MaterialParseError(
      'unsupported-format',
      isKnownUnsupported(input.fileName)
        ? `${input.fileName} is not supported yet (only .txt and .md are).`
        : `Cannot determine a supported format for ${input.fileName}.`,
    );
  }

  if (Buffer.byteLength(input.content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new MaterialParseError('too-large', 'Material is larger than the 5 MiB import limit.');
  }

  const normalized = normalizeContent(input.content);
  const warnings: string[] = [];

  if (normalized.length === 0) {
    warnings.push('The file was empty, so no sections were created.');
  }

  const fallbackTitle = titleFromFileName(input.fileName);
  const sections =
    normalized.length === 0
      ? []
      : format === 'markdown'
        ? splitMarkdown(normalized, fallbackTitle)
        : splitPlainText(normalized);

  const firstHeading = sections.find((section) => section.depth === 1)?.heading;
  const title = format === 'markdown' && firstHeading !== undefined ? firstHeading : fallbackTitle;

  if (sections.length > 0 && sections.every((section) => section.body.length === 0)) {
    warnings.push('Every section was empty — the material may not contain readable text.');
  }

  const contentHash = hashContent(normalized);

  const document: MaterialDocument = {
    id: `material-${contentHash.slice(0, 12)}`,
    title,
    format,
    source: 'imported',
    sections,
    contentHash,
    importedAt: input.now ?? new Date().toISOString(),
    warnings,
  };

  return { document, warnings };
}
