import type { Page } from '@playwright/test';

/** The demo commands the app's own seam accepts (`SimulatorCommand['command']`). */
export type DemoCommand = 'distraction' | 'return' | 'confusion' | 'overload' | 'success';

export function fireDemoEvent(page: Page, command: DemoCommand): Promise<void>;
