export interface InterventionPolicyConfig {
  /** Minimum gap between two shown interventions. Prevents nagging. */
  readonly cooldownMs: number;
  /** Task running this much longer than estimated suggests simplification. */
  readonly simplifyAfterRatio: number;
  /** Hard ceiling so the agent can never become the distraction. */
  readonly maxInterventionsPerSession: number;
  /** A dismissed resume keeps the agent quiet for this long. */
  readonly dismissedResumeCooldownMs: number;
  /** How long an unasked OVERLOADED BREAK is suppressed after one was shown. */
  readonly breakCooldownMs: number;
  /** How long a learner has to demonstrate progress after accepting a rescue. */
  readonly rescueSuccessWindowMs: number;
}

export const DEFAULT_POLICY_CONFIG: InterventionPolicyConfig = {
  cooldownMs: 90_000,
  simplifyAfterRatio: 2,
  maxInterventionsPerSession: 12,
  dismissedResumeCooldownMs: 120_000,
  breakCooldownMs: 5 * 60 * 1000,
  rescueSuccessWindowMs: 5 * 60 * 1000,
};

export function resolvePolicyConfig(
  overrides: Partial<InterventionPolicyConfig> = {},
): InterventionPolicyConfig {
  const merged = { ...DEFAULT_POLICY_CONFIG, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`InterventionPolicyConfig.${key} must be a non-negative finite number`);
    }
  }
  return merged;
}
