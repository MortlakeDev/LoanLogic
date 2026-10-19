// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { computed, effect, signal } from '@preact/signals';
import { APP_NAME } from '../../config';
import {
  DEFAULT_FORMAT_LOCALE,
  detectLanguage,
  isLanguage,
  translate,
  type Language,
  type MessageKey,
  type MessageParams,
} from '../../i18n';
import { createStorageSlot } from '../storage';

const languageSlot = createStorageSlot<Language>('language', 1, isLanguage);

/**
 * The browser's language preferences, most preferred first: `navigator.languages`, or
 * `navigator.language` alone when that list is empty. Empty where there is no `navigator`.
 */
function preferredLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

/** The current UI language. Components that call `t()` re-render when it changes. */
export const language = signal<Language>(detectLanguage(languageSlot.read(), preferredLanguages()));

/** Formatting locale for numbers, dates and currencies in the current UI language. */
export const formatLocale = computed(() => DEFAULT_FORMAT_LOCALE[language.value]);

/** Translates a key into the current UI language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(language.value, key, params, formatLocale.value);
}

/** Switches the UI language instantly and remembers the choice. */
export function setLanguage(next: Language): void {
  language.value = next;
  languageSlot.write(next);
}

/**
 * Keeps document-level language state in sync: `<html lang>`, the title and the meta
 * description. Returns a function that stops syncing.
 */
export function syncDocumentLanguage(doc: Document = document): () => void {
  return effect(() => {
    doc.documentElement.lang = language.value;
    doc.title = t('meta.title', { app: APP_NAME });
    doc
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('meta.description', { app: APP_NAME }));
  });
}
