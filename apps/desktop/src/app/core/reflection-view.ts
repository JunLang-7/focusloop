/**
 * The weekly reflection as the dashboard shows it (AG6.5), as a pure function.
 *
 * The rules being tested without a pixel: every stat shows the rows behind it and the week it
 * counts (the evidence line is the same template the preference rows use — one way to say
 * "N samples, from–to" in the product), a claim shows **its own** window rather than the week's,
 * and an empty reflection reads as empty rather than as seven honest zeros.
 */
import type { ReflectionStatKey, WeeklyReflection } from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';
import { PREFERENCE_SCOPE_KEYS } from './memory-view';

/** One label per stat — `Record` so a new key cannot ship unlabeled (and untranslatable). */
export const REFLECTION_STAT_LABELS = {
  'interventions.shown': 'app.reflection.stat.interventions.shown',
  'interventions.accepted': 'app.reflection.stat.interventions.accepted',
  'interventions.dismissed': 'app.reflection.stat.interventions.dismissed',
  'resumes.accepted': 'app.reflection.stat.resumes.accepted',
  'resumes.dismissed': 'app.reflection.stat.resumes.dismissed',
  'checkpoints.taken': 'app.reflection.stat.checkpoints.taken',
  'tasks.completed': 'app.reflection.stat.tasks.completed',
} as const satisfies Record<ReflectionStatKey, MessageKey>;

export interface ReflectionStatRow {
  readonly key: ReflectionStatKey;
  readonly labelKey: MessageKey;
  readonly value: number;
  readonly evidenceKey: MessageKey;
  readonly evidenceParams: Readonly<Record<string, string>>;
}

export interface ReflectionClaimRow {
  readonly scope: string;
  readonly scopeKey: MessageKey;
  readonly valueText: string;
  readonly evidenceKey: MessageKey;
  readonly evidenceParams: Readonly<Record<string, string>>;
}

export interface ReflectionView {
  readonly isEmpty: boolean;
  readonly stats: readonly ReflectionStatRow[];
  readonly claims: readonly ReflectionClaimRow[];
}

/**
 * One line is a line the learner reads: the same ceiling the data panel's preference row uses,
 * kept local so this PR does not depend on an unmerged export — the number is identical on purpose,
 * and if it ever moves, both should move together in one change.
 */
const MAX_CLAIM_VALUE_CHARS = 140;

function boundedValueText(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = '[unprintable]';
  }
  return text.length > MAX_CLAIM_VALUE_CHARS
    ? `${text.slice(0, MAX_CLAIM_VALUE_CHARS - 1)}…`
    : text;
}

export function reflectionView(
  reflection: WeeklyReflection,
  clock: (iso: string | null) => string,
): ReflectionView {
  const week = {
    from: clock(reflection.windowFrom),
    to: clock(reflection.windowTo),
  };

  // The builder emits stats in a deterministic order, so one pass preserves it — no re-sorting
  // needed to keep the week stable between renders.
  const stats: ReflectionStatRow[] = reflection.stats.map((stat) => ({
    key: stat.key,
    labelKey: REFLECTION_STAT_LABELS[stat.key],
    value: stat.value,
    evidenceKey: 'app.data.preference.evidence',
    evidenceParams: { samples: String(stat.samples), from: week.from, to: week.to },
  }));

  const claims: ReflectionClaimRow[] = reflection.preferences.map((claim) => ({
    scope: claim.scope,
    scopeKey: PREFERENCE_SCOPE_KEYS[claim.scope],
    valueText: boundedValueText(claim.value),
    evidenceKey: 'app.data.preference.evidence',
    evidenceParams: {
      samples: String(claim.samples),
      from: clock(claim.windowFrom),
      to: clock(claim.windowTo),
    },
  }));

  return { isEmpty: stats.length === 0 && claims.length === 0, stats, claims };
}
