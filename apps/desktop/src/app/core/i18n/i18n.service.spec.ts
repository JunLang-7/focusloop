import { describe, expect, it } from 'vitest';
import { DOMAIN_MESSAGE_KEYS, message } from '@focusloop/shared-types';
import en, { type MessageKey } from './messages.en';
import { zh } from './messages.zh';
import { LOCALE_LABELS, interpolate, I18nService } from './i18n.service';

/** Every `{name}` token a template uses, as a comparable sorted list. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('interpolate', () => {
  it('replaces named placeholders', () => {
    expect(interpolate('{a} and {b}', { a: 'one', b: 'two' })).toBe('one and two');
  });

  it('replaces the same placeholder more than once', () => {
    expect(interpolate('{a}-{a}', { a: 'x' })).toBe('x-x');
  });

  it('leaves a placeholder alone when the value is missing', () => {
    // A half-built message is easier to spot than a silently empty gap.
    expect(interpolate('{a} and {b}', { a: 'one' })).toBe('one and {b}');
  });

  it('is a no-op when there is nothing to substitute', () => {
    expect(interpolate('plain text', {})).toBe('plain text');
  });

  it('does not treat braces in the values as placeholders', () => {
    expect(interpolate('{a}', { a: '{b}' })).toBe('{b}');
  });
});

describe('I18nService', () => {
  it('starts in English', () => {
    expect(new I18nService().locale()).toBe('en');
  });

  it('translates a key', () => {
    expect(new I18nService().t('app.nav.home')).toBe('Home');
  });

  it('switches language without losing the previous dictionary', () => {
    const i18n = new I18nService();
    i18n.set('zh');
    expect(i18n.t('app.nav.home')).not.toBe('Home');
    i18n.set('en');
    expect(i18n.t('app.nav.home')).toBe('Home');
  });

  it('interpolates params', () => {
    const i18n = new I18nService();
    expect(i18n.t('course.minutes', { minutes: '12' })).toContain('12');
  });

  it('renders a message the domain emitted, params and all', () => {
    const i18n = new I18nService();
    const rendered = i18n.translate(message('action.practice.example', { title: 'Rotations' }));
    expect(rendered).toContain('Rotations');
  });

  it('renders a domain message in the selected language', () => {
    const i18n = new I18nService();
    const english = i18n.translate(message('reason.overloaded'));
    i18n.set('zh');
    expect(i18n.translate(message('reason.overloaded'))).not.toBe(english);
  });

  it('shows each language a label it can read', () => {
    expect(LOCALE_LABELS.en).toBe('EN');
    expect(LOCALE_LABELS.zh).toBe('中文');
  });

  it('falls back to the key instead of throwing on an unknown string', () => {
    // Degrading the presentation beats blanking the screen.
    const i18n = new I18nService();
    expect(i18n.t('not.a.real.key' as MessageKey)).toBe('not.a.real.key');
  });
});

describe('the dictionaries', () => {
  it('define exactly the same key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('translate every message the domain can emit', () => {
    for (const key of DOMAIN_MESSAGE_KEYS) {
      expect(en).toHaveProperty(key);
      expect(zh).toHaveProperty(key);
    }
  });

  it('use the same placeholders in both languages', () => {
    // `{minutes}` in English and `{count}` in Chinese would render as a visible
    // `{count}` for one set of users. That is a bug the type checker cannot see.
    const mismatched = (Object.keys(en) as MessageKey[]).filter(
      (key) => placeholders(en[key]).join(',') !== placeholders(zh[key]).join(','),
    );
    expect(mismatched).toEqual([]);
  });

  it('has no empty strings', () => {
    const blank = (Object.keys(en) as MessageKey[]).filter(
      (key) => en[key].trim() === '' || zh[key].trim() === '',
    );
    expect(blank).toEqual([]);
  });
});
