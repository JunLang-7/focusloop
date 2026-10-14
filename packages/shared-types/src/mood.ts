/**
 * The daily wellbeing check-in: one mood per day, with an optional note.
 *
 * A different question from the learning state. The state engine asks *what the learner is doing*; this
 * asks *how they are*, which the app cannot infer from events and must be told. It is stored per local
 * calendar day, so a day has one answer rather than a stream, and the note is the learner's own words —
 * bounded like every other learner text, never interpreted by the app.
 */

export const MOOD_MIN = 1;
export const MOOD_MAX = 5;

/** The note is a sentence about the day, not an essay; bounded where it is written and at the boundary. */
export const MOOD_NOTE_MAX_CHARACTERS = 280;

export interface MoodEntry {
  /** Local calendar date, `YYYY-MM-DD`. One entry per day. */
  readonly date: string;
  /** `MOOD_MIN` (very low) .. `MOOD_MAX` (very good). */
  readonly mood: number;
  readonly note: string;
  /** When the entry was last written, so an edited day is distinguishable from the first answer. */
  readonly updatedAt: string;
}

export interface SaveMoodRequest {
  readonly mood: number;
  readonly note: string;
}

export interface ListMoodsRequest {
  /** How many most recent days to return, newest first. */
  readonly limit: number;
}

export function isMoodValue(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MOOD_MIN && value <= MOOD_MAX
  );
}

/** A worker-safe shape check for a whole entry read back from storage. */
export function isMoodEntry(value: unknown): value is MoodEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['date'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry['date']) &&
    isMoodValue(entry['mood']) &&
    typeof entry['note'] === 'string' &&
    typeof entry['updatedAt'] === 'string'
  );
}
