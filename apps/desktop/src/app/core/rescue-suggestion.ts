/**
 * When the renderer asks for a generated rescue line (#205), as one pure decision.
 *
 * The card itself comes from the engine; this is only the question "should a call be made for
 * this card, once?" — answered off the three facts that decide it: there is a card with a line to
 * write, a provider is actually configured (the offline default is `true`, and before runtime info
 * lands it is `undefined` — neither may spend a call), and this intervention has not had one yet.
 */
import type { RescueView } from '@focusloop/shared-types';

export function shouldSuggestRescueText(input: {
  readonly rescue: RescueView | null;
  readonly providerOffline: boolean | undefined;
  readonly attempted: ReadonlySet<string>;
}): boolean {
  const plan = input.rescue?.plan;
  if (plan === undefined || plan === null) return false;
  if (plan.action !== 'HINT' && plan.action !== 'EXAMPLE') return false;
  // `false` is the only answer that means "a real provider is configured" — `true` is the mock
  // default, `undefined` is info that has not arrived, and neither is authorisation to call.
  if (input.providerOffline !== false) return false;
  const interventionId = input.rescue?.interventionId;
  if (interventionId === undefined) return false;
  return !input.attempted.has(interventionId);
}
