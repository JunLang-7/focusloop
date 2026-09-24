import { expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

test('removes provider credentials regardless of environment-key casing', () => {
  const env = hermeticEnv({
    FOCUSLOOP_DEEPSEEK_API_KEY: 'upper-secret',
    focusloop_deepseek_api_key: 'lower-secret',
    FocusLoop_DeepSeek_Api_Key: 'mixed-secret',
  });

  expect(Object.keys(env).some((key) => key.toUpperCase() === 'FOCUSLOOP_DEEPSEEK_API_KEY')).toBe(
    false,
  );
  expect(env.FOCUSLOOP_DEV).toBe('1');
});
