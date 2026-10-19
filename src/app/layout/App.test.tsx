// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_NAME,
  AUTHOR,
  COPYRIGHT_YEAR,
  LICENSE_ID,
  LICENSE_URL,
  SOURCE_CODE_URL,
} from '../../config';
import { LANGUAGE_ENDONYMS, LANGUAGES, type Language } from '../../i18n/languages';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import uk from '../../i18n/locales/uk.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import { setNavigatorLanguages } from '../__tests__/fakes';
import type * as I18nModule from '../state/i18n';
import type * as ThemeModule from '../state/theme';

const LOCALES = { en, 'zh-CN': zhCN, ru, uk } as const;
const LANGUAGE_KEY = 'loanlogic:language:v1';
const THEME_KEY = 'loanlogic:theme:v1';

const cleanups: (() => void)[] = [];

interface Shell {
  readonly i18n: typeof I18nModule;
  readonly theme: typeof ThemeModule;
  readonly container: Element;
}

/**
 * Renders a fresh App. The state modules read storage and the browser at import time, so
 * the module registry is reset first and everything is imported again.
 */
async function renderShell(options: { syncDocument?: boolean } = {}): Promise<Shell> {
  vi.resetModules();
  const { App } = await import('./App');
  const i18n = await import('../state/i18n');
  const theme = await import('../state/theme');
  if (options.syncDocument === true) {
    cleanups.push(theme.syncDocumentTheme(), i18n.syncDocumentLanguage());
  }
  const { container } = render(<App />);
  return { i18n, theme, container };
}

/** Escapes regular-expression metacharacters so `text` matches literally inside a `RegExp`. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Accessible name of an external link: its label followed by the visually hidden new-tab
 * hint. Browsers keep the space before the hint; dom-accessibility-api (used by Testing
 * Library) trims it inside the inline span, so the separator is matched loosely.
 */
function newTabName(label: string, language: Language = 'en'): RegExp {
  const hint = LOCALES[language]['footer.opensInNewTab'];
  return new RegExp(`^${escapeRegExp(label)}\\s*${escapeRegExp(hint)}$`);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  delete document.documentElement.dataset.theme;
  cleanups.push(setNavigatorLanguages(['en-US', 'en']));
});

afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((stop) => {
    stop();
  });
});

describe('App shell structure', () => {
  it('has banner, main and contentinfo landmarks', async () => {
    await renderShell();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('shows the wordmark as the only h1 and the author byline', async () => {
    await renderShell();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(APP_NAME);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText(en['header.byline'].replace('{author}', AUTHOR))).toBeTruthy();
  });

  it('has two panel headings that name their regions', async () => {
    await renderShell();
    const main = screen.getByRole('main');
    const titles = within(main)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([en['panels.parameters.title'], en['panels.results.title']]);

    for (const title of [en['panels.parameters.title'], en['panels.results.title']]) {
      const region = within(main).getByRole('region', { name: title });
      expect(within(region).getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
  });

  it('shows the empty states of both panels', async () => {
    await renderShell();
    expect(screen.getByText(en['panels.parameters.emptyTitle'])).toBeTruthy();
    expect(screen.getByText(en['panels.results.emptyTitle'])).toBeTruthy();
  });

  it('starts with a skip link that targets the focusable main element', async () => {
    const { container } = await renderShell();
    const skip = screen.getByRole('link', { name: en['a11y.skipToContent'] });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(container.querySelector('a')).toBe(skip);

    const main = screen.getByRole('main');
    expect(main.id).toBe('main');
    expect(main.tabIndex).toBe(-1);
  });

  it('gives every form control an accessible name', async () => {
    const { container } = await renderShell();
    const controls = [...container.querySelectorAll('input, select, textarea, button')];
    expect(controls.length).toBeGreaterThan(0);

    const roles = ['radio', 'checkbox', 'combobox', 'listbox', 'textbox', 'spinbutton', 'button'];
    const named = new Set<HTMLElement>(
      roles.flatMap((role) => screen.queryAllByRole(role, { name: /\S/ })),
    );
    for (const control of controls) {
      expect(named.has(control as HTMLElement), control.outerHTML).toBe(true);
    }
  });
});

describe('language switcher', () => {
  it('is a labelled select listing every language in its own name', async () => {
    await renderShell();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: en['language.label'] });
    expect(select.value).toBe('en');

    const options = within(select).getAllByRole<HTMLOptionElement>('option');
    expect(options.map((option) => option.value)).toEqual([...LANGUAGES]);
    for (const option of options) {
      const code = option.value as Language;
      expect(option.lang).toBe(code);
      expect(option.textContent).toBe(LANGUAGE_ENDONYMS[code]);
    }
  });

  it.each(['ru', 'zh-CN', 'uk'] as const)(
    'switches the whole shell to %s and remembers the choice',
    async (code) => {
      const { i18n } = await renderShell({ syncDocument: true });
      const locale = LOCALES[code];
      const select = screen.getByRole<HTMLSelectElement>('combobox', {
        name: en['language.label'],
      });

      fireEvent.change(select, { target: { value: code } });

      expect(i18n.language.value).toBe(code);
      expect(localStorage.getItem(LANGUAGE_KEY)).toBe(JSON.stringify(code));
      expect(document.documentElement.lang).toBe(code);

      const titles = screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent);
      expect(titles).toEqual([locale['panels.parameters.title'], locale['panels.results.title']]);
      expect(screen.getByRole('region', { name: locale['panels.results.title'] })).toBeTruthy();
      expect(screen.getByRole('link', { name: locale['a11y.skipToContent'] })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: locale['language.label'] })).toBe(select);
      expect(select.value).toBe(code);
      expect(screen.getByRole('radio', { name: locale['theme.light'] })).toBeTruthy();
      expect(
        screen.getByRole('link', { name: newTabName(locale['footer.sourceCode'], code) }),
      ).toBeTruthy();
      // The wordmark is a proper noun and stays untranslated.
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(APP_NAME);
    },
  );

  it('renders in the stored language after a reload', async () => {
    localStorage.setItem(LANGUAGE_KEY, '"uk"');
    await renderShell();
    expect(
      screen.getByRole('heading', { level: 2, name: uk['panels.parameters.title'] }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: uk['language.label'] }).value,
    ).toBe('uk');
  });

  it('ignores values that are not supported languages', async () => {
    const { i18n } = await renderShell();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: en['language.label'] });
    const option = document.createElement('option');
    option.value = 'de';
    select.append(option);

    fireEvent.change(select, { target: { value: 'de' } });

    expect(i18n.language.value).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBeNull();
  });
});

