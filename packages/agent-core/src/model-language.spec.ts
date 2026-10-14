import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@focusloop/shared-types';
import { replyLanguageInstruction } from './model-language';

/**
 * The one sentence every prompt carries, pinned here rather than only through the two builders that
 * append it: a new prompt builder that forgets it is a prompt whose answers follow the material.
 */
describe('the answer-language instruction', () => {
  it('names the interface language for every supported locale', () => {
    const instructions = SUPPORTED_LOCALES.map((locale) => replyLanguageInstruction(locale));
    for (const [index, instruction] of instructions.entries()) {
      expect(instruction, SUPPORTED_LOCALES[index]).toContain('language of the interface');
    }
    // One sentence per locale, and no two locales share one: a locale that fell back to another's
    // wording would ask for the wrong language in a way nothing else here would catch.
    expect(new Set(instructions).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('says the material does not decide it, in the same language it asks for', () => {
    const chinese = replyLanguageInstruction('zh');
    expect(chinese).toContain('Simplified Chinese');
    expect(chinese.match(/Simplified Chinese/g)).toHaveLength(2);
    const english = replyLanguageInstruction('en');
    expect(english).toContain('English');
    expect(english.match(/\bEnglish\b/g)).toHaveLength(2);
  });
});
