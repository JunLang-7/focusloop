import type { RuntimeInfo } from '@focusloop/shared-types';

/**
 * Whether the developer surfaces are on screen at all.
 *
 * The simulator bar is the one thing a learner must never see, and it asks this rather than
 * inferring the answer: "absent from a packaged build" should be one rule, not a property of every
 * file that happens to draw a developer control agreeing with the others.
 *
 * The main process decides. `apps/desktop/electron/service.ts` reports
 * `simulatorEnabled: options.simulatorEnabled ?? !app.isPackaged`, so a packaged build answers `false`
 * and the renderer never infers it from a build flag it does not own. An answer that has not arrived
 * yet (`runtime()` is null until the first IPC round trip) counts as off: a developer surface that
 * flashes on a learner's screen because a round trip was in flight is the one failure mode worth
 * designing out.
 */
export function developerModeEnabled(runtime: RuntimeInfo | null | undefined): boolean {
  return runtime?.simulatorEnabled ?? false;
}
