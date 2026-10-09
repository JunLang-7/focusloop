/**
 * What the agent remembers, as the learner can inspect it (AG7.5).
 *
 * Every type here is metadata: scope, source, count, time. Nothing in this file can carry the
 * learner's own words — the panel answers "is anything there, where, and what deleting it removes",
 * which is ADR 0001's inspection promise, and a summary that could hold content would be a second
 * copy of the very thing a clear is supposed to remove.
 */
import type { MemoryMessageKey } from './messages';

/** Where memory lives. The nine places `clearAgentMemory` touches or will. */
export const AGENT_MEMORY_SOURCES = [
  'transcript',
  'outbound',
  'learning_events',
  'checkpoints',
  'interventions',
  'outcomes',
  'resume_cards',
  'agent_proposals',
  'learner_preferences',
] as const;

export type AgentMemorySource = (typeof AGENT_MEMORY_SOURCES)[number];

/** ADR 0001's three classes. */
export const AGENT_MEMORY_SCOPES = ['working', 'episodic', 'preference'] as const;

export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number];

/** Which class each source belongs to — closed, so a new source cannot be unclassified. */
export const MEMORY_SCOPE_FOR_SOURCE: Readonly<Record<AgentMemorySource, AgentMemoryScope>> = {
  transcript: 'working',
  outbound: 'working',
  learning_events: 'episodic',
  checkpoints: 'episodic',
  interventions: 'episodic',
  outcomes: 'episodic',
  resume_cards: 'episodic',
  agent_proposals: 'episodic',
  learner_preferences: 'preference',
};

/** One source's row: how much is there, and when the newest of it was. */
export interface AgentMemorySourceCount {
  readonly source: AgentMemorySource;
  readonly count: number;
  /** `null` when the source carries no timestamp (the transcript keeps turns, not times). */
  readonly latestAt: string | null;
}

/** The opaque clear record, shaped to what the panel shows (ADR 0001: no content columns). */
export interface AgentMemoryClearAudit {
  readonly clearedAt: string;
  readonly actor: string;
}

export interface AgentMemorySummary {
  readonly sessionId: string;
  /** All nine sources, always — zero counts are information, not absence. */
  readonly sources: readonly AgentMemorySourceCount[];
  readonly cleared: AgentMemoryClearAudit | null;
}

/** One item in a scope, metadata only: which source it came from, and when. */
export interface AgentMemoryItem {
  readonly source: AgentMemorySource;
  readonly at: string | null;
}

export interface AgentMemoryList {
  readonly scope: AgentMemoryScope;
  readonly items: readonly AgentMemoryItem[];
  /** True when the scope holds more than the bound and older items were left out. */
  readonly truncated: boolean;
}

/** Newest-first listing bound. The panel shows counts; this answers "what is in there". */
export const MEMORY_LIST_LIMIT = 50;

/** Why a memory read was refused — the same closed-plus-translatable shape as every refusal. */
export type AgentMemoryRefusalReason = 'wrong-session' | 'no-session';

export interface AgentMemoryRefusal {
  readonly ok: false;
  readonly reason: AgentMemoryRefusalReason;
  readonly messageKey: MemoryMessageKey;
}

export interface AgentMemorySummaryOk {
  readonly ok: true;
  readonly summary: AgentMemorySummary;
}

export type AgentMemorySummaryResult = AgentMemorySummaryOk | AgentMemoryRefusal;

export interface AgentMemoryListOk {
  readonly ok: true;
  readonly list: AgentMemoryList;
}

export type AgentMemoryListResult = AgentMemoryListOk | AgentMemoryRefusal;
