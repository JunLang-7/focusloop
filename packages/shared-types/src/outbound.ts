/**
 * What was actually handed to the model provider on the last tutor ask.
 *
 * Development-only: holds learner question text and the assembled prompt, so it
 * must never be persisted or logged. The engine keeps it in memory for the
 * session; the renderer shows it in the Outbound Request Inspector.
 *
 * Distinct from `AgentContext` (what the agent *can access*) — this is the
 * second of the two inspector views: the string that left the process.
 */
export interface OutboundRequest {
  readonly sessionId: string;
  readonly at: string;
  /** System prompt exactly as passed to `AIProvider.complete` (may be empty). */
  readonly system: string;
  /** User prompt exactly as passed to `AIProvider.complete`. */
  readonly prompt: string;
  /**
   * `system.length + prompt.length` — the same formula the tutor budget uses
   * (`inputCharacters`), so the figure on screen cannot drift from the string.
   */
  readonly inputCharacters: number;
}
