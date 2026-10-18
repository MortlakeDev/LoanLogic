// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IndexHtmlTransformContext, Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { htmlI18n, type HtmlI18nOptions } from './html-i18n.ts';

// Not `new URL(…, import.meta.url)`: Vite rewrites that pattern to an http URL under jsdom.
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const INDEX_HTML_FILE = path.join(ROOT, 'index.html');
const INDEX_HTML = readFileSync(INDEX_HTML_FILE, 'utf8');
const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales');
const APP = 'LoanLogic';

/** The real configuration, as in vite.config.ts. */
const REAL_OPTIONS: HtmlI18nOptions = {
  localesDir: LOCALES_DIR,
  languages: ['en', 'zh-CN', 'ru', 'uk'],
  params: { app: APP },
};

const TOKENS = {
  title: '__I18N_TITLE__',
  description: '__I18N_DESCRIPTION__',
  noscript: '<!--__I18N_NOSCRIPT__-->',
} as const;

/** The transform hook without Vite's plugin `this`, which html-i18n does not use. */
type HtmlTransform = (html: string, context: IndexHtmlTransformContext) => unknown;

function transformOf(plugin: Plugin): HtmlTransform {
  const hook = plugin.transformIndexHtml;
  if (hook === undefined) {
    throw new Error('html-i18n registers no transformIndexHtml hook');
  }
  return typeof hook === 'function' ? hook : hook.handler;
}

function transform(options: HtmlI18nOptions, html: string = INDEX_HTML): string {
  const result = transformOf(htmlI18n(options))(html, {
    path: '/index.html',
    filename: INDEX_HTML_FILE,
  });
  if (typeof result !== 'string') {
    throw new Error('html-i18n must return the transformed HTML as a string');
  }
  return result;
}

