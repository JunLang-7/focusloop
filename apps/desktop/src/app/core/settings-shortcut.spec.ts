import { describe, expect, it } from 'vitest';
import { isSettingsShortcut, type SettingsShortcutInput } from './settings-shortcut';

const comma = (overrides: Partial<SettingsShortcutInput> = {}): SettingsShortcutInput => ({
  key: ',',
  code: 'Comma',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  isComposing: false,
  ...overrides,
});

describe('application settings shortcut', () => {
  it('uses Command on macOS, and Control on Windows and Linux', () => {
    expect(isSettingsShortcut(comma({ metaKey: true }), 'darwin')).toBe(true);
    for (const platform of ['win32', 'linux'])
      expect(isSettingsShortcut(comma({ ctrlKey: true }), platform)).toBe(true);
  });

  it('does not accept the opposite modifier, both modifiers, or an unmodified comma', () => {
    expect(isSettingsShortcut(comma({ ctrlKey: true }), 'darwin')).toBe(false);
    for (const platform of ['win32', 'linux'])
      expect(isSettingsShortcut(comma({ metaKey: true }), platform)).toBe(false);
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(isSettingsShortcut(comma(), platform)).toBe(false);
      expect(isSettingsShortcut(comma({ metaKey: true, ctrlKey: true }), platform)).toBe(false);
    }
  });

  it.each(['altKey', 'shiftKey', 'repeat', 'defaultPrevented', 'isComposing'] as const)(
    'does not intercept %s',
    (flag) => {
      expect(isSettingsShortcut(comma({ metaKey: true, [flag]: true }), 'darwin')).toBe(false);
      expect(isSettingsShortcut(comma({ ctrlKey: true, [flag]: true }), 'win32')).toBe(false);
      expect(isSettingsShortcut(comma({ ctrlKey: true, [flag]: true }), 'linux')).toBe(false);
    },
  );

  it('accepts a comma on another keyboard layout or the physical Comma key', () => {
    expect(isSettingsShortcut(comma({ metaKey: true, code: 'KeyM' }), 'darwin')).toBe(true);
    expect(isSettingsShortcut(comma({ ctrlKey: true, key: '，' }), 'win32')).toBe(true);
    expect(isSettingsShortcut(comma({ ctrlKey: true, key: 'c', code: 'KeyC' }), 'linux')).toBe(
      false,
    );
  });
});
