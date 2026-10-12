import { expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

test('removes provider credentials regardless of environment-key casing', () => {
  const env = hermeticEnv({
    FOCUSLOOP_DEEPSEEK_API_KEY: 'upper-secret',
    focusloop_deepseek_api_key: 'lower-secret',
    FocusLoop_DeepSeek_Api_Key: 'mixed-secret',
    FOCUSLOOP_OPENAI_API_KEY: 'openai-secret',
    focusloop_openai_api_key: 'openai-lower-secret',
  });

  expect(Object.keys(env).some((key) => key.toUpperCase() === 'FOCUSLOOP_DEEPSEEK_API_KEY')).toBe(
    false,
  );
  expect(Object.keys(env).some((key) => key.toUpperCase() === 'FOCUSLOOP_OPENAI_API_KEY')).toBe(
    false,
  );
  expect(env.FOCUSLOOP_DEV).toBe('1');
});

test('turns the distraction sensor off unless a spec asks for it', () => {
  /*
   * Asserted rather than assumed, because it is the switch every other spec's determinism rests on:
   * a suite that asserts a focused session cannot have the machine's window focus deciding
   * otherwise, and the default has to be off for the suite even when the developer has the sensor
   * on in their own shell.
   */
  expect(hermeticEnv({ FOCUSLOOP_DISTRACTION_SENSOR: '1' }).FOCUSLOOP_DISTRACTION_SENSOR).toBe('0');
  expect(hermeticEnv({}).FOCUSLOOP_DISTRACTION_SENSOR).toBe('0');
});
