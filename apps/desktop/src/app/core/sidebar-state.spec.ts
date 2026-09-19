import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_INITIAL_MODE,
  collapseSidebar,
  expandSidebar,
  isSidebarHidden,
  leaveFocusScreen,
} from './sidebar-state';

describe('collapseSidebar', () => {
  it('hides the sidebar from any mode, including focus recall', () => {
    expect(collapseSidebar('auto')).toBe('collapsed');
    expect(collapseSidebar('collapsed')).toBe('collapsed');
    expect(collapseSidebar('open')).toBe('collapsed');
  });
});

describe('expandSidebar', () => {
  it('recalls the sidebar through the floating button', () => {
    expect(expandSidebar('auto')).toBe('open');
    expect(expandSidebar('collapsed')).toBe('open');
  });
});

describe('leaveFocusScreen', () => {
  it('forgets a focus recall but keeps a deliberate collapse', () => {
    // The floating button was pressed during focus; leaving focus falls back to normal.
    expect(leaveFocusScreen('open')).toBe('auto');
    // The user closed the sidebar themselves; that choice survives the session.
    expect(leaveFocusScreen('collapsed')).toBe('collapsed');
    expect(leaveFocusScreen('auto')).toBe('auto');
  });
});

describe('isSidebarHidden', () => {
  it('is visible in auto mode while no focus commitment runs', () => {
    expect(isSidebarHidden('auto', false)).toBe(false);
  });

  it('is hidden in auto mode while focus runs — fully, not down to icons', () => {
    expect(isSidebarHidden('auto', true)).toBe(true);
  });

  it('a deliberate collapse hides it on every screen', () => {
    expect(isSidebarHidden('collapsed', false)).toBe(true);
    expect(isSidebarHidden('collapsed', true)).toBe(true);
  });

  it('a recall shows it even while focus runs', () => {
    expect(isSidebarHidden('open', true)).toBe(false);
    expect(isSidebarHidden('open', false)).toBe(false);
  });
});

describe('SIDEBAR_INITIAL_MODE', () => {
  it('boots without having spoken', () => {
    expect(SIDEBAR_INITIAL_MODE).toBe('auto');
  });
});
