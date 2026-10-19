// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import en from './locales/en.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';
import zhCN from './locales/zh-CN.json';
import { formatNumber } from './format';
import { DEFAULT_FORMAT_LOCALE, DEFAULT_LANGUAGE, isLanguage, type Language } from './languages';

export * from './format';
export * from './languages';

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

type PluralCategory = (typeof PLURAL_CATEGORIES)[number];
type EnglishKey = Extract<keyof typeof en, string>;
type BaseKeyOf<K extends string> = K extends `${infer Base}_${PluralCategory}` ? Base : K;

/**
 * A message key. Plural variants (`key_one`, `key_few`, …) are addressed by their base
 * key and selected with the `count` parameter.
 */
export type MessageKey = BaseKeyOf<EnglishKey>;

/** Keys every locale must define; plural keys need at least their `_other` form. */
type RequiredKey = {
  [K in EnglishKey]: K extends `${infer Base}_${PluralCategory}` ? `${Base}_other` : K;
}[EnglishKey];

/** A flat message catalog: key → template with `{name}` placeholders. */
export type Catalog = Readonly<Record<string, string>>;

/** Interpolation values. Numbers are formatted for the locale; `count` also picks the plural form. */
export type MessageParams = Readonly<Record<string, string | number>>;

// `satisfies` turns a key missing from any locale into a compile error.
const CATALOGS = {
  en,
  'zh-CN': zhCN,
  ru,
  uk,
} satisfies Record<Language, Record<RequiredKey, string>>;

/** Returns the message catalog of a language. */
export function catalogOf(language: Language): Catalog {
  return CATALOGS[language];
}

/**
 * Maps a BCP 47 language tag (e.g. from `navigator.languages`) to a supported UI language.
 * Chinese maps to Simplified Chinese only when the tag implies the Simplified script
 * (zh, zh-CN, zh-SG, zh-Hans); Traditional-script tags do not match, so the next
 * preference is tried instead.
 */
export function matchLanguage(tag: string): Language | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return undefined;
  }
  switch (locale.language) {
    case 'en':
      return 'en';
    case 'ru':
      return 'ru';
    case 'uk':
      return 'uk';
    case 'zh':
      return locale.maximize().script === 'Hans' ? 'zh-CN' : undefined;
    default:
      return undefined;
  }
}

/**
 * Classifies a Chinese language tag for `detectLanguage`. `traditional`: the likely script
 * is not Simplified (zh-TW, zh-HK, zh-Hant, …). `bare`: the tag has neither script nor
 * region (plain `zh`).
 *
 * @returns `undefined` for non-Chinese or malformed tags.
 */
function chineseScriptOf(tag: string): { traditional: boolean; bare: boolean } | undefined {
  try {
    const locale = new Intl.Locale(tag);
    if (locale.language !== 'zh') {
      return undefined;
    }
    return {
      traditional: locale.maximize().script !== 'Hans',
      bare: locale.script === undefined && locale.region === undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Chooses the UI language: a valid saved choice, else the first supported entry of the
 * browser's preferred languages, else English.
 *
 * Browsers add a bare `zh` after a regional tag (e.g. `zh-TW, zh, en`), so a bare `zh` that
 * follows a Traditional-script tag is not taken as a Simplified preference and is skipped.
 * Explicit Simplified tags (zh-CN, zh-SG, zh-Hans) and a leading bare `zh` still match.
 *
 * @param saved Previously persisted choice (any value; invalid values are ignored).
 * @param preferred Browser language preferences, most preferred first.
 */
export function detectLanguage(saved: unknown, preferred: readonly string[]): Language {
  if (isLanguage(saved)) {
    return saved;
  }
  let sawTraditionalChinese = false;
  for (const tag of preferred) {
    const chinese = chineseScriptOf(tag);
    if (chinese?.traditional === true) {
      sawTraditionalChinese = true;
      continue;
    }
    if (sawTraditionalChinese && chinese?.bare === true) {
      continue;
    }
    const match = matchLanguage(tag);
    if (match !== undefined) {
      return match;
    }
  }
  return DEFAULT_LANGUAGE;
}

const pluralRules = new Map<string, Intl.PluralRules>();

/**
 * The cardinal plural category of `count` in `language` (in Russian: 1 → one, 3 → few,
 * 5 → many). `Intl.PluralRules` objects are cached per language because messages are
 * resolved on every render.
 */
function pluralCategory(language: string, count: number): PluralCategory {
  let rules = pluralRules.get(language);
  if (rules === undefined) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return rules.select(count);
}

/**
 * Resolves and interpolates a message from a catalog.
 *
 * - If `params.count` is a number, the plural form for `language` is used
 *   (`key_one`, `key_few`, …), falling back to `key_other`.
 * - `{name}` placeholders are replaced by `params.name`; numbers are formatted with
 *   `formatLocale`. Placeholders without a value are left as they are.
 *
 * @returns The message, or `undefined` if the catalog has no entry for the key.
 */
export function formatMessage(
  catalog: Catalog,
  language: string,
  formatLocale: string,
  key: string,
  params?: MessageParams,
): string | undefined {
  let template: string | undefined;
  const count = params?.count;
  if (typeof count === 'number') {
    template = catalog[`${key}_${pluralCategory(language, count)}`] ?? catalog[`${key}_other`];
  }
  template ??= catalog[key];
  if (template === undefined) {
    return undefined;
  }
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    // Own properties only: `{toString}` must not resolve to an Object.prototype member.
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined) {
      return placeholder;
    }
    return typeof value === 'number' ? formatNumber(value, formatLocale) : value;
  });
}

/**
 * Translates a message key into a UI language.
 *
 * Key parity across locales is enforced at compile time and by tests, so a missing entry
 * is a bug: the key itself is returned (visible, never a silent substitute) and reported.
 *
 * @param formatLocale Locale for numbers in `params`; defaults to the language's default
 *   formatting locale (region profiles will pass their own).
 */
export function translate(
  language: Language,
  key: MessageKey,
  params?: MessageParams,
  formatLocale: string = DEFAULT_FORMAT_LOCALE[language],
): string {
  const message = formatMessage(CATALOGS[language], language, formatLocale, key, params);
  if (message === undefined) {
    console.error(`[i18n] Missing message "${key}" for language "${language}"`);
    return key;
  }
  return message;
}
