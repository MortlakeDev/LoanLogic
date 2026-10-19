// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Page } from '@playwright/test';
import {
  gotoApp,
  hasReloadMarker,
  LANGUAGES,
  languageSelect,
  message,
  panels,
  readStorage,
  setReloadMarker,
  STORAGE_KEYS,
  THEME_PREFERENCES,
  themeRadio,
  type Language,
} from './helpers.ts';

test.use({ locale: 'en-US', colorScheme: 'dark' });

/** Asserts that the whole shell (document metadata and visible text) is in `language`. */
async function expectLanguage(page: Page, language: Language): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page).toHaveTitle(message(language, 'meta.title'));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    message(language, 'meta.description'),
  );
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    message(language, 'panels.parameters.title'),
    message(language, 'panels.results.title'),
  ]);
  const { parameters, results } = panels(page, language);
  await expect(parameters).toContainText(message(language, 'panels.parameters.emptyTitle'));
  await expect(results).toContainText(message(language, 'panels.results.emptyTitle'));
  await expect(page.getByRole('banner')).toContainText(message(language, 'header.byline'));
  await expect(
    page.getByRole('group', { name: message(language, 'header.settings'), exact: true }),
  ).toBeAttached();
  for (const preference of THEME_PREFERENCES) {
    await expect(themeRadio(page, preference, language)).toHaveCount(1);
  }
  await expect(
    page.getByRole('link', { name: message(language, 'a11y.skipToContent'), exact: true }),
  ).toBeAttached();
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText(message(language, 'footer.sourceCode'));
  await expect(footer).toContainText(message(language, 'footer.privacy'));
  await expect(footer).toContainText(message(language, 'footer.disclaimer'));
  await expect(languageSelect(page, language)).toHaveValue(language);
}

/**
 * Picks `to` in the language select and asserts the whole shell switched to it. `from` is
 * the current language, needed because the select's accessible name is translated.
 */
async function switchLanguage(page: Page, from: Language, to: Language): Promise<void> {
  await languageSelect(page, from).selectOption(to);
  await expectLanguage(page, to);
}

test.describe('language switcher', () => {
  test('offers every language under its own name', async ({ page }) => {
    await gotoApp(page);
    const options = languageSelect(page, 'en').getByRole('option');
    // Endonyms are data, not translations: the same in every UI language.
    await expect(options).toHaveText(['English', '简体中文', 'Русский', 'Українська']);
    for (const [index, language] of LANGUAGES.entries()) {
      await expect(options.nth(index)).toHaveAttribute('value', language);
      await expect(options.nth(index)).toHaveAttribute('lang', language);
    }
  });

  test('switches through every language instantly, without a reload', async ({ page }) => {
    await gotoApp(page);
    await expectLanguage(page, 'en');
    await setReloadMarker(page);

    let current: Language = 'en';
    for (const next of [...LANGUAGES.filter((language) => language !== 'en'), 'en'] as const) {
      await switchLanguage(page, current, next);
      expect(await hasReloadMarker(page), `switching to ${next} must not reload`).toBe(true);
      current = next;
    }
  });

  test('arrow keys on the closed select browse without switching until focus leaves', async ({
    page,
    browserName,
  }) => {
    // How a closed native select reacts to arrow keys is platform UI (macOS opens the list);
    // Chromium on Windows and Linux changes the value in place, which is the case to cover.
    test.skip(browserName !== 'chromium', 'Closed-select arrow-key behaviour is platform UI');
    await gotoApp(page);
    const select = languageSelect(page, 'en');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(select).toHaveValue('ru');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await readStorage(page, STORAGE_KEYS.language)).toBeNull();

    await select.blur();
    await expectLanguage(page, 'ru');
    expect(await readStorage(page, STORAGE_KEYS.language)).toBe(JSON.stringify('ru'));
  });

  test('Enter applies the browsed language', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Closed-select arrow-key behaviour is platform UI');
    await gotoApp(page);
    const select = languageSelect(page, 'en');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expectLanguage(page, 'zh-CN');
  });

  for (const language of LANGUAGES) {
    test(`remembers ${language} across reloads`, async ({ page }) => {
      await gotoApp(page);
      let current: Language = 'en';
      if (language === 'en') {
        // Leave English first so choosing it is a real change that gets stored.
        await switchLanguage(page, 'en', 'uk');
        current = 'uk';
      }
      await switchLanguage(page, current, language);
      expect(await readStorage(page, STORAGE_KEYS.language)).toBe(JSON.stringify(language));

      await setReloadMarker(page);
      await page.reload();
      expect(await hasReloadMarker(page), 'the page should have reloaded').toBe(false);
      await expectLanguage(page, language);
    });
  }
});

test.describe('language detection', () => {
  const cases: readonly { readonly locale: string; readonly expected: Language }[] = [
    { locale: 'ru-RU', expected: 'ru' },
    { locale: 'uk-UA', expected: 'uk' },
    { locale: 'zh-CN', expected: 'zh-CN' },
    { locale: 'en-GB', expected: 'en' },
    // Traditional Chinese is not offered; it must not fall into Simplified Chinese.
    { locale: 'zh-TW', expected: 'en' },
    { locale: 'de-DE', expected: 'en' },
  ];

  for (const { locale, expected } of cases) {
    test.describe(`browser locale ${locale}`, () => {
      test.use({ locale });

      test(`starts in ${expected} when nothing is saved`, async ({ page }) => {
        await gotoApp(page);
        const preferred = await page.evaluate(() => [...navigator.languages]);
        await expect(
          page.locator('html'),
          `navigator.languages = ${JSON.stringify(preferred)}`,
        ).toHaveAttribute('lang', expected);
        await expectLanguage(page, expected);
      });
    });
  }

  test.describe('saved choice', () => {
    test.use({ locale: 'ru-RU' });

    test('wins over the browser language', async ({ page }) => {
      await gotoApp(page);
      await expectLanguage(page, 'ru');
      await switchLanguage(page, 'ru', 'en');
      expect(await readStorage(page, STORAGE_KEYS.language)).toBe(JSON.stringify('en'));
      await page.reload();
      await expectLanguage(page, 'en');
    });

    test('ignores an invalid saved value', async ({ page }) => {
      await page.addInitScript((key: string) => {
        try {
          window.localStorage.setItem(key, JSON.stringify('xx-XX'));
        } catch {
          // Storage is unavailable in this document (e.g. about:blank).
        }
      }, STORAGE_KEYS.language);
      await gotoApp(page);
      await expectLanguage(page, 'ru');
    });
  });
});
