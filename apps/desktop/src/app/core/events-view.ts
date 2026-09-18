/**
 * Presentation helpers for the event log.
 *
 * The log is an audit tail, not a story: the demo simulator alone fires three
 * `HELP_REQUESTED` events for a single click, and drawing one bordered card per event
 * made those three identical cards the heaviest thing on the dashboard.
 *
 * Pure functions only, so the folding is unit-tested instead of being eyeballed.
 */
import type { LearningEvent } from '@focusloop/shared-types';

/** A run of consecutive events sharing a type and a source. */
export interface EventGroup {
  readonly type: LearningEvent['type'];
  readonly source: LearningEvent['source'];
  /** Newest first, in the order they were given. */
  readonly events: readonly LearningEvent[];
  readonly count: number;
  readonly newestAt: string;
  readonly oldestAt: string;
  /**
   * The *oldest* event's id, which is what makes this usable as a `track` key.
   *
   * Using the newest would rebuild the row every time one more event of the same type
   * arrived, because that event becomes the newest.
   */
  readonly id: string;
}

/** Mutable while runs are still being extended. */
interface Run {
  readonly type: LearningEvent['type'];
  readonly source: LearningEvent['source'];
  readonly events: LearningEvent[];
  newestAt: string;
  oldestAt: string;
  /** The oldest event so far: what the run is keyed by. */
  oldestId: string;
}

/**
 * Folds consecutive events of the same type and source into one row.
 *
 * Runs are formed over the order given, so the caller's order is the order the log
 * reads in: pass newest-first and the newest run becomes the first row.
 *
 * Only *adjacent* repeats fold. `HELP_REQUESTED`, `TAB_LEFT`, `HELP_REQUESTED` stays two
 * rows, because that is what the log actually says — merging across an unrelated event
 * would invent an order that never happened.
 *
 * Grouping by type *and* source is what keeps the row's two labels honest: a run of the
 * same type from two different sources would have to drop or guess at one of them.
 */
export function groupEvents(events: readonly LearningEvent[]): EventGroup[] {
  const runs: Run[] = [];

  for (const event of events) {
    const open = runs[runs.length - 1];
    if (open !== undefined && open.type === event.type && open.source === event.source) {
      open.events.push(event);
      open.oldestAt = event.at;
      open.oldestId = event.id;
      continue;
    }
    runs.push({
      type: event.type,
      source: event.source,
      events: [event],
      newestAt: event.at,
      oldestAt: event.at,
      oldestId: event.id,
    });
  }

  return runs.map((run) => ({
    type: run.type,
    source: run.source,
    events: run.events,
    count: run.events.length,
    newestAt: run.newestAt,
    oldestAt: run.oldestAt,
    id: run.oldestId,
  }));
}
