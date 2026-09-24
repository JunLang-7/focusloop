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
const PROVIDER_CREDENTIALS = ['FOCUSLOOP_DEEPSEEK_API_KEY'];
const BLOCKED_ENV_NAMES = new Set(PROVIDER_CREDENTIALS.map((key) => key.toUpperCase()));

export function hermeticEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv, FOCUSLOOP_DEV: '1' };
  // Electron's launch env is Record<string, string>; drop any undefined leftovers from process.env.
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => value !== undefined && !BLOCKED_ENV_NAMES.has(key.toUpperCase()),
    ),
  );
}
