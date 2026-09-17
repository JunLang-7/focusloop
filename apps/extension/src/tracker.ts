import type { BridgeInboundType, BridgePayload } from '@focusloop/shared-types';

export type TrackerEmission = { readonly type: BridgeInboundType; readonly payload: BridgePayload };

export interface TrackerSnapshot {
  readonly learningTabId: number | null;
  readonly awaySince: number | null;
  readonly idleSince: number | null;
}

/**
 * Pure tab/idle tracking. No Chrome API, no clock, no IO — so it is fully
 * unit-testable and reviewable.
 *
 * It only ever knows *tab ids* and *durations*. It cannot read a URL, a title or
 * any page content, because the extension does not request the `tabs`
 * permission at all.
 */
export class ActivityTracker {
  private learningTabId: number | null = null;
  private awaySince: number | null = null;
  private idleSince: number | null = null;

  /** Marks the tab the learner is studying in. */
  bindLearningTab(tabId: number): void {
    this.learningTabId = tabId;
    this.awaySince = null;
  }

  snapshot(): TrackerSnapshot {
    return {
      learningTabId: this.learningTabId,
      awaySince: this.awaySince,
      idleSince: this.idleSince,
    };
  }

  /**
   * The learner switched tabs. The first activation we ever see becomes the
   * learning tab, so the extension works without configuration.
   */
  onTabActivated(tabId: number, now: number): TrackerEmission | null {
    if (this.learningTabId === null) {
      this.learningTabId = tabId;
      return null;
    }
    if (tabId === this.learningTabId) {
      if (this.awaySince === null) return null;
      const awayMs = Math.max(0, now - this.awaySince);
      this.awaySince = null;
      return { type: 'TAB_RETURNED', payload: { awayMs } };
    }
    if (this.awaySince !== null) return null;
    this.awaySince = now;
    return { type: 'TAB_LEFT', payload: {} };
  }

  /** The window lost focus entirely (minimised, or another app is in front). */
  onWindowFocusLost(now: number): TrackerEmission | null {
    if (this.learningTabId === null || this.awaySince !== null) return null;
    this.awaySince = now;
    return { type: 'TAB_LEFT', payload: {} };
  }

  onWindowFocusGained(now: number): TrackerEmission | null {
    if (this.awaySince === null) return null;
    const awayMs = Math.max(0, now - this.awaySince);
    this.awaySince = null;
    return { type: 'TAB_RETURNED', payload: { awayMs } };
  }

  onIdleStateChanged(state: 'active' | 'idle' | 'locked', now: number): TrackerEmission | null {
    if (state === 'active') {
      if (this.idleSince === null) return null;
      const idleMs = Math.max(0, now - this.idleSince);
      this.idleSince = null;
      return { type: 'IDLE_ENDED', payload: { idleMs } };
    }
    if (this.idleSince !== null) return null;
    this.idleSince = now;
    return { type: 'IDLE_STARTED', payload: {} };
  }

  reset(): void {
    this.learningTabId = null;
    this.awaySince = null;
    this.idleSince = null;
  }
}
