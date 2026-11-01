// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { APP_NAME, AUTHOR } from '../config';
import { catalogOf, LANGUAGES, PLURAL_CATEGORIES, type Language } from './index';

// The raw file text, read from disk by Vite at transform time. The raw text is needed
// because JSON.parse silently keeps only the last of two duplicate keys.
const RAW_LOCALES = import.meta.glob<string>('./locales/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*(_(zero|one|two|few|many|other))?$/;
const PLURAL_KEY = new RegExp(`^(.+)_(${PLURAL_CATEGORIES.join('|')})$`);
const PLACEHOLDER = /\{(\w+)\}/g;
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;

type Entries = readonly (readonly [key: string, value: string])[];
type FlatCatalog = Readonly<Record<string, string>>;

interface KeyShape {
  /** The bare key exists (a message without plural forms). */
  readonly plain: boolean;
  /** Plural categories present as `key_<category>`. */
  readonly categories: ReadonlySet<string>;
}

/** Decodes a quoted JSON string token, escapes included; throws if it is not a JSON string. */
function parseJsonString(token: string): string {
  const value: unknown = JSON.parse(token);
  if (typeof value !== 'string') {
    throw new TypeError(`Expected a JSON string: ${token}`);
  }
  return value;
}

/**
 * Reads the entries of a flat `{ "key": "value", … }` JSON object in file order,
 * keeping duplicates. Throws if the text is not a flat object of string values.
 */
function readEntries(text: string): Entries {
  const body = text.trim();
  if (!body.startsWith('{') || !body.endsWith('}')) {
    throw new SyntaxError('Expected a JSON object');
  }
  const inner = body.slice(1, -1).trim();
  const entry = new RegExp(`(${JSON_STRING})\\s*:\\s*(${JSON_STRING})\\s*(?:,\\s*|$)`, 'y');
  const entries: [string, string][] = [];
  while (entry.lastIndex < inner.length) {
    const offset = entry.lastIndex;
    const match = entry.exec(inner);
    const [, key, value] = match ?? [];
    if (key === undefined || value === undefined) {
      throw new SyntaxError(`Expected a "key": "string" entry at offset ${String(offset)}`);
    }
    entries.push([parseJsonString(key), parseJsonString(value)]);
  }
  return entries;
}

/** Keys seen before in `entries`: one item per repeated occurrence, in file order. */
function duplicateKeys(entries: Entries): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const [key] of entries) {
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  return duplicates;
}

/**
 * Splits a key into its base and plural category (`files_one` → `files`, `one`);
 * `category` is `undefined` for a key without a plural suffix.
 */
function splitKey(key: string): { base: string; category: string | undefined } {
  const match = PLURAL_KEY.exec(key);
  return match?.[1] === undefined
    ? { base: key, category: undefined }
    : { base: match[1], category: match[2] };
}

/** Groups keys by base key, noting whether the plain key exists and which plural forms do. */
function keyShapes(keys: Iterable<string>): Map<string, KeyShape> {
  const shapes = new Map<string, { plain: boolean; categories: Set<string> }>();
  for (const key of keys) {
    const { base, category } = splitKey(key);
    let shape = shapes.get(base);
    if (shape === undefined) {
      shape = { plain: false, categories: new Set() };
      shapes.set(base, shape);
    }
    if (category === undefined) {
      shape.plain = true;
    } else {
      shape.categories.add(category);
    }
  }
  return shapes;
}

/**
 * Lists plural keys whose forms do not match the language's CLDR plural categories
 * exactly, and keys that are both plain and plural (ambiguous for formatMessage).
 */
function pluralProblems(language: string, keys: Iterable<string>): string[] {
  const expected = [...new Intl.PluralRules(language).resolvedOptions().pluralCategories].sort();
  const problems: string[] = [];
  for (const [base, shape] of keyShapes(keys)) {
    if (shape.categories.size === 0) {
      continue;
    }
    if (shape.plain) {
      problems.push(`${base}: both a plain key and plural forms`);
    }
    const found = [...shape.categories].sort();
    if (found.join() !== expected.join()) {
      problems.push(`${base}: expected [${expected.join(', ')}], found [${found.join(', ')}]`);
    }
  }
  return problems;
}

/** The distinct `{name}` placeholder names in a message, sorted. */
function placeholders(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(PLACEHOLDER), (match) => match[1] ?? ''))].sort();
}

/** Placeholder names per base key; plural forms of one key are pooled. */
function placeholdersByBase(catalog: FlatCatalog): Map<string, string[]> {
  const pooled = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(catalog)) {
    const { base } = splitKey(key);
    const names = pooled.get(base) ?? new Set<string>();
    placeholders(value).forEach((name) => names.add(name));
    pooled.set(base, names);
  }
  return new Map(Array.from(pooled, ([base, names]) => [base, [...names].sort()]));
}

/**
 * Whether a message has letters once its placeholders are removed, i.e. words that need
 * translating (`© {year} {author}` has none).
 */
