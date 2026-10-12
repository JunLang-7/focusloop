export type SettingsShortcutInput = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'metaKey'
  | 'ctrlKey'
  | 'altKey'
  | 'shiftKey'
  | 'repeat'
  | 'defaultPrevented'
  | 'isComposing'
>;

/** Window-local Settings binding; never intercept modified shortcuts or IME composition. */
export function isSettingsShortcut(input: SettingsShortcutInput, platform: string): boolean {
  if (
    input.defaultPrevented ||
    input.repeat ||
    input.isComposing ||
    input.altKey ||
    input.shiftKey ||
    (input.key !== ',' && input.code !== 'Comma')
  ) {
    return false;
  }
  return platform === 'darwin' ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
}
