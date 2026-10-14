import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './settings';

/**
 * The reminder's two sentences, held here rather than in the renderer's dictionary because two
 * processes say them: the window when the app is open, and the platform scheduler when it is not.
 * One source, so the notification reads the same either way.
 */
export const REMINDER_COPY: Record<Locale, { readonly title: string; readonly body: string }> = {
  en: {
    title: 'Time to study',
    body: 'A few focused minutes is enough. FocusLoop is ready when you are.',
  },
  zh: {
    title: '该学习了',
    body: '几分钟也算。准备好了就打开 FocusLoop。',
  },
};

/**
 * The supported locale closest to a BCP-47 tag, or the default.
 *
 * Matching is on the primary subtag, because a tag has region and script parts the app does not
 * support: `zh-CN`, `zh-Hans` and `zh-Hant` are all the one Chinese bundle this app ships, and a
 * machine set to `zh-TW` should get Chinese rather than fall through to English. An unsupported
 * language (`fr-CA`) is not a guess worth making, so it takes the default.
 */
export function detectLocale(tag: string | undefined | null): Locale {
  if (typeof tag !== 'string' || tag.length === 0) return DEFAULT_LOCALE;
  const primary = tag.toLowerCase().split('-')[0] ?? '';
  const match = SUPPORTED_LOCALES.find((locale) => locale === primary);
  return match ?? DEFAULT_LOCALE;
}