function hasLettersOutsidePlaceholders(value: string): boolean {
  return /\p{L}/u.test(value.replace(PLACEHOLDER, ''));
}

/** The raw text of a locale file; throws if there is no file for the language. */
function rawLocale(language: Language): string {
  const text = RAW_LOCALES[`./locales/${language}.json`];
  if (text === undefined) {
    throw new Error(`Missing locale file for ${language}`);
  }
  return text;
}

/**
 * A locale's messages as scanned from its file by readEntries, so the checks see the file
 * itself rather than the bundled catalog; a repeated key keeps its last value.
 */
function localeCatalog(language: Language): FlatCatalog {
  return Object.fromEntries(readEntries(rawLocale(language)));
}

/** The English value a locale key translates (plural forms English lacks map to `_other`). */
function englishSource(key: string): string | undefined {
  const en = localeCatalog('en');
  return en[key] ?? en[`${splitKey(key).base}_other`];
}

/**
 * Messages that are codes written the same in every language (GLOSSARY §6: "XIRR"; the
 * APR, APRC and IRR abbreviations where a sentence names the rate). They need neither a
 * different text nor the language's script.
 */
const SAME_IN_EVERY_LANGUAGE: ReadonlySet<string> = new Set([
  'rateMethod.xirr',
  'rateShort.usRegZApr',
  'rateShort.ukAprc',
  'rateShort.euAprc',
  'rateShort.xirr',
  'rateShort.irrNominal',
  'rateShort.irrEffective',
]);

/**
 * Characters no editor shows (the soft hyphen, zero-width characters, the BOM). A locale
 * file writes them as `\u` escapes so a reviewer can see them; tools that decode the
 * escapes while editing would otherwise leave invisible literals behind.
 */
const INVISIBLE_CHARACTERS: readonly number[] = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff];

const TRANSLATED: readonly Exclude<Language, 'en'>[] = LANGUAGES.filter(
  (language): language is Exclude<Language, 'en'> => language !== 'en',
);

