import { describe, expect, it } from 'vitest';
import { REMINDER_COPY, detectLocale } from './reminder';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './settings';

describe('detectLocale', () => {
  it('takes the language from a region tag', () => {
    expect(detectLocale('en-US')).toBe('en');
    expect(detectLocale('en')).toBe('en');
    expect(detectLocale('zh-CN')).toBe('zh');
  });

  it('reads a script subtag as the same language, because the two both want Chinese', () => {
    expect(detectLocale('zh-Hans')).toBe('zh');
    expect(detectLocale('zh-Hant-TW')).toBe('zh');
  });

  it('is case-insensitive', () => {
    expect(detectLocale('ZH-cn')).toBe('zh');
  });

  it('falls back to the default rather than guessing', () => {
    expect(detectLocale('de-DE')).toBe(DEFAULT_LOCALE);
    expect(detectLocale('')).toBe(DEFAULT_LOCALE);
    expect(detectLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(detectLocale(null)).toBe(DEFAULT_LOCALE);
  });
});

describe('REMINDER_COPY', () => {
  it('has a sentence for every supported language, and no empty one', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(REMINDER_COPY[locale].title.length).toBeGreaterThan(0);
      expect(REMINDER_COPY[locale].body.length).toBeGreaterThan(0);
    }
  });

  it('does not fall back to English for Chinese, which is the bug the shared copy prevents', () => {
    expect(REMINDER_COPY.zh.title).not.toBe(REMINDER_COPY.en.title);
    expect(REMINDER_COPY.zh.body).not.toBe(REMINDER_COPY.en.body);
  });
});
