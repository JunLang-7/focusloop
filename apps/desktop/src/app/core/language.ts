/**
 * Language is a document property, not only a dictionary lookup.
 *
 * `<html lang>` is what a screen reader uses to choose a voice, and what the browser uses
 * for hyphenation and spell-check. The markup ships `lang="en"`, which matches
 * `DEFAULT_LOCALE`, so the first paint is honest before Angular has booted — but from then
 * on the attribute has to follow the learner, or a Chinese screen is read with an English
 * voice.
 */
import type { Locale } from '@focusloop/shared-types';

export function applyLanguage(root: HTMLElement, locale: Locale): void {
  root.lang = locale;
}
