/**
 * Message identity.
 *
 * The domain never decides what language the learner reads. It emits a *key* and
 * the values to interpolate; the renderer owns the wording. That keeps one
 * implementation bilingual instead of two, and it means a missing translation is
 * a compile error rather than an English sentence in the middle of a Chinese
 * screen.
 */

/** Values interpolated into a message, referenced as `{name}` in the template. */
export type MessageParams = Readonly<Record<string, string>>;

export interface LocalizedMessage {
  readonly key: DomainMessageKey;
  readonly params: MessageParams;
}

/** What the learner should do next. Produced by the continuity package. */
export const NEXT_ACTION_KEYS = [
  'action.session.finish',
  'action.start.first',
  'action.start.next',
  'action.quiz.answer',
  'action.practice.example',
  'action.read.summarise',
] as const;

export type NextActionKey = (typeof NEXT_ACTION_KEYS)[number];

/** The resume card's own wording. Produced by the continuity package. */
export const RESUME_MESSAGE_KEYS = [
  'resume.title.task',
  'resume.title.course',
  'resume.context.plain',
  'resume.context.moment',
  'resume.context.away',
] as const;

export type ResumeMessageKey = (typeof RESUME_MESSAGE_KEYS)[number];

/** Why the policy decided what it decided. Produced by the intervention policy. */
export const INTERVENTION_REASON_CODES = [
  'reason.budget',
  'reason.cooldown',
  'reason.resume.dismissed',
  'reason.resume.interruption',
  'reason.overloaded',
  'reason.confused.example',
  'reason.confused.hint',
  'reason.initiation',
  'reason.simplify',
  'reason.question',
  'reason.distracted',
  'reason.stuck.cannot-start',
  'reason.stuck.do-not-understand',
  'reason.stuck.too-big',
  'reason.stuck.went-wrong',
  'reason.stuck.cannot-recall',
  'reason.stuck.tired',
  'reason.none',
] as const;

export type InterventionReasonCode = (typeof INTERVENTION_REASON_CODES)[number];

/** Every message the domain can emit. The renderer must translate all of them. */
export type DomainMessageKey = NextActionKey | ResumeMessageKey | InterventionReasonCode;

export const DOMAIN_MESSAGE_KEYS: readonly DomainMessageKey[] = [
  ...NEXT_ACTION_KEYS,
  ...RESUME_MESSAGE_KEYS,
  ...INTERVENTION_REASON_CODES,
];

export function message(key: DomainMessageKey, params: MessageParams = {}): LocalizedMessage {
  return { key, params };
}
