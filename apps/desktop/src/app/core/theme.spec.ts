import { describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('honours an explicit preference whatever the OS says', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS for `system`', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  it('falls back to dark for an unknown preference', () => {
    // The stylesheet is authored dark-first, so that is the safe default.
    expect(resolveTheme('sepia' as never, true)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('writes the resolved theme onto the document element', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyTheme(root, 'light');
    expect(root.dataset['theme']).toBe('light');
    applyTheme(root, 'dark');
    expect(root.dataset['theme']).toBe('dark');
  });
});
