/**
 * The session as a plan the learner can see.
 *
 * The idea, taken from Tiimo: time is *shown* rather than described. Every remaining micro task
 * becomes a block whose height is proportional to its estimate, stacked so the column reads as one
 * continuous plan instead of a list of interchangeable rows.
 *
 * It matters more here than it would in a generic planner. "How much is left, and how long will it
 * take" is precisely the question someone with time blindness cannot answer for themselves, and the
 * previous "Up next" list answered neither: every task looked identical and none of them said how
 * long it would take.
 *
 * Pure functions and no DOM, so proportion, the floor and contiguity are unit-tested rather than
 * eyeballed.
 */
import type { MicroTask, MicroTaskKind } from '@focusloop/shared-types';

/**
 * Vertical space one minute of estimate earns.
 *
 * Chosen against the estimates the domain actually produces (2–8 minutes) rather than for a
 * general calendar: much smaller and the floor swallows the differences, much larger and a
 * five-task plan is taller than the window.
 */
export const PX_PER_MINUTE = 14;

/**
 * Nothing renders shorter than this.
 *
 * A two-minute task at the real scale is a hairline, and a block too small to hold its own label
 * and Start control is not a plan, it is decoration.
 */
export const MIN_BLOCK_PX = 34;

/** One block of the plan. */
export interface PlanBlock {
  readonly id: string;
  readonly title: string;
  readonly kind: MicroTaskKind;
  /** The estimate, clamped at zero. */
  readonly minutes: number;
  /** Distance from the top of the track. */
  readonly offset: number;
  readonly height: number;
}

export interface SessionPlan {
  readonly blocks: readonly PlanBlock[];
  /** Total height of the track: the sum of the block heights, not of the minutes. */
  readonly height: number;
  /** The sum of the estimates. The track height is deliberately not proportional to this. */
  readonly totalMinutes: number;
}

/**
 * A text glyph per kind.
 *
 * Colour alone cannot carry this: the kind has to survive a colour-blind reader, a greyscale
 * screenshot and a printed page. These are the same three shapes the kind labels name — text lines,
 * writing, a question — kept monochrome so they inherit the theme.
 */
export const KIND_GLYPHS: Record<MicroTaskKind, string> = {
  read: '≡',
  practice: '✎',
  quiz: '?',
};

export interface PlanOptions {
  readonly pxPerMinute?: number;
  readonly minBlockPx?: number;
}

/**
 * Lays the remaining tasks out as contiguous blocks.
 *
 * Offsets accumulate the *rendered* heights rather than the true minutes, so the blocks tile the
 * column exactly: no gaps, no overlaps, and no block pushed below the floor losing its neighbour's
 * position. The cost is that the track height is the sum of the rendered heights, which is why
 * `totalMinutes` is reported separately instead of being derived from it.
 */
export function buildPlan(tasks: readonly MicroTask[], options: PlanOptions = {}): SessionPlan {
  const pxPerMinute = options.pxPerMinute ?? PX_PER_MINUTE;
  const minBlockPx = options.minBlockPx ?? MIN_BLOCK_PX;

  const blocks: PlanBlock[] = [];
  let offset = 0;
  let totalMinutes = 0;

  for (const task of tasks) {
    const minutes = Math.max(0, task.estimatedMinutes);
    const height = Math.max(minBlockPx, minutes * pxPerMinute);

    blocks.push({
      id: task.id,
      title: task.title,
      kind: task.kind,
      minutes,
      offset,
      height,
    });

    offset += height;
    totalMinutes += minutes;
  }

  return { blocks, height: offset, totalMinutes };
}
