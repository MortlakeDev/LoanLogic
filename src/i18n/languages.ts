// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

// Dependency-free so build tooling (vite.config.ts) can import it directly.

/** UI languages, in switcher order. `en` is the source of truth for message keys. */
export const LANGUAGES = ['en', 'zh-CN', 'ru', 'uk'] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/**
 * Each language's own name for itself (endonym). Shown in the language switcher in every
 * UI language so people can find their language; it is data, not a translation.
 */
export const LANGUAGE_ENDONYMS: Readonly<Record<Language, string>> = {
  en: 'English',
  'zh-CN': '简体中文',
  ru: 'Русский',
  uk: 'Українська',
};

/** Default number/date/currency formatting locale per UI language (region profiles override it later). */
export const DEFAULT_FORMAT_LOCALE: Readonly<Record<Language, string>> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  ru: 'ru-RU',
  uk: 'uk-UA',
};

/** Type guard for supported UI languages. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
