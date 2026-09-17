/**
 * Theme resolution.
 *
 * The stored value is a *preference* (`system` / `light` / `dark`); what the
 * document gets is a *resolved* theme. Keeping them apart is what lets `system`
 * keep following the OS after the learner has opened the app.
 */
import type { ThemePreference } from '@focusloop/shared-types';

export type ResolvedTheme = 'light' | 'dark';

/** `prefersLight` is the OS answer, only consulted for the `system` preference. */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  switch (preference) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return prefersLight ? 'light' : 'dark';
    default:
      return 'dark';
  }
}

/**
 * Writes the theme onto `<html data-theme>`, which is the single hook the
 * stylesheet switches on. Setting it here means no component needs to know how
 * theming works.
 */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset['theme'] = theme;
}
