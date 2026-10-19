// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../../config';
import { DEFAULT_FORMAT_LOCALE, LANGUAGES, type Language } from '../../i18n/languages';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import uk from '../../i18n/locales/uk.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import { blockLocalStorage, setNavigatorLanguages } from '../__tests__/fakes';
import type * as I18nModule from './i18n';

const KEY = 'loanlogic:language:v1';

const LOCALES = { en, 'zh-CN': zhCN, ru, uk } as const;

const cleanups: (() => void)[] = [];

/** Imports a fresh copy of the module, so its import-time detection sees the prepared globals. */
async function loadI18n(): Promise<typeof I18nModule> {
  vi.resetModules();
  return import('./i18n');
}

/**
 * Fakes `navigator.languages` (and `navigator.language`, which defaults to the first entry)
 * until the test ends.
 */
function preferLanguages(languages: readonly string[], language?: string): void {
  cleanups.push(setNavigatorLanguages(languages, language));
}

/** The document title expected for a language: its `meta.title` with the app name filled in. */
function expectedTitle(language: Language): string {
  return LOCALES[language]['meta.title'].replace('{app}', APP_NAME);
}

/** The document's meta description, or `null` if the element or its content is missing. */
function metaDescription(): string | null {
  return document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? null;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.title = '';
  const meta = document.createElement('meta');
  meta.name = 'description';
  meta.content = 'placeholder';
  document.head.replaceChildren(meta);
  preferLanguages(['en-US', 'en']);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

describe('language detection at startup', () => {
  it.each([
    [['ru-RU', 'en'], 'ru'],
    [['uk-UA'], 'uk'],
    [['zh-CN', 'en'], 'zh-CN'],
    [['zh-Hans-SG'], 'zh-CN'],
    [['zh-TW', 'uk'], 'uk'],
    [['de-DE', 'fr', 'ru'], 'ru'],
    [['de-DE', 'fr'], 'en'],
    [['en-GB', 'ru'], 'en'],
  ] as const)('maps navigator.languages %j to %s', async (preferred, expected) => {
    preferLanguages(preferred);
    const { language } = await loadI18n();
    expect(language.value).toBe(expected);
  });

  it('falls back to navigator.language when navigator.languages is empty', async () => {
    preferLanguages([], 'uk-UA');
    const { language } = await loadI18n();
    expect(language.value).toBe('uk');
  });

  it('uses the stored choice, else English, where no navigator exists', async () => {
    vi.stubGlobal('navigator', undefined);
    expect((await loadI18n()).language.value).toBe('en');

    localStorage.setItem(KEY, '"ru"');
    expect((await loadI18n()).language.value).toBe('ru');
  });

  it('prefers a stored choice over navigator.languages', async () => {
    preferLanguages(['ru-RU']);
    localStorage.setItem(KEY, '"zh-CN"');
    const { language } = await loadI18n();
    expect(language.value).toBe('zh-CN');
  });

  it.each(['"de"', '"RU"', '"zh"', '42', 'null', '{broken'])(
    'ignores the invalid stored value %s and uses navigator.languages',
    async (raw) => {
      preferLanguages(['uk']);
      localStorage.setItem(KEY, raw);
      const { language } = await loadI18n();
      expect(language.value).toBe('uk');
    },
  );

  it('still detects from navigator.languages when storage is blocked', async () => {
    preferLanguages(['ru']);
    cleanups.push(blockLocalStorage());
    const { language, setLanguage } = await loadI18n();
    expect(language.value).toBe('ru');
    expect(() => {
      setLanguage('uk');
    }).not.toThrow();
    expect(language.value).toBe('uk');
  });
});

describe('setLanguage', () => {
  it('switches the language and persists it under the language key', async () => {
    const { language, setLanguage, t } = await loadI18n();
    expect(language.value).toBe('en');

    setLanguage('ru');
    expect(language.value).toBe('ru');
    expect(localStorage.getItem(KEY)).toBe('"ru"');
    expect(t('panels.results.title')).toBe(ru['panels.results.title']);
  });

  it('is restored after a reload, even if the browser prefers another language', async () => {
    (await loadI18n()).setLanguage('uk');
    preferLanguages(['ru-RU']);
    const reloaded = await loadI18n();
    expect(reloaded.language.value).toBe('uk');
  });
});

describe('t', () => {
  it.each(LANGUAGES)('translates and interpolates in %s', async (code) => {
    const { setLanguage, t } = await loadI18n();
    setLanguage(code);
    expect(t('theme.label')).toBe(LOCALES[code]['theme.label']);
    expect(t('header.byline', { author: 'Mortlake' })).toBe(
      LOCALES[code]['header.byline'].replace('{author}', 'Mortlake'),
    );
  });
});

describe('formatLocale', () => {
  it('follows the language', async () => {
    const { formatLocale, setLanguage } = await loadI18n();
    for (const code of LANGUAGES) {
      setLanguage(code);
      expect(formatLocale.value).toBe(DEFAULT_FORMAT_LOCALE[code]);
    }
    expect(DEFAULT_FORMAT_LOCALE).toEqual({
      en: 'en-US',
      'zh-CN': 'zh-CN',
      ru: 'ru-RU',
      uk: 'uk-UA',
    });
  });
});

describe('syncDocumentLanguage', () => {
  it('sets <html lang>, the title and the meta description', async () => {
    preferLanguages(['ru-RU']);
    const { syncDocumentLanguage } = await loadI18n();
    cleanups.push(syncDocumentLanguage());

    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toContain(APP_NAME);
    expect(document.title).toBe(expectedTitle('ru'));
    expect(metaDescription()).toBe(ru['meta.description']);
  });

  it('re-runs whenever the language changes', async () => {
    const { setLanguage, syncDocumentLanguage } = await loadI18n();
    cleanups.push(syncDocumentLanguage());
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(expectedTitle('en'));

    for (const code of ['zh-CN', 'uk', 'ru', 'en'] as const) {
      setLanguage(code);
      expect(document.documentElement.lang).toBe(code);
      expect(document.title).toContain(APP_NAME);
      expect(document.title).toBe(expectedTitle(code));
      expect(metaDescription()).toBe(LOCALES[code]['meta.description']);
    }
  });

  it('works on a document without a meta description', async () => {
    const { syncDocumentLanguage } = await loadI18n();
    const other = document.implementation.createHTMLDocument('');
    cleanups.push(syncDocumentLanguage(other));
    expect(other.documentElement.lang).toBe('en');
    expect(other.title).toBe(expectedTitle('en'));
  });

  it('stops updating the document when disposed', async () => {
    const { setLanguage, syncDocumentLanguage } = await loadI18n();
    const stop = syncDocumentLanguage();
    setLanguage('uk');
    stop();

    setLanguage('ru');
    expect(document.documentElement.lang).toBe('uk');
    expect(document.title).toBe(expectedTitle('uk'));
    expect(metaDescription()).toBe(uk['meta.description']);
  });
});