describe('locale files', () => {
  it('has exactly one file per UI language', () => {
    const files = Object.keys(RAW_LOCALES)
      .map((path) => path.replace(/^\.\/locales\//, '').replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)('%s is a flat map of strings without duplicate keys', (language) => {
    const text = rawLocale(language);
    const entries = readEntries(text);
    expect(duplicateKeys(entries)).toEqual([]);
    // The scanner and JSON.parse must agree, so the file is valid JSON as well.
    expect(Object.fromEntries(entries)).toEqual(JSON.parse(text));
  });

  it.each(LANGUAGES)('%s writes invisible characters as escapes, never literally', (language) => {
    const text = rawLocale(language);
    const literal = INVISIBLE_CHARACTERS.filter((code) =>
      text.includes(String.fromCodePoint(code)),
    );
    expect(literal.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`)).toEqual(
      [],
    );
  });

  it.each(LANGUAGES)('%s is the catalog bundled for that language', (language) => {
    expect(catalogOf(language)).toEqual(localeCatalog(language));
  });

  it.each(LANGUAGES)('%s uses well-formed keys', (language) => {
    const invalid = Object.keys(localeCatalog(language)).filter((key) => !KEY_PATTERN.test(key));
    expect(invalid).toEqual([]);
  });

  it.each(TRANSLATED)('%s has the same base keys as en, each plain or plural alike', (language) => {
    const english = keyShapes(Object.keys(localeCatalog('en')));
    const local = keyShapes(Object.keys(localeCatalog(language)));
    expect([...local.keys()].sort()).toEqual([...english.keys()].sort());
    const kindMismatches = [...english]
      .filter(([base, shape]) => {
        const other = local.get(base);
        return (
          other !== undefined &&
          (other.plain !== shape.plain || other.categories.size > 0 !== shape.categories.size > 0)
        );
      })
      .map(([base]) => base);
    expect(kindMismatches).toEqual([]);
  });

  it.each(LANGUAGES)('%s has exactly its CLDR plural categories for plural keys', (language) => {
    expect(pluralProblems(language, Object.keys(localeCatalog(language)))).toEqual([]);
  });

  it.each(LANGUAGES)('%s has no empty or badly spaced values', (language) => {
    const problems = Object.entries(localeCatalog(language)).flatMap(([key, value]) => {
      if (value.trim() === '') {
        return [`${key}: empty`];
      }
      if (value !== value.trim()) {
        return [`${key}: leading or trailing whitespace`];
      }
      if (/\s{2,}/u.test(value)) {
        return [`${key}: repeated whitespace`];
      }
      return [];
    });
    expect(problems).toEqual([]);
  });

  it.each(LANGUAGES)('%s has only well-formed {name} placeholders', (language) => {
    const stray = Object.entries(localeCatalog(language))
      .filter(([, value]) => /[{}]/.test(value.replace(PLACEHOLDER, '')))
      .map(([key]) => key);
    expect(stray).toEqual([]);
  });

  it.each(TRANSLATED)('%s uses the same placeholders as en for every key', (language) => {
    expect(placeholdersByBase(localeCatalog(language))).toEqual(
      placeholdersByBase(localeCatalog('en')),
    );
  });

  it.each(LANGUAGES)(
    '%s interpolates the app and author names instead of spelling them',
    (language) => {
      const names = [APP_NAME, AUTHOR].map((name) => name.toLowerCase());
      const literal = Object.entries(localeCatalog(language))
        .filter(([, value]) => names.some((name) => value.toLowerCase().includes(name)))
        .map(([key]) => key);
      expect(literal).toEqual([]);
    },
  );

  it('lists only existing keys as written the same in every language', () => {
    const en = localeCatalog('en');
    expect([...SAME_IN_EVERY_LANGUAGE].filter((key) => en[key] === undefined)).toEqual([]);
  });

  it.each(TRANSLATED)('%s translates every message that has words', (language) => {
    const untranslated = Object.entries(localeCatalog(language))
      .filter(([key, value]) => {
        const source = englishSource(key);
        return (
          source !== undefined &&
          !SAME_IN_EVERY_LANGUAGE.has(key) &&
          hasLettersOutsidePlaceholders(source) &&
          value === source
        );
      })
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it.each(TRANSLATED)('%s writes its messages in the expected script', (language) => {
    const script = language === 'zh-CN' ? /\p{Script=Han}/u : /\p{Script=Cyrillic}/u;
    // Letters that exist in only one of the two Cyrillic languages catch swapped files.
    const foreign =
      language === 'ru' ? /[іїєґІЇЄҐ]/u : language === 'uk' ? /[ыэъёЫЭЪЁ]/u : undefined;
    const wrong = Object.entries(localeCatalog(language))
      .filter(([key, value]) => {
        const source = englishSource(key);
        if (
          source === undefined ||
          SAME_IN_EVERY_LANGUAGE.has(key) ||
          !hasLettersOutsidePlaceholders(source)
        ) {
          return false;
        }
        return !script.test(value) || (foreign?.test(value) ?? false);
      })
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });
});

describe('locale check helpers', () => {
  it('readEntries keeps duplicates in file order', () => {
    const entries = readEntries('{\n  "a.b": "x",\n  "c": "y \\" z",\n  "a.b": "w"\n}\n');
    expect(entries).toEqual([
      ['a.b', 'x'],
      ['c', 'y " z'],
      ['a.b', 'w'],
    ]);
    expect(duplicateKeys(entries)).toEqual(['a.b']);
    expect(readEntries('{}')).toEqual([]);
  });

  it('readEntries rejects anything but a flat object of strings', () => {
    expect(() => readEntries('[]')).toThrow(SyntaxError);
    expect(() => readEntries('{ "a": { "b": "c" } }')).toThrow(SyntaxError);
    expect(() => readEntries('{ "a": 1 }')).toThrow(SyntaxError);
    expect(() => readEntries('{ "a" "b" }')).toThrow(SyntaxError);
  });

  it('pluralProblems accepts exactly the CLDR categories', () => {
    expect(pluralProblems('ru', ['items_one', 'items_few', 'items_many', 'items_other'])).toEqual(
      [],
    );
    expect(pluralProblems('uk', ['items_one', 'items_few', 'items_many', 'items_other'])).toEqual(
      [],
    );
    expect(pluralProblems('en', ['items_one', 'items_other', 'title'])).toEqual([]);
    expect(pluralProblems('zh-CN', ['items_other'])).toEqual([]);
  });

  it('pluralProblems reports missing, extra and ambiguous forms', () => {
    expect(pluralProblems('ru', ['items_one', 'items_few', 'items_other'])).toEqual([
      'items: expected [few, many, one, other], found [few, one, other]',
    ]);
    expect(pluralProblems('en', ['items_one', 'items_few', 'items_other'])).toEqual([
      'items: expected [one, other], found [few, one, other]',
    ]);
    expect(pluralProblems('zh-CN', ['items_one', 'items_other'])).toEqual([
      'items: expected [other], found [one, other]',
    ]);
    expect(pluralProblems('en', ['items', 'items_one', 'items_other'])).toEqual([
      'items: both a plain key and plural forms',
    ]);
  });

  it('placeholdersByBase pools the plural forms of a key', () => {
    expect(
      placeholdersByBase({
        greeting: 'Hi {name}, {name}!',
        files_one: 'one file in {folder}',
        files_other: '{count} files in {folder}',
      }),
    ).toEqual(
      new Map([
        ['greeting', ['name']],
        ['files', ['count', 'folder']],
      ]),
    );
  });

  it('hasLettersOutsidePlaceholders ignores placeholder names and symbols', () => {
    expect(hasLettersOutsidePlaceholders('© {year} {author}')).toBe(false);
    expect(hasLettersOutsidePlaceholders('by {author}')).toBe(true);
    expect(hasLettersOutsidePlaceholders('{author} 出品')).toBe(true);
  });
});
