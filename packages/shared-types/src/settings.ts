/**
 * Application settings.
 *
 * The store owns these, not the renderer: the interface language and theme have
 * to survive a restart, and they belong with the rest of the learner's local data.
 */

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function coerceLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * `system` follows the OS setting; the other two override it.
 *
 * The app does not pick a theme on the learner's behalf by default, so this is
 * stored as the *preference*, not as the resolved light/dark value.
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function coerceTheme(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME;
}

/**
 * How a time of day is written.
 *
 * `24h` is `13:05`, `12h` is `1:05 PM`. A *duration* is never affected: `1:05` on the focus timer is
 * minutes and seconds and reads the same in both. This is a display preference for timestamps, stored
 * rather than derived from the locale because English is written both ways.
 */
export const CLOCK_FORMATS = ['24h', '12h'] as const;

export type ClockFormat = (typeof CLOCK_FORMATS)[number];

export const DEFAULT_CLOCK_FORMAT: ClockFormat = '24h';

export function isClockFormat(value: unknown): value is ClockFormat {
  return typeof value === 'string' && (CLOCK_FORMATS as readonly string[]).includes(value);
}

export function coerceClockFormat(value: unknown): ClockFormat {
  return isClockFormat(value) ? value : DEFAULT_CLOCK_FORMAT;
}

export interface AppSettings {
  readonly locale: Locale;
  readonly theme: ThemePreference;
  /** `24h` writes `13:05`, `12h` writes `1:05 PM`; see `ClockFormat`. */
  readonly clockFormat: ClockFormat;
  /**
   * Whether a course shows the text it was generated from.
   *
   * The material is the learner's own upload, and not everyone wants it in front of them: one
   * learner reads the concepts and the tasks, another wants the whole section. Which of those is
   * wanted is not this module's decision, so it is stored rather than assumed.
   */
  readonly showMaterialText: boolean;
  /**
   * Whether a generated ambient sound plays while a session runs (#57).
   *
   * A preference, not a playback state: the layer still needs a running session, so a stored `true`
   * never makes sound begin on its own after a restart.
   */
  readonly ambientSound: boolean;
}

export const DEFAULT_SHOW_MATERIAL_TEXT = true;

export function coerceShowMaterialText(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  // `app_meta` stores strings, so the persisted form is the word rather than the primitive.
  if (value === 'true') return true;
  if (value === 'false') return false;
  return DEFAULT_SHOW_MATERIAL_TEXT;
}

export const DEFAULT_AMBIENT_SOUND = false;

export function coerceAmbientSound(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  // Stored as the word, like the preference above: `app_meta` holds strings.
  if (value === 'true') return true;
  if (value === 'false') return false;
  return DEFAULT_AMBIENT_SOUND;
}
