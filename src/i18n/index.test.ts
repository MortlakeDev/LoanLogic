// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it, vi } from 'vitest';
import {
  catalogOf,
  detectLanguage,
  formatMessage,
  LANGUAGES,
  matchLanguage,
  PLURAL_CATEGORIES,
  translate,
  type Catalog,
  type MessageKey,
} from './index';

/** The locale's grouping and decimal separators, as this runtime's ICU defines them. */
function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === 'group')?.value;
  const decimal = parts.find((part) => part.type === 'decimal')?.value;
  if (group === undefined || decimal === undefined) {
    throw new Error(`No group/decimal separator for ${locale}`);
  }
  return { group, decimal };
}

// Fixture catalogs tag each plural form so the chosen category is visible in the output.
const EN: Catalog = {
  files_one: '{count} file',
  files_other: '{count} files',
  greeting: 'Hello, {name}!',
  summary: '{name} has {count} items and {missing}',
  echo: '{value}',
};

const RU: Catalog = {
  files_one: 'one: {count} файл',
  files_few: 'few: {count} файла',
  files_many: 'many: {count} файлов',
  files_other: 'other: {count} файла',
};

const UK: Catalog = {
  files_one: 'one: {count} файл',
  files_few: 'few: {count} файли',
  files_many: 'many: {count} файлів',
  files_other: 'other: {count} файлу',
};

const ZH: Catalog = {
  files_other: '{count} 个文件',
};

describe('matchLanguage', () => {
  it.each([
    ['en', 'en'],
    ['en-GB', 'en'],
    ['en-US', 'en'],
    ['EN-us', 'en'],
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['uk', 'uk'],
    ['uk-UA', 'uk'],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hans-HK', 'zh-CN'],
  ] as const)('maps %s to %s', (tag, expected) => {
    expect(matchLanguage(tag)).toBe(expected);
  });

  it.each(['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN'])(
    'does not map the Traditional Chinese tag %s to Simplified Chinese',
    (tag) => {
      expect(matchLanguage(tag)).toBeUndefined();
    },
  );

  it.each(['de', 'fr-FR', 'be-BY'])('returns undefined for the unsupported language %s', (tag) => {
    expect(matchLanguage(tag)).toBeUndefined();
  });

  it.each(['', 'x_y!!', '-', 'en--US'])('returns undefined for the malformed tag %j', (tag) => {
    expect(matchLanguage(tag)).toBeUndefined();
  });
});

describe('detectLanguage', () => {
  it('prefers a valid saved choice over the browser languages', () => {
    expect(detectLanguage('uk', ['ru-RU', 'en-US'])).toBe('uk');
    expect(detectLanguage('zh-CN', [])).toBe('zh-CN');
  });

  it.each([42, 'fr', null, undefined, '', 'EN', 'zh', { language: 'ru' }])(
    'ignores the invalid saved value %j',
    (saved) => {
      expect(detectLanguage(saved, ['ru-RU'])).toBe('ru');
    },
  );

  it('takes the first supported browser language in order', () => {
    expect(detectLanguage(undefined, ['de', 'zh-TW', 'uk'])).toBe('uk');
    expect(detectLanguage(undefined, ['fr-FR', 'en-GB', 'ru'])).toBe('en');
    expect(detectLanguage(undefined, ['', 'x_y!!', 'zh-SG', 'en'])).toBe('zh-CN');
  });

  it('falls back to English when nothing matches', () => {
    expect(detectLanguage(undefined, [])).toBe('en');
    expect(detectLanguage('fr', ['de-DE', 'zh-Hant'])).toBe('en');
  });

  // Chrome and Firefox add the bare base language after a regional tag.
  it.each([
    [['zh-TW', 'zh', 'en-US', 'en'], 'en'],
    [['zh-HK', 'zh-TW', 'zh', 'en'], 'en'],
    [['zh-TW', 'zh', 'ru'], 'ru'],
    [['zh-Hant', 'zh'], 'en'],
  ] as const)(
    'does not read the implicit bare zh after a Traditional tag as Simplified: %j → %s',
    (preferred, expected) => {
      expect(detectLanguage(undefined, preferred)).toBe(expected);
    },
  );

  it.each([
    [['zh-TW', 'zh-CN'], 'zh-CN'],
    [['zh-TW', 'zh-Hans'], 'zh-CN'],
    [['zh', 'zh-TW'], 'zh-CN'],
    [['zh-CN', 'zh', 'en'], 'zh-CN'],
    [['zh'], 'zh-CN'],
  ] as const)(
    'still honours explicit or leading Simplified tags: %j → %s',
    (preferred, expected) => {
      expect(detectLanguage(undefined, preferred)).toBe(expected);
    },
  );
});