function catalog(language: string): Readonly<Record<string, string>> {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

function fill(template: string | undefined, params: Readonly<Record<string, string>>): string {
  if (template === undefined) {
    throw new Error('message missing from the locale file');
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

/** The decoded title, description and <noscript> paragraphs, as a browser sees them. */
function read(html: string): {
  title: string | null | undefined;
  description: string | null | undefined;
  noscript: { lang: string | null; text: string | null }[];
} {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const inner = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1];
  if (inner === undefined) {
    throw new Error('no <noscript> element in the output');
  }
  // Parsed on its own: with scripting on, a browser treats <noscript> content as raw text.
  const fragment = new DOMParser().parseFromString(inner, 'text/html');
  return {
    title: page.querySelector('title')?.textContent,
    description: page.querySelector('meta[name="description"]')?.getAttribute('content'),
    noscript: [...fragment.body.querySelectorAll('p')].map((paragraph) => ({
      lang: paragraph.getAttribute('lang'),
      text: paragraph.textContent,
    })),
  };
}

describe('htmlI18n on index.html', () => {
  it('registers a transformIndexHtml hook that runs before other plugins', () => {
    expect(htmlI18n(REAL_OPTIONS).transformIndexHtml).toMatchObject({ order: 'pre' });
  });

  it('fills the title and meta description from the first language', () => {
    const en = catalog('en');
    const page = read(transform(REAL_OPTIONS));
    expect(page.title).toBe(fill(en['meta.title'], { app: APP }));
    expect(page.description).toBe(fill(en['meta.description'], { app: APP }));
  });

  it('writes one <noscript> paragraph per language, in order, from app.noscript', () => {
    const html = transform(REAL_OPTIONS);
    expect(read(html).noscript).toEqual(
      REAL_OPTIONS.languages.map((lang) => ({
        lang,
        text: fill(catalog(lang)['app.noscript'], { app: APP }),
      })),
    );
    expect(/<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1]).toMatch(
      /^(?:<p lang="[\w-]+">[^<]*<\/p>){4}$/,
    );
  });

  it('leaves no token or placeholder behind', () => {
    const html = transform(REAL_OPTIONS);
    expect(html).not.toContain('__I18N_');
    expect(html).not.toContain('{app}');
  });

  it('changes nothing else in the page', () => {
    const restored = transform(REAL_OPTIONS)
      .replace(/<title>[^<]*<\/title>/, `<title>${TOKENS.title}</title>`)
      .replace(
        /(<meta name="description" content=")[^"]*(")/,
        (_match, before: string, after: string) => `${before}${TOKENS.description}${after}`,
      )
      .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${TOKENS.noscript}</noscript>`);
    expect(restored).toBe(INDEX_HTML);
  });

  it.each(Object.values(TOKENS))('throws when index.html lacks the token %s', (token) => {
    expect(INDEX_HTML).toContain(token);
    expect(() => transform(REAL_OPTIONS, INDEX_HTML.replace(token, ''))).toThrow(token);
  });
});

describe('htmlI18n with fixture locales', () => {
  let localesDir = '';

  beforeEach(() => {
    localesDir = mkdtempSync(path.join(tmpdir(), 'loanlogic-html-i18n-'));
  });

  afterEach(() => {
    rmSync(localesDir, { recursive: true, force: true });
  });

  const writeLocale = (language: string, messages: Readonly<Record<string, string>>): void => {
    writeFileSync(path.join(localesDir, `${language}.json`), JSON.stringify(messages), 'utf8');
  };

  const options = (
    languages: readonly string[],
    params: Readonly<Record<string, string>> = { app: APP },
  ): HtmlI18nOptions => ({ localesDir, languages, params });

  it('escapes HTML special characters in messages and parameters', () => {
    const messages = {
      'meta.title': 'Title <b>&"</b> {app}',
      'meta.description': 'Say "hi" & <wave>',
      'app.noscript': '<script>alert(1)</script> & {app}',
    };
    const params = { app: 'A&B <C> "D"' };
    writeLocale('en', messages);

    const html = transform(options(['en'], params));

    expect(html).toContain(
      '<title>Title &lt;b&gt;&amp;&quot;&lt;/b&gt; A&amp;B &lt;C&gt; &quot;D&quot;</title>',
    );
    expect(html).toContain('content="Say &quot;hi&quot; &amp; &lt;wave&gt;"');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>alert');
    // Escaped exactly once: a browser decodes the original text back.
    expect(read(html)).toEqual({
      title: fill(messages['meta.title'], params),
      description: messages['meta.description'],
      noscript: [{ lang: 'en', text: fill(messages['app.noscript'], params) }],
    });
  });

  it('takes the title and description from the first configured language', () => {
    writeLocale('ru', {
      'meta.title': 'Заголовок',
      'meta.description': 'Описание',
      'app.noscript': 'Включите JavaScript',
    });
    writeLocale('en', {
      'meta.title': 'Title',
      'meta.description': 'Description',
      'app.noscript': 'Enable JavaScript',
    });

    expect(read(transform(options(['ru', 'en'])))).toEqual({
      title: 'Заголовок',
      description: 'Описание',
      noscript: [
        { lang: 'ru', text: 'Включите JavaScript' },
        { lang: 'en', text: 'Enable JavaScript' },
      ],
    });
  });

  it('keeps placeholders that have no parameter', () => {
    writeLocale('en', {
      'meta.title': '{app} for {nobody}',
      'meta.description': 'd',
      'app.noscript': 'n',
    });
    expect(read(transform(options(['en']))).title).toBe(`${APP} for {nobody}`);
  });

  it('inserts messages literally, even when they contain $ replacement patterns', () => {
    const title = "Pay $& now, $' later, $$ never, $` maybe";
    writeLocale('en', { 'meta.title': title, 'meta.description': 'd', 'app.noscript': '$&' });

    const page = read(transform(options(['en'])));

    expect(page.title).toBe(title);
    expect(page.noscript).toEqual([{ lang: 'en', text: '$&' }]);
  });

  it.each(['meta.title', 'meta.description', 'app.noscript'])(
    'throws when the default language lacks %s',
    (key) => {
      const messages: Record<string, string> = {
        'meta.title': 't',
        'meta.description': 'd',
        'app.noscript': 'n',
      };
      writeLocale('en', Object.fromEntries(Object.entries(messages).filter(([k]) => k !== key)));
      expect(() => transform(options(['en']))).toThrow(`missing message "${key}"`);
    },
  );

  it('throws when another language lacks app.noscript', () => {
    writeLocale('en', { 'meta.title': 't', 'meta.description': 'd', 'app.noscript': 'n' });
    writeLocale('uk', { 'meta.title': 't', 'meta.description': 'd' });
    expect(() => transform(options(['en', 'uk']))).toThrow('missing message "app.noscript"');
  });

  it('throws when a locale file is missing', () => {
    writeLocale('en', { 'meta.title': 't', 'meta.description': 'd', 'app.noscript': 'n' });
    expect(() => transform(options(['en', 'xx']))).toThrow();
  });

  it('throws when no languages are configured', () => {
    expect(() => transform(options([]))).toThrow('no languages configured');
  });
});
