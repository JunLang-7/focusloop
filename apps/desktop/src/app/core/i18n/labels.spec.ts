import { describe, expect, it } from 'vitest';
import {
  LEARNING_EVENT_TYPES,
  type LearningEventSource,
  type LearningEventType,
} from '@focusloop/shared-types';
import en, { type MessageKey } from './messages.en';
import { zh } from './messages.zh';
import { EVENT_SOURCE_KEYS, EVENT_TYPE_KEYS } from './labels';

/**
 * Every place an event can come from.
 *
 * Written out rather than derived: the maps are `Record<LearningEventSource, MessageKey>`, so a source
 * added to the union is a type error here - but a source removed from the union while this list still
 * names it is only caught by the assertions below, which is the point.
 */
const SOURCES: readonly LearningEventSource[] = [
  'user',
  'extension',
  'simulator',
  'system',
  'agent',
];

function wordingIn(dictionary: Record<string, string>, key: string): string {
  return dictionary[key] ?? '';
}

/** Every member of the closed vocabulary, with the key it reads through. */
const MEMBERS: readonly (readonly [string, MessageKey])[] = [
  ...LEARNING_EVENT_TYPES.map((type) => [type, EVENT_TYPE_KEYS[type]] as const),
  ...SOURCES.map((source) => [source, EVENT_SOURCE_KEYS[source]] as const),
];

/** The members whose key is not the first one seen, named as the collision they are. */
function sharedKeys(entries: readonly (readonly [string, MessageKey])[]): string[] {
  const first = new Map<string, string>();
  const collisions: string[] = [];
  for (const [member, key] of entries) {
    const owner = first.get(key);
    if (owner === undefined) first.set(key, member);
    else collisions.push(`${member} and ${owner} both read through ${key}`);
  }
  return collisions;
}

describe('the event history vocabulary', () => {
  /*
   * The RED the issue asks for, and the one that matters: `EVENT_TYPE_KEYS` is a
   * `Record<LearningEventType, MessageKey>`, so a new event type cannot be added without a map entry -
   * but nothing in the type system says the entry points at a key that exists, or at wording that is
   * not blank. These run over the closed vocabulary itself rather than over the map, so a missing entry
   * is a failure here instead of a `HELP_REQUESTED` on a Chinese screen.
   */
  it.each(LEARNING_EVENT_TYPES)('gives %s wording in both languages', (type: LearningEventType) => {
    const key = EVENT_TYPE_KEYS[type];
    expect(key, `${type} has no key`).toBeDefined();
    expect(en).toHaveProperty(key);
    expect(zh).toHaveProperty(key);
    expect(wordingIn(en, key).trim()).not.toBe('');
    expect(wordingIn(zh, key).trim()).not.toBe('');
  });

  it.each(SOURCES)('gives the %s source wording in both languages', (source) => {
    const key = EVENT_SOURCE_KEYS[source];
    expect(key, `${source} has no key`).toBeDefined();
    expect(en).toHaveProperty(key);
    expect(zh).toHaveProperty(key);
    expect(wordingIn(en, key).trim()).not.toBe('');
    expect(wordingIn(zh, key).trim()).not.toBe('');
  });

  it('gives every event type and source a key of its own', () => {
    /*
     * Two vocabulary members sharing a key would make the history ambiguous - and it is a mistake the
     * type checker cannot see, because both keys are valid `MessageKey`s.
     *
     * Across both maps and not only within each: a *source* borrowing an event type's key (or the other way
     * round) is just as ambiguous, and comparing the two lists separately let it through.
     *
     * The collisions are named rather than counted. `expect(new Set(keys).size).toBe(keys.length)` reports
     * `expected 18 to be 19` and leaves the reader to diff a nineteen-element list - which is exactly the
     * "a guard that cannot say what it found" this file has already been corrected for once.
     */
    expect(sharedKeys(MEMBERS)).toEqual([]);
  });

  it('gives every member wording no other member already says', () => {
    /*
     * Distinct keys are not enough: two members can hold keys of their own and still render the same
     * sentence, which in a column whose whole job is telling them apart is the same ambiguity one step
     * further along. A cross-map copy is the easy mistake - `'event.source.agent': 'You were back'`.
     */
    for (const [language, dictionary] of [
      ['en', en],
      ['zh', zh],
    ] as const) {
      const seen = new Map<string, string>();
      const repeated: string[] = [];
      for (const [member, key] of MEMBERS) {
        const wording = dictionary[key] ?? '';
        const owner = seen.get(wording);
        if (owner === undefined) seen.set(wording, member);
        else repeated.push(`${member} and ${owner} both read as ${JSON.stringify(wording)}`);
      }
      expect(repeated, language).toEqual([]);
    }
  });

  it('reads as history rather than as the log', () => {
    /*
     * The wording is for the learner, so no entry is the enum member, an ALL_CAPS token, or another
     * member's name - which is what stops the map being "fixed" by pointing a key at its own name or at a
     * neighbour's. The last check is the one the sources need: they are lower-case words, so neither the
     * ALL_CAPS test nor the inequality reaches them, and `'event.source.user': 'agent'` would otherwise
     * pass while putting the wrong provenance on every row.
     *
     * The component's *fallback* is deliberately not covered here: `eventTypeLabel` returns the raw value
     * for a record naming something this build does not know, and that path lives in `DashboardPage`, which
     * has no component spec. An earlier version of this file "tested" it by building the expected string
     * itself, which could not fail; a tautology is worse than an acknowledged gap.
     */
    const memberNames: readonly string[] = [...LEARNING_EVENT_TYPES, ...SOURCES];
    for (const [member, key] of MEMBERS) {
      for (const wording of [en[key], zh[key]]) {
        expect(wording, `${member} reads as ${JSON.stringify(wording)}`).not.toBe(member);
        expect(wording, `${member} reads as another member's name`).not.toMatch(/^[A-Z][A-Z_]*$/);
        expect(memberNames, `${member} reads as another member's name`).not.toContain(wording);
        expect(wording, `${member} has surrounding whitespace`).toBe(wording.trim());
      }
    }
  });
});
