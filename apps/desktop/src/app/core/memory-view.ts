/**
 * What the data panel shows of the agent's memory (AG7.5), as pure functions.
 *
 * The parts worth testing without a pixel: which sources exist in the closed vocabularies (a new
 * source cannot ship without its label and its impact sentence — `Record` forces both), which rows
 * a learner actually sees (counts of zero are information, but nine rows of zeros is not a list),
 * and that a refusal arrives as the key it already carries.
 */
import type {
  AgentMemoryRefusal,
  AgentMemorySummary,
  LearnerPreference,
  LearnerPreferenceScope,
} from '@focusloop/shared-types';
import { MEMORY_SCOPE_FOR_SOURCE } from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';

/** One source's line: identity, class, how much, newest — and what deleting it removes. */
export interface MemoryRowView {
  readonly source: string;
  readonly scope: string;
  readonly count: number;
  readonly latestAt: string | null;
  readonly labelKey: MessageKey;
  readonly scopeKey: MessageKey;
  readonly impactKey: MessageKey;
}

export const MEMORY_SOURCE_KEYS = {
  transcript: 'app.data.memory.source.transcript',
  learning_events: 'app.data.memory.source.learning_events',
  checkpoints: 'app.data.memory.source.checkpoints',
  interventions: 'app.data.memory.source.interventions',
  outcomes: 'app.data.memory.source.outcomes',
  resume_cards: 'app.data.memory.source.resume_cards',
  agent_proposals: 'app.data.memory.source.agent_proposals',
  learner_preferences: 'app.data.memory.source.learner_preferences',
} as const satisfies Record<string, MessageKey>;

export const MEMORY_SCOPE_KEYS = {
  working: 'app.data.memory.scope.working',
  episodic: 'app.data.memory.scope.episodic',
  preference: 'app.data.memory.scope.preference',
} as const satisfies Record<string, MessageKey>;

/** What deleting this source removes, in the ADR's own terms — never what the source contains. */
export const MEMORY_IMPACT_KEYS = {
  transcript: 'app.data.memory.impact.transcript',
  learning_events: 'app.data.memory.impact.learning_events',
  checkpoints: 'app.data.memory.impact.checkpoints',
  interventions: 'app.data.memory.impact.interventions',
  outcomes: 'app.data.memory.impact.outcomes',
  resume_cards: 'app.data.memory.impact.resume_cards',
  agent_proposals: 'app.data.memory.impact.agent_proposals',
  learner_preferences: 'app.data.memory.impact.learner_preferences',
} as const satisfies Record<string, MessageKey>;

export const MEMORY_REASON_KEYS = {
  'wrong-session': 'memory.refusal.wrong-session',
  'no-session': 'memory.refusal.no-session',
} as const satisfies Record<string, MessageKey>;

/** The rows the panel lists: what exists, in the vocabulary's own order. Zero counts stay out. */
export function memoryRows(summary: AgentMemorySummary): readonly MemoryRowView[] {
  const counts = new Map(summary.sources.map((row) => [row.source, row]));
  const rows: MemoryRowView[] = [];
  // Iterating the key map keeps the display order in one place: the map's declaration.
  for (const source of Object.keys(MEMORY_SOURCE_KEYS) as (keyof typeof MEMORY_SOURCE_KEYS)[]) {
    const row = counts.get(source);
    if (row === undefined || row.count <= 0) continue;
    const scope = MEMORY_SCOPE_FOR_SOURCE[source];
    rows.push({
      source,
      scope,
      count: row.count,
      latestAt: row.latestAt,
      labelKey: MEMORY_SOURCE_KEYS[source],
      scopeKey: MEMORY_SCOPE_KEYS[scope],
      impactKey: MEMORY_IMPACT_KEYS[source],
    });
  }
  return rows;
}

/** A stored preference's scope, in the learner's words (AG7.4's closed vocabulary). */
export const PREFERENCE_SCOPE_KEYS = {
  'task-size': 'app.data.preference.scope.task-size',
  explanation: 'app.data.preference.scope.explanation',
  intervention: 'app.data.preference.scope.intervention',
  resume: 'app.data.preference.scope.resume',
} as const satisfies Record<string, MessageKey>;

/** One preference as the panel's list shows it: value as bounded text, evidence as its window. */
export interface PreferenceRowView {
  readonly id: string;
  readonly scope: LearnerPreferenceScope;
  readonly scopeKey: MessageKey;
  /** The value rendered, bounded — the row is a line, not the preference's whole document. */
  readonly valueText: string;
  readonly evidenceKey: MessageKey;
  readonly evidenceParams: Readonly<Record<string, string>>;
  /** `null` until AG6.7 confirmed it — the panel says so rather than showing a blank. */
  readonly confirmedAt: string | null;
}

export const MAX_PREFERENCE_VALUE_CHARS = 140;

export function preferenceRowView(
  preference: LearnerPreference,
  clock: (iso: string | null) => string,
): PreferenceRowView {
  let valueText: string;
  try {
    valueText = JSON.stringify(preference.value) ?? String(preference.value);
  } catch {
    valueText = '[unprintable]';
  }
  if (valueText.length > MAX_PREFERENCE_VALUE_CHARS) {
    valueText = `${valueText.slice(0, MAX_PREFERENCE_VALUE_CHARS - 1)}…`;
  }
  return {
    id: preference.id,
    scope: preference.scope,
    scopeKey: PREFERENCE_SCOPE_KEYS[preference.scope],
    valueText,
    evidenceKey: 'app.data.preference.evidence',
    evidenceParams: {
      samples: String(preference.evidence.sampleSize),
      from: clock(preference.evidence.windowStart),
      to: clock(preference.evidence.windowEnd),
    },
    confirmedAt: preference.confirmedAt,
  };
}

/** A refusal as the key it already carries — the domain's wording, not the panel's guess. */
export function memoryRefusalKey(refusal: AgentMemoryRefusal): MessageKey {
  return MEMORY_REASON_KEYS[refusal.reason];
}
