// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { APP_NAME, AUTHOR, COPYRIGHT_YEAR } from '../../src/config.ts';
import { LANGUAGES, type Language } from '../../src/i18n/languages.ts';

export { LANGUAGES, type Language };

/** The applied theme (`<html data-theme>`). */
export type Theme = 'dark' | 'light';

/** What the user can pick in the theme switcher. */
export type ThemePreference = 'system' | Theme;

export const THEMES: readonly Theme[] = ['dark', 'light'];

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

/** The other theme. */
export function opposite(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/**
 * Storage keys the app reads (namespace `loanlogic:`, versioned). The inline theme
 * script in index.html uses the theme key literally, so it is part of the contract.
 */
export const STORAGE_KEYS = {
  language: 'loanlogic:language:v1',
  theme: 'loanlogic:theme:v1',
} as const;

// Brand constants interpolated into messages; they are never translated.
const BRAND_PARAMS: Readonly<Record<string, string>> = {
  app: APP_NAME,
  author: AUTHOR,
  year: COPYRIGHT_YEAR,
};

const LOCALES_DIR = new URL('../../src/i18n/locales/', import.meta.url);

type Catalog = Readonly<Record<string, string>>;

const catalogs = new Map<Language, Catalog>();

function isCatalog(value: unknown): value is Catalog {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/** Reads a locale catalog from `src/i18n/locales`, so expectations follow the catalogs. */
export function catalog(language: Language): Catalog {
  const cached = catalogs.get(language);
  if (cached !== undefined) {
    return cached;
  }
  const file = fileURLToPath(new URL(`${language}.json`, LOCALES_DIR));
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isCatalog(parsed)) {
    throw new Error(`${file} is not a flat string catalog`);
  }
  catalogs.set(language, parsed);
  return parsed;
}

/** A catalog message with the brand placeholders ({app}, {author}, {year}) filled in. */
export function message(language: Language, key: string): string {
  const template = catalog(language)[key];
  if (template === undefined) {
    throw new Error(`Missing message "${key}" in ${language}.json`);
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => BRAND_PARAMS[name] ?? match);
}

/**
 * Seeds local storage before any page script runs. Values are written only when the key
 * is absent, so a choice the app stores later survives reloads.
 */
export async function seedStorage(
  target: Page | BrowserContext,
  values: { readonly language?: Language; readonly theme?: ThemePreference },
): Promise<void> {
  const entries: [string, string][] = [];
  if (values.language !== undefined) {
    entries.push([STORAGE_KEYS.language, JSON.stringify(values.language)]);
  }
  if (values.theme !== undefined) {
    entries.push([STORAGE_KEYS.theme, JSON.stringify(values.theme)]);
  }
  await target.addInitScript((pairs: readonly (readonly [string, string])[]) => {
    try {
      for (const [key, value] of pairs) {
        if (window.localStorage.getItem(key) === null) {
          window.localStorage.setItem(key, value);
        }
      }
    } catch {
      // Storage is unavailable in this document (e.g. about:blank); nothing to seed.
    }
  }, entries);
}

/** Reads a raw local storage value from the current page. */
export async function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => window.localStorage.getItem(name), key);
}

/** Records console errors and uncaught page errors from the moment it is called. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error') {
      errors.push(`console.error: ${entry.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

/** Opens the app at the configured base URL and waits for the shell and its fonts. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await waitForFonts(page);
}

/** Waits until web fonts are loaded so layout and contrast checks see final metrics. */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

const MARKER = '__loanlogicE2eMarker';

/** Marks the current document; the mark disappears only if the page reloads. */
export async function setReloadMarker(page: Page): Promise<void> {
  await page.evaluate((name) => {
    Reflect.set(window, name, true);
  }, MARKER);
}

/** Whether the mark set by `setReloadMarker` is still present (no reload happened). */
export async function hasReloadMarker(page: Page): Promise<boolean> {
  return page.evaluate((name) => Reflect.get(window, name) === true, MARKER);
}

/** The language `<select>`, found by its (visually hidden) label in the given language. */
export function languageSelect(page: Page, language: Language): Locator {
  return page.getByRole('combobox', { name: message(language, 'language.label'), exact: true });
}

/** The theme radio group (a fieldset whose legend names it). */
export function themeGroup(page: Page, language: Language = 'en'): Locator {
  return page.getByRole('group', { name: message(language, 'theme.label'), exact: true });
}

/** One theme radio button, by its accessible name. */
export function themeRadio(
  page: Page,
  preference: ThemePreference,
  language: Language = 'en',
): Locator {
  return themeGroup(page, language).getByRole('radio', {
    name: message(language, `theme.${preference}`),
    exact: true,
  });
}

/** The two workspace panels (sections labelled by their headings). */
export function panels(
  page: Page,
  language: Language = 'en',
): { parameters: Locator; results: Locator } {
  return {
    parameters: page.getByRole('region', {
      name: message(language, 'panels.parameters.title'),
      exact: true,
    }),
    results: page.getByRole('region', {
      name: message(language, 'panels.results.title'),
      exact: true,
    }),
  };
}

/** Computed colors are serialized as rgb()/rgba(); this matches a fully transparent one. */
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;

