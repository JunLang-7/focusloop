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

export interface AppSettings {
  readonly locale: Locale;
  readonly theme: ThemePreference;
}