describe('theme switcher', () => {
  it('is a labelled group of named radios', async () => {
    await renderShell();
    const group = screen.getByRole('group', { name: en['theme.label'] });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.value)).toEqual(['system', 'dark', 'light']);
    for (const name of [en['theme.system'], en['theme.dark'], en['theme.light']]) {
      expect(within(group).getByRole('radio', { name })).toBeTruthy();
    }
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
  });

  it('checks the radio of the current preference', async () => {
    const { theme } = await renderShell();
    /** Values of all checked radios: a list, so the test also proves only one is checked. */
    const checked = (): string[] =>
      screen
        .getAllByRole<HTMLInputElement>('radio')
        .filter((radio) => radio.checked)
        .map((radio) => radio.value);
    expect(theme.themePreference.value).toBe('system');
    expect(checked()).toEqual(['system']);

    await act(() => {
      theme.setThemePreference('dark');
    });
    expect(checked()).toEqual(['dark']);
  });

  it('restores the stored preference on load', async () => {
    localStorage.setItem(THEME_KEY, '"dark"');
    await renderShell();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en['theme.dark'] }).checked).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en['theme.system'] }).checked).toBe(
      false,
    );
  });

  it('applies and persists Light when it is clicked', async () => {
    const { theme } = await renderShell({ syncDocument: true });
    expect(document.documentElement.dataset.theme).toBe('dark');

    const light = screen.getByRole<HTMLInputElement>('radio', { name: en['theme.light'] });
    fireEvent.click(light);

    expect(theme.themePreference.value).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('"light"');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(light.checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en['theme.system'] }).checked).toBe(
      false,
    );
  });
});

describe('footer', () => {
  it('shows the copyright, privacy note and disclaimer', async () => {
    await renderShell();
    const footer = screen.getByRole('contentinfo');
    const copyright = en['footer.copyright']
      .replace('{year}', COPYRIGHT_YEAR)
      .replace('{author}', AUTHOR);
    expect(within(footer).getByText(copyright)).toBeTruthy();
    expect(within(footer).getByText(en['footer.privacy'])).toBeTruthy();
    expect(within(footer).getByText(en['footer.disclaimer'])).toBeTruthy();
  });

  it.each([
    ['license', LICENSE_ID, LICENSE_URL],
    ['source code', en['footer.sourceCode'], SOURCE_CODE_URL],
  ])('links to the %s in a new tab, safely and with a hint', async (_what, label, href) => {
    await renderShell();
    const footer = screen.getByRole('contentinfo');
    const link = within(footer).getByRole<HTMLAnchorElement>('link', { name: newTabName(label) });

    expect(link.getAttribute('href')).toBe(href);
    expect(link.target).toBe('_blank');
    const rel = (link.getAttribute('rel') ?? '').split(/\s+/);
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');

    const hint = link.querySelector('.visually-hidden');
    expect(hint?.textContent.trim()).toBe(en['footer.opensInNewTab']);
  });
});
