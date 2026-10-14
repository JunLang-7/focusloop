/**
 * The session as a plan the learner can see.
 *
 * Every remaining micro task is one block, in the order the learner put it in, and every block is
 * the same height. The column is the list of what is left rather than a chart of how long each part
 * takes: an even row is what makes a task findable again after a reorder, and a length is a poor
 * place to read a number from — the estimate stays on the row, written out, where it can be read
 * exactly rather than estimated from a bar.
 *
 * Pure functions and no DOM, so the tiling is unit-tested rather than eyeballed.
 */
import type { MicroTask, MicroTaskKind } from '@focusloop/shared-types';

/**
 * The height of every block, in pixels.
 *
 * One value for all of them: tall enough to hold the grip, the label, the estimate and the Start
 * control on one line, and no taller, so a five-task plan still fits the panel it opens in.
 */
export const BLOCK_PX = 48;

/** One block of the plan. */
export interface PlanBlock {
  readonly id: string;
  readonly title: string;
  readonly kind: MicroTaskKind;
  /** The estimate, clamped at zero. Written on the row; it no longer sizes it. */
  readonly minutes: number;
  /** Distance from the top of the track. */
  readonly offset: number;
  /** Always `BLOCK_PX`. Carried per block because that is what the row binds its height to. */
  readonly height: number;
}

export interface SessionPlan {
  readonly blocks: readonly PlanBlock[];
  /** Total height of the track: the blocks, end to end. */
  readonly height: number;
  /** The sum of the estimates, which the track height is deliberately independent of. */
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

/**
 * Lays the remaining tasks out as equal, contiguous blocks.
 *
 * Offsets accumulate the rendered heights, so the rows tile the column exactly: no gaps, no
 * overlaps, and nothing that shifts when an estimate changes. The track height is therefore a
 * function of how many tasks are left, which is why `totalMinutes` is reported separately instead
 * of being derived from it.
 */
export function buildPlan(tasks: readonly MicroTask[]): SessionPlan {
  const blocks: PlanBlock[] = [];
  let offset = 0;
  let totalMinutes = 0;

  for (const task of tasks) {
    const minutes = Math.max(0, task.estimatedMinutes);

    blocks.push({
      id: task.id,
      title: task.title,
      kind: task.kind,
      minutes,
      offset,
      height: BLOCK_PX,
    });

    offset += BLOCK_PX;
    totalMinutes += minutes;
  }

  return { blocks, height: offset, totalMinutes };
}