/** The computed `body` background color right now. */
export async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * Measures the computed `body` background of each theme on the live page by switching
 * `<html data-theme>` for an instant and restoring it. Tests compare against these
 * instead of hard-coding colors: every color value is a placeholder until DESIGN.md.
 */
export async function measureThemeBackgrounds(
  page: Page,
): Promise<Readonly<Record<Theme, string>>> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const original = root.getAttribute('data-theme');
    // A background transition would report an intermediate color; freeze them meanwhile.
    const freeze = document.createElement('style');
    freeze.textContent =
      '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(freeze);
    const measure = (theme: string): string => {
      root.setAttribute('data-theme', theme);
      return getComputedStyle(document.body).backgroundColor;
    };
    try {
      return { dark: measure('dark'), light: measure('light') };
    } finally {
      if (original === null) {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', original);
      }
      // Settle the restored style while transitions are still off, so none starts.
      getComputedStyle(document.body).getPropertyValue('background-color');
      freeze.remove();
    }
  });
}

/**
 * Resolves a color custom property (e.g. `--color-bg`) for the current theme and
 * serializes it the way computed styles are, so it compares with `backgroundColor`.
 */
export async function resolveColorToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value === '') {
      throw new Error(`${name} is not defined on :root`);
    }
    const probe = document.createElement('div');
    probe.style.backgroundColor = value;
    probe.hidden = true;
    document.body.append(probe);
    try {
      return getComputedStyle(probe).backgroundColor;
    } finally {
      probe.remove();
    }
  }, token);
}

/**
 * Asserts the applied theme: `<html data-theme>`, native controls (`color-scheme`) and
 * the page background, which must be the one this theme resolves to on the live page
 * and different from the other theme's.
 */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const backgrounds = await measureThemeBackgrounds(page);
  expect(backgrounds[theme], `${theme} background is painted`).not.toMatch(TRANSPARENT);
  expect(backgrounds.dark, 'dark and light backgrounds differ').not.toBe(backgrounds.light);
  await expect
    .poll(() => bodyBackground(page), {
      message: `body background should be the ${theme} theme background`,
    })
    .toBe(backgrounds[theme]);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), {
      message: `native controls should use the ${theme} color scheme`,
    })
    .toBe(theme);
}

const SCHEME_CHANGES = '__loanlogicE2eSchemeChanges';
const SCHEME_QUERY = '__loanlogicE2eSchemeQuery';

/**
 * Emulates the operating system's color scheme and, if that changes what
 * `(prefers-color-scheme: light)` matches, waits until the page has dispatched the
 * `change` event. The app's media query list is older than the one created here, so its
 * listener has run by then and assertions about "not following" are meaningful.
 */
export async function setSystemScheme(page: Page, scheme: Theme): Promise<void> {
  const before = await page.evaluate(
    ({ counter, holder }) => {
      if (typeof Reflect.get(window, counter) !== 'number') {
        const query = window.matchMedia('(prefers-color-scheme: light)');
        Reflect.set(window, counter, 0);
        // Keep the list alive: a collected MediaQueryList stops dispatching events.
        Reflect.set(window, holder, query);
        query.addEventListener('change', () => {
          Reflect.set(window, counter, Number(Reflect.get(window, counter)) + 1);
        });
      }
      return {
        light: window.matchMedia('(prefers-color-scheme: light)').matches,
        changes: Number(Reflect.get(window, counter)),
      };
    },
    { counter: SCHEME_CHANGES, holder: SCHEME_QUERY },
  );
  await page.emulateMedia({ colorScheme: scheme });
  if (before.light !== (scheme === 'light')) {
    await expect
      .poll(
        () => page.evaluate((counter) => Number(Reflect.get(window, counter)), SCHEME_CHANGES),
        {
          message: `the page should observe the system switching to ${scheme}`,
        },
      )
      .toBeGreaterThan(before.changes);
  }
}

/** Keys that move keyboard focus forward. */
export type TabKey = 'Tab' | 'Alt+Tab';

/**
 * Explains why link focus order cannot be tested where `linkTabKey` finds no key.
 */
export const NO_LINK_TAB_REASON =
  'This browser build never moves keyboard focus to links with Tab or Alt+Tab ' +
  '(Playwright WebKit on Windows); link stops are covered by Chromium and by WebKit on ' +
  'Linux (CI) and macOS.';

/**
 * The key that moves focus to the next element with links included, or `undefined` if no
 * key does. Chromium and WebKit on Linux include links on plain Tab; WebKit on macOS
 * skips links (and other non-text controls) on plain Tab, as Safari does unless "Press
 * Tab to highlight each item" is on, and includes them with Option (Alt) + Tab; WebKit on
 * Windows skips links with either key. Probed on a scratch page in the same context, so
 * the answer matches the engine and platform under test.
 */
export async function linkTabKey(page: Page): Promise<TabKey | undefined> {
  const probe = await page.context().newPage();
  try {
    const reachesLink = async (key: TabKey): Promise<boolean> => {
      await probe.setContent('<a href="#first">first</a> <button type="button">second</button>');
      await probe.keyboard.press(key);
      return probe.evaluate(() => document.activeElement?.tagName === 'A');
    };
    for (const key of ['Tab', 'Alt+Tab'] as const) {
      if (await reachesLink(key)) {
        return key;
      }
    }
    return undefined;
  } finally {
    await probe.close();
  }
}
