/**
 * Interface language.
 *
 * Two rules this file exists to enforce:
 *
 * 1. The domain never writes prose. It emits a key plus params, and the wording
 *    is chosen here — so there is one bilingual implementation, not two.
 * 2. Only the store persists. The renderer asks the main process to remember the
 *    choice, which is why switching language survives a restart.
 */
import { Injectable, computed, signal } from '@angular/core';
import type {
  DomainMessageKey,
  Locale,
  LocalizedMessage,
  MessageParams,
} from '@focusloop/shared-types';
import { DEFAULT_LOCALE } from '@focusloop/shared-types';
import en, { type MessageKey } from './messages.en';
import { zh } from './messages.zh';

export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, zh };

/** The label each language shows for itself, always in its own script. */
export const LOCALE_LABELS: Record<Locale, string> = { en: 'EN', zh: '中文' };

/**
 * Guards the seam between the domain vocabulary and the dictionaries.
 *
 * `messages.en.ts` is the source of truth for the key set, so nothing stops it
 * from drifting away from `DOMAIN_MESSAGE_KEYS`. This assertion makes the drift
 * a compile error: adding a key to the domain without wording fails the build.
 */
type MissingDomainKeys = Exclude<DomainMessageKey, MessageKey>;
type _EveryDomainKeyHasWording = MissingDomainKeys extends never ? true : MissingDomainKeys;

const _domainCoverage: _EveryDomainKeyHasWording = true;
void _domainCoverage;

/**
 * Translates a message key for the current locale, and owns the locale signal itself. The dictionaries
 * are the only place the wording lives; nothing here composes a sentence the domain did not emit.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly current = signal<Locale>(DEFAULT_LOCALE);

  readonly locale = this.current.asReadonly();
  readonly dictionary = computed(() => DICTIONARIES[this.current()]);

  /**
   * Translate a key, interpolating `{name}` placeholders from `params`.
   *
   * Unknown keys fall through to the key itself rather than throwing: a missing
   * string should degrade the presentation, never blank the screen.
   */
  readonly t = (key: MessageKey, params: MessageParams = {}): string => {
    const template = this.dictionary()[key] ?? key;
    return interpolate(template, params);
  };

  /** Translate a message the domain emitted. */
  translate(message: LocalizedMessage): string {
    return this.t(message.key as MessageKey, message.params);
  }

  set(locale: Locale): void {
    this.current.set(locale);
  }
}

export function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : value;
  });
}
