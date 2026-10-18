// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface HtmlI18nOptions {
  /** Directory with the locale JSON files. */
  readonly localesDir: string;
  /** Locales listed in the <noscript> message, in order; the first is the HTML default. */
  readonly languages: readonly string[];
  /** Values for `{name}` placeholders, e.g. the app name. */
  readonly params: Readonly<Record<string, string>>;
}

const TOKENS = {
  title: '__I18N_TITLE__',
  description: '__I18N_DESCRIPTION__',
  noscript: '<!--__I18N_NOSCRIPT__-->',
} as const;

/**
 * Fills the static parts of index.html from the locale files, so even text shown before
 * (or without) JavaScript comes from i18n keys: the default-language title and meta
 * description, and a <noscript> message in every UI language.
 */
export function htmlI18n(options: HtmlI18nOptions): Plugin {
  const load = (language: string): Readonly<Record<string, string>> =>
    JSON.parse(readFileSync(path.join(options.localesDir, `${language}.json`), 'utf8')) as Record<
      string,
      string
    >;

  const message = (catalog: Readonly<Record<string, string>>, key: string): string => {
    const template = catalog[key];
    if (template === undefined) {
      throw new Error(`html-i18n: missing message "${key}"`);
    }
    return escapeHtml(
      template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.hasOwn(options.params, name) ? (options.params[name] ?? match) : match,
      ),
    );
  };

  return {
    name: 'loanlogic:html-i18n',
    transformIndexHtml: {
      order: 'pre',
      handler(html): string {
        for (const token of Object.values(TOKENS)) {
          if (!html.includes(token)) {
            throw new Error(`html-i18n: token ${token} not found in index.html`);
          }
        }
        const [defaultLanguage] = options.languages;
        if (defaultLanguage === undefined) {
          throw new Error('html-i18n: no languages configured');
        }
        const defaults = load(defaultLanguage);
        const noscript = options.languages
          .map((language) => `<p lang="${language}">${message(load(language), 'app.noscript')}</p>`)
          .join('');
        const title = message(defaults, 'meta.title');
        const description = message(defaults, 'meta.description');
        // Replacer functions insert text literally; a string replacement would expand
        // `$&`, `$'` and similar patterns inside translated messages.
        return html
          .replace(TOKENS.title, () => title)
          .replace(TOKENS.description, () => description)
          .replace(TOKENS.noscript, () => noscript);
      },
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
