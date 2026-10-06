import type { RuntimeInfo } from '@focusloop/shared-types';

/**
 * Whether the developer surfaces are on screen at all.
 *
 * The simulator bar and the context inspector are the two things a learner must never see, and until
 * now each of them asked the question itself, with the same expression copied — so "absent from a
 * packaged build" was a property of two files agreeing rather than of one rule.
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
