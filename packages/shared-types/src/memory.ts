/**
 * What the agent remembers, as the learner can inspect it (AG7.5).
 *
 * Every type here is metadata: scope, source, count, time. Nothing in this file can carry the
 * learner's own words — the panel answers "is anything there, where, and what deleting it removes",
 * which is ADR 0001's inspection promise, and a summary that could hold content would be a second
 * copy of the very thing a clear is supposed to remove.
 */
import type { MemoryMessageKey } from './messages';

/** Where memory lives. The eight places `clearAgentMemory` touches or will. */
export const AGENT_MEMORY_SOURCES = [
  'transcript',
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
  /** All sources, always — zero counts are information, not absence. */
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

/**
 * The ceiling on a *windowed* read — paging asks for a slice, not the log.
 *
 * Fifty for the panel's default listing; two hundred for a caller who brings their own window is
 * still a screenful of rows rather than a file. Anything larger is answered by `truncated` plus
 * another page (`until`), never by growing this.
 */
export const MEMORY_QUERY_MAX = 200;

/**
 * How long episodic memory is kept before a windowed cleanup may remove it (AG7.3).
 *
 * Ninety days: thirteen weeks past the default insight view (a week), so `all` keeps a quarter of
 * history to read. The cleanup is what makes "all" honest — it means *all that is kept*, and the
 * rows past this line are gone rather than hidden behind a filter.
 */
export const AGENT_MEMORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** A windowed read: either bound optional, the page size bounded by `MEMORY_QUERY_MAX`. */
export interface AgentMemoryWindow {
  /** ISO-8601 inclusive lower bound. */
  readonly since?: string;
  /** ISO-8601 inclusive upper bound — the paging key: pass the last row's `at`. */
  readonly until?: string;
  readonly limit?: number;
}

/** What one cleanup run removed: when the line was drawn, how much, and which opaque sessions. */
export interface EpisodicCleanupResult {
  /** Rows strictly older than this were removed; anything at or after it is retained. */
  readonly cutoffAt: string;
  readonly clearedCount: number;
  /** Opaque session ids this run touched — never their content (ADR 0001). */
  readonly sessionIds: readonly string[];
}

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
