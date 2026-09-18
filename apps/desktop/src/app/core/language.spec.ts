import { describe, expect, it } from 'vitest';
import { applyLanguage } from './language';

describe('applyLanguage', () => {
  it('writes the locale onto the document element', () => {
    const root = { lang: 'en' } as unknown as HTMLElement;
    applyLanguage(root, 'zh');
    expect(root.lang).toBe('zh');
  });

  it('switches back, so the attribute never lags the interface', () => {
    const root = { lang: 'en' } as unknown as HTMLElement;
    applyLanguage(root, 'zh');
    applyLanguage(root, 'en');
    expect(root.lang).toBe('en');
  });
});
