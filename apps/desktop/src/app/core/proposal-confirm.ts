/**
 * What the confirmation dialog shows, as pure functions (#209).
 *
 * The dialog itself is a thin shell over these: the parts worth testing are "does the learner see
 * what will change, who asked, and which level this is" and "does a refusal arrive as the reason it
 * already carries" — neither needs a rendered pixel, and both break silently when a payload or a
 * kind grows.
 */
import type {
  AgentProposal,
  AgentProposalKind,
  ProposalConfirmResult,
  ProposalExecuteResult,
} from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';

/**
 * The level line, one per proposal kind (ADR 0003's matrix, carried by `kind`).
 *
 * `Record` over the closed union is deliberate: a new kind cannot ship without its label.
 */
export const PROPOSAL_LEVEL_KEYS: Record<AgentProposalKind, MessageKey> = {
  'structural-write': 'proposal.level.structural-write',
};

/**
 * At most this many lines: seven entries plus a count of what was left out.
 *
 * The count matters — an omission the dialog does not name would read as "that is everything", and
 * "that is everything" is a claim about the learner's own change.
 */
export const MAX_CHANGE_LINES = 8;

/** One line is a line the learner reads, not a JSON dump. */
const MAX_LINE_CHARS = 170;

export interface ProposalDialogView {
  readonly levelKey: MessageKey;
  /** Who asked: the proposal's `createdBy`, bounded — it is an identifier, not prose to translate. */
  readonly why: string;
  /** `key: value` lines, bounded; the last line counts what did not fit, when anything did not. */
  readonly changeLines: readonly string[];
}

function bounded(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or otherwise unprintable: the key still says what was there.
    return '[unprintable]';
  }
}

export function proposalDialogView(proposal: AgentProposal): ProposalDialogView {
  const entries = Object.entries(proposal.payload);
  const shown = entries.slice(0, MAX_CHANGE_LINES - 1);
  const lines = shown.map(([key, value]) => bounded(`${key}: ${describeValue(value)}`));
  const hidden = entries.length - shown.length;
  if (hidden > 0) lines.push(`+${hidden} more`);
  return {
    levelKey: PROPOSAL_LEVEL_KEYS[proposal.kind],
    why: bounded(proposal.createdBy),
    changeLines: lines,
  };
}

/**
 * A refusal arrives as the message key it already carries; success is silence.
 *
 * `expired` and `state-changed` are the two the dialog must be able to show (#209's test plan) and
 * both are already keys on the result — this function's only job is to not lose them on the way to
 * the screen.
 */
export function refusalMessageKey(
  result: ProposalConfirmResult | ProposalExecuteResult,
): MessageKey | null {
  return result.ok ? null : result.messageKey;
}
