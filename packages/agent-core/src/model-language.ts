import type { Locale } from '@focusloop/shared-types';

/**
 * The language a locale's answers are written in, named for the model rather than as a tag.
 *
 * `Record<Locale, string>` on purpose: a locale added to `SUPPORTED_LOCALES` without a wording here
 * fails the typecheck instead of sending an instruction that names nothing.
 */
const REPLY_LANGUAGES: Record<Locale, string> = {
  en: 'English',
  zh: 'Simplified Chinese',
};

/**
 * One sentence every prompt carries: the answer is in the language of the interface.
 *
 * The learner reads the app in one language and may have imported material, asked a question or been
 * shown a task in another. Without this the model answers in the language of whatever it was given —
 * the material's — and the interface around that answer is the learner's other one. The interface's
 * language decides, because the answer is read next to it.
 *
 * A sentence rather than the tag, because `zh` may or may not be read as "write Chinese"; a
 * separate function rather than a constant, so every prompt builder appends the length it is
 * charged for and cannot send an instruction that was never counted.
 */
export function replyLanguageInstruction(locale: Locale): string {
  const language = REPLY_LANGUAGES[locale];
  return (
    `Always answer in ${language}, the language of the interface. ` +
    `If the material or the question is in another language, still answer in ${language}.`
  );
}