describe('formatMessage', () => {
  it('selects English one/other forms', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'files', { count: 1 })).toBe('1 file');
    expect(formatMessage(EN, 'en', 'en-US', 'files', { count: 0 })).toBe('0 files');
    expect(formatMessage(EN, 'en', 'en-US', 'files', { count: 2 })).toBe('2 files');
    expect(formatMessage(EN, 'en', 'en-US', 'files', { count: 1.5 })).toBe('1.5 files');
  });

  describe.each([
    ['ru', 'ru-RU', RU],
    ['uk', 'uk-UA', UK],
  ] as const)('%s plural forms', (language, formatLocale, catalog) => {
    const { decimal } = separators(formatLocale);
    it.each([
      [1, 'one', '1'],
      [2, 'few', '2'],
      [5, 'many', '5'],
      [11, 'many', '11'],
      [21, 'one', '21'],
      [22, 'few', '22'],
      [25, 'many', '25'],
      [1.5, 'other', `1${decimal}5`],
    ])('uses the right form for %d (%s)', (count, category, shown) => {
      const message = formatMessage(catalog, language, formatLocale, 'files', { count });
      expect(message).toBe(catalog[`files_${category}`]?.replace('{count}', shown));
      expect(message?.startsWith(`${category}: `)).toBe(true);
    });
  });

  it('uses the only (other) form in Simplified Chinese', () => {
    expect(formatMessage(ZH, 'zh-CN', 'zh-CN', 'files', { count: 1 })).toBe('1 个文件');
    expect(formatMessage(ZH, 'zh-CN', 'zh-CN', 'files', { count: 5 })).toBe('5 个文件');
  });

  it('falls back to the other form when a category is missing', () => {
    const partial: Catalog = { files_one: 'one: {count}', files_other: 'other: {count}' };
    expect(formatMessage(partial, 'ru', 'ru-RU', 'files', { count: 5 })).toBe('other: 5');
    expect(formatMessage(partial, 'ru', 'ru-RU', 'files', { count: 22 })).toBe('other: 22');
    expect(formatMessage(partial, 'ru', 'ru-RU', 'files', { count: 21 })).toBe('one: 21');
  });

  it('uses the plain key when there is no numeric count', () => {
    const catalog: Catalog = { files: 'Files', files_one: '{count} file', files_other: 'many' };
    expect(formatMessage(catalog, 'en', 'en-US', 'files')).toBe('Files');
    expect(formatMessage(catalog, 'en', 'en-US', 'files', {})).toBe('Files');
    expect(formatMessage(catalog, 'en', 'en-US', 'files', { count: '3' })).toBe('Files');
    expect(formatMessage(catalog, 'en', 'en-US', 'files', { count: 1 })).toBe('1 file');
  });

  it('uses the plain key when a counted message has no plural forms', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'greeting', { name: 'Ann', count: 2 })).toBe(
      'Hello, Ann!',
    );
  });

  it('does not resolve a plural-only message without a count', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'files')).toBeUndefined();
  });

  it('returns the template unchanged when there are no params', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'greeting')).toBe('Hello, {name}!');
  });

  it('formats number params with the formatting locale', () => {
    const ru = separators('ru-RU');
    expect(formatMessage(RU, 'ru', 'ru-RU', 'files', { count: 1234.5 })).toBe(
      `other: 1${ru.group}234${ru.decimal}5 файла`,
    );
    expect(formatMessage(EN, 'en', 'en-US', 'echo', { value: 1234.5 })).toBe('1,234.5');
    // The plural form follows the UI language; digits follow the formatting locale.
    expect(formatMessage(EN, 'en', 'ru-RU', 'files', { count: 1234.5 })).toBe(
      `1${ru.group}234${ru.decimal}5 files`,
    );
  });

  it('inserts string params verbatim', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'echo', { value: '1234.5' })).toBe('1234.5');
    expect(formatMessage(EN, 'en', 'en-US', 'echo', { value: '$& $1 $$' })).toBe('$& $1 $$');
    // Inserted text is not scanned for placeholders again.
    expect(formatMessage(EN, 'en', 'en-US', 'echo', { value: '{name}', name: 'x' })).toBe('{name}');
  });

  it('leaves placeholders without a value as they are', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'summary', { name: 'Ann', count: 3 })).toBe(
      'Ann has 3 items and {missing}',
    );
  });

  it('returns undefined for an unknown key', () => {
    expect(formatMessage(EN, 'en', 'en-US', 'nope')).toBeUndefined();
    expect(formatMessage(EN, 'en', 'en-US', 'nope', { count: 1 })).toBeUndefined();
  });
});

describe('translate', () => {
  const pluralSuffix = new RegExp(`_(${PLURAL_CATEGORIES.join('|')})$`);

  it.each(LANGUAGES)('resolves every English key in %s', (language) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const keys = new Set(Object.keys(catalogOf('en')).map((key) => key.replace(pluralSuffix, '')));
    for (const key of keys) {
      const plural = !(key in catalogOf('en'));
      const message = translate(language, key as MessageKey, plural ? { count: 2 } : undefined);
      expect(message).not.toBe(key);
      expect(message.trim()).not.toBe('');
      if (!plural) {
        expect(message).toBe(catalogOf(language)[key]);
      }
    }
    expect(error).not.toHaveBeenCalled();
  });

  it('interpolates params', () => {
    expect(translate('en', 'header.byline', { author: 'Ann' })).toBe('by Ann');
    expect(translate('en', 'footer.copyright', { year: '2026', author: 'Ann' })).toBe('© 2026 Ann');
  });

  it('formats number params with the language default formatting locale', () => {
    const uk = separators('uk-UA');
    expect(translate('en', 'header.byline', { author: 1234.5 })).toBe('by 1,234.5');
    expect(translate('uk', 'header.byline', { author: 1234.5 })).toBe(
      `від 1${uk.group}234${uk.decimal}5`,
    );
  });

  it('formats number params with an explicit formatting locale when given', () => {
    const ru = separators('ru-RU');
    expect(translate('en', 'header.byline', { author: 1234.5 }, 'ru-RU')).toBe(
      `by 1${ru.group}234${ru.decimal}5`,
    );
  });

  it('resolves placeholders from own params only, never from Object.prototype', () => {
    const catalog = { greeting: 'Hi {toString} and {constructor}' };
    expect(formatMessage(catalog, 'en', 'en-US', 'greeting', {})).toBe(
      'Hi {toString} and {constructor}',
    );
    expect(formatMessage(catalog, 'en', 'en-US', 'greeting', { toString: 'A' })).toBe(
      'Hi A and {constructor}',
    );
  });

  it('returns the key itself and reports a missing message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = 'no.such.key' as MessageKey;
    expect(translate('ru', key)).toBe('no.such.key');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('no.such.key');
  });
});
