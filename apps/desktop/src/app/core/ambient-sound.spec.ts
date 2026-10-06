import { describe, expect, it } from 'vitest';
import { shouldPlayAmbient } from './ambient-sound';

/*
 * The rule is the whole of what can be asserted without an audio device, and it is the half that has
 * to be right: the graph either makes a quiet wash or it does not, but *whether it should* is a
 * decision, and the failure to guard against is a preference that starts a sound on its own.
 */
describe('shouldPlayAmbient', () => {
  it('plays only when the learner asked for it and a session is running', () => {
    expect(shouldPlayAmbient(true, true)).toBe(true);
  });

  it('stays silent when the preference is on but nothing is running', () => {
    // The restart case: the store remembers `true`, and nothing else about that is a request to play.
    expect(shouldPlayAmbient(true, false)).toBe(false);
  });

  it('stays silent when the learner turned it off mid-session', () => {
    expect(shouldPlayAmbient(false, true)).toBe(false);
    expect(shouldPlayAmbient(false, false)).toBe(false);
  });
});
