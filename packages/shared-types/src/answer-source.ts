import { LEARNER_ANSWER_CHARACTERS } from './quiz';

/**
 * Where the words in an answer box can come from, besides the keyboard.
 *
 * An answer is the one thing this product asks the learner to *produce*, and a learner who has a PDF of
 * their notes, a photograph of a whiteboard or a Word document they wrote earlier should not have to
 * retype any of it. This is the vocabulary for reading that text out of a file: what can be read, what
 * came out of it, and what happened when nothing could be.
 *
 * Pure vocabulary and three pure helpers, because the two halves that matter are both testable without a
 * window: which reader a file name selects, and what happens to text that is longer than the box it is
 * going into. The readers themselves live in the main process, where the file system is.
 */

/** The two kinds of file an answer is read out of, which is also what the file dialog offers. */
export type AnswerSourceKind = 'document' | 'image';

/**
 * How the text was obtained. Named because the learner is told: "read from the PDF", "recognised from
 * the image" and "read from the text file" are three different degrees of trustworthiness, and a
 * mis-recognised character is something they need to know to look for.
 */
export type AnswerSourceMethod = 'text' | 'pdf' | 'docx' | 'ocr';

/**
 * Why nothing came of it. Distinct reasons rather than a message, because each one is a different thing
 * for the learner to do about it — and because the wording lives in the shell, in both languages.
 */
export type AnswerSourceRefusalReason =
  /** The extension is not one this can read. */
  | 'unsupported'
  /** Bigger than `ANSWER_SOURCE_LIMITS.bytes`: refused whole rather than half-read. */
  | 'too-big'
  /** The file could not be read or parsed at all. */
  | 'unreadable'
  /** Read, but there was no text in it — a scan with no words on it, an empty document. */
  | 'no-text';

export const ANSWER_SOURCE_LIMITS = {
  /** What can go in the box is what the box holds: the record's own bound. */
  characters: LEARNER_ANSWER_CHARACTERS,
  /**
   * Read whole or not at all.
   *
   * A limit rather than a size guarantee: the file is read into memory before it is parsed, and an OCR
   * pass on a large photograph is minutes of work. A learner who picks a 200 MB scan is told so instead
   * of watching the app stop responding.
   */
  bytes: 25 * 1024 * 1024,
} as const;

/**
 * What each kind offers, as extensions.
 *
 * Extensions and not MIME types: the file dialog filters on extensions, the check has to agree with what
 * the dialog allowed, and a file's declared type is a guess anyway. `.doc` is deliberately absent — the
 * old binary format is not something any of these readers handles, and offering it would produce a
 * "could not read" for a Word file the learner can see.
 */
export const ANSWER_SOURCE_EXTENSIONS: Readonly<Record<AnswerSourceKind, readonly string[]>> = {
  document: ['.txt', '.text', '.md', '.markdown', '.pdf', '.docx'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'],
};

/** The text that came out of a file, ready to be put in an answer box. */
export interface AnswerSourceResult {
  readonly path: string;
  /** The file's own name, for the line that says where this text came from. */
  readonly name: string;
  readonly kind: AnswerSourceKind;
  readonly method: AnswerSourceMethod;
  readonly text: string;
  /** True when the file held more text than the box can carry, so the end was left out. */
  readonly truncated: boolean;
}

export interface AnswerSourceRefusal {
  readonly reason: AnswerSourceRefusalReason;
  readonly name: string;
}

/**
 * The answer to "read this file for me".
 *
 * Both fields are nullable and exactly one is set, or neither: neither is a learner who closed the file
 * dialog, which is not a refusal and has nothing to report — and treating it as one would put an error
 * on screen for pressing Cancel.
 */
export interface AnswerSourceResponse {
  readonly source: AnswerSourceResult | null;
  readonly refusal: AnswerSourceRefusal | null;
}

/** The extension of a file name, lower case, or an empty string when it has none. */
export function answerSourceExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** Which kind of file this is, or `null` when it is neither. */
export function answerSourceKindOf(name: string): AnswerSourceKind | null {
  const extension = answerSourceExtension(name);
  if (extension === '') return null;
  for (const kind of ['document', 'image'] as const) {
    if (ANSWER_SOURCE_EXTENSIONS[kind].includes(extension)) return kind;
  }
  return null;
}

/**
 * How this file's text will be read, or `null` when the extension is not one of them.
 *
 * The extension decides, and only the extension: whether a `.pdf` really is a PDF is the reader's answer
 * to give, and it gives it by failing.
 */
export function answerSourceMethodOf(name: string): AnswerSourceMethod | null {
  const extension = answerSourceExtension(name);
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (answerSourceKindOf(name) === 'image') return 'ocr';
  if (answerSourceKindOf(name) === 'document') return 'text';
  return null;
}

/**
 * The text, cut to what the box can hold.
 *
 * Cut rather than refused, unlike the answer the learner types: they asked for this file to be read, and
 * the beginning of a document is far more use in the box than a refusal — with `truncated` saying that
 * the end is missing, so the screen can tell them and they can edit what they got.
 */
export function boundAnswerSourceText(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= ANSWER_SOURCE_LIMITS.characters) {
    return { text: trimmed, truncated: false };
  }
  return { text: trimmed.slice(0, ANSWER_SOURCE_LIMITS.characters), truncated: true };
}
