/**
 * The environment every desktop e2e process is launched with.
 *
 * `process.env` is passed through so PATH, DISPLAY and the rest of the host
 * survive into Electron, but provider credentials must not: a developer who has
 * exported `FOCUSLOOP_DEEPSEEK_API_KEY` would otherwise run the suite against
 * the real provider — spending their key on tests and making "the offline path
 * works" untestable on the machine where it matters most. CI is inert only
 * because the secret is absent there, by accident rather than by design.
 *
 * Every future provider credential joins PROVIDER_CREDENTIALS below; that list
 * is the one place the suite decides what a child process is not allowed to see.
 */
const PROVIDER_CREDENTIALS = ['FOCUSLOOP_DEEPSEEK_API_KEY', 'FOCUSLOOP_OPENAI_API_KEY'];
const BLOCKED_ENV_NAMES = new Set(PROVIDER_CREDENTIALS.map((key) => key.toUpperCase()));

export function hermeticEnv(sourceEnv = process.env) {
  /*
   * The distraction sensor is off for every launch by default (#254).
   *
   * It reports the app window losing focus, and a test runner is a machine where focus moves for
   * reasons that have nothing to do with the learner — a window opening behind another, a CI agent
   * doing something on the desktop. A suite that asserts "the session is focused" cannot have a
   * background observation deciding otherwise, so the sensor is opt-in here and the one spec that
   * exercises it turns it back on. The same shape as FOCUSLOOP_TICK_INTERVAL_MS.
   */
  /*
   * The first-run questionnaire is answered for every launch by default.
   *
   * Every spec uses a fresh profile, so every spec is a first run; a modal that is right for a learner
   * would sit over the whole suite. It is opt-out here and the one spec that exercises the questionnaire
   * turns it back on, the same shape as the sensor below.
   */
  const env = {
    ...sourceEnv,
    FOCUSLOOP_DEV: '1',
    FOCUSLOOP_DISTRACTION_SENSOR: '0',
    FOCUSLOOP_ONBOARDING: '0',
    // Never touch the machine's own scheduler, and never take the OS language: a suite that asserts
    // English wording must not depend on the machine it runs on.
    FOCUSLOOP_SYSTEM_REMINDER: '0',
    FOCUSLOOP_DETECT_LOCALE: '0',
  };
  // Electron's launch env is Record<string, string>; drop any undefined leftovers from process.env.
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => value !== undefined && !BLOCKED_ENV_NAMES.has(key.toUpperCase()),
    ),
  );
}
