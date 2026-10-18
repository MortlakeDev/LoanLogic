// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Page } from '@playwright/test';
import {
  bodyBackground,
  expectTheme,
  gotoApp,
  hasReloadMarker,
  measureThemeBackgrounds,
  opposite,
  readStorage,
  resolveColorToken,
  seedStorage,
  setReloadMarker,
  setSystemScheme,
  STORAGE_KEYS,
  THEME_PREFERENCES,
  themeGroup,
  themeRadio,
  THEMES,
  type Theme,
} from './helpers.ts';

test.use({ locale: 'en-US' });

test.describe('theme switcher', () => {
  test('offers System, Dark and Light as radio buttons', async ({ page }) => {
    await gotoApp(page);
    await expect(themeGroup(page).getByRole('radio')).toHaveCount(THEME_PREFERENCES.length);
    for (const preference of THEME_PREFERENCES) {
      await expect(themeRadio(page, preference)).toBeVisible();
    }
    await expect(themeRadio(page, 'system')).toBeChecked();
    await expect(themeRadio(page, 'dark')).not.toBeChecked();
    await expect(themeRadio(page, 'light')).not.toBeChecked();
  });

  for (const theme of THEMES) {
    test.describe(`choosing ${theme}`, () => {
      // Emulate the other system scheme so the choice visibly overrides it.
      test.use({ colorScheme: opposite(theme) });

      test('applies immediately, persists and ignores the system scheme', async ({ page }) => {
        await gotoApp(page);
        await expectTheme(page, opposite(theme));
        await setReloadMarker(page);

        await themeRadio(page, theme).check();
        await expectTheme(page, theme);
        await expect(themeRadio(page, theme)).toBeChecked();
        await expect(themeRadio(page, 'system')).not.toBeChecked();
        expect(await hasReloadMarker(page), 'switching theme must not reload').toBe(true);
        expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify(theme));

        // A fixed choice does not follow the system any more, in either direction.
        await setSystemScheme(page, theme);
        await expectTheme(page, theme);
        await setSystemScheme(page, opposite(theme));
        await expectTheme(page, theme);

        await page.reload();
        await expectTheme(page, theme);
        await expect(themeRadio(page, theme)).toBeChecked();
      });
    });
  }
});

test.describe('System preference', () => {
  for (const scheme of THEMES) {
    test.describe(`with a ${scheme} system scheme`, () => {
      test.use({ colorScheme: scheme });

      test('is the default and follows the system', async ({ page }) => {
        await gotoApp(page);
        await expect(themeRadio(page, 'system')).toBeChecked();
        await expectTheme(page, scheme);
        expect(await readStorage(page, STORAGE_KEYS.theme)).toBeNull();
      });
    });
  }

  test.describe('live changes', () => {
    test.use({ colorScheme: 'light' });

    test('follows the system scheme live, without a reload', async ({ page }) => {
      await gotoApp(page);
      await expectTheme(page, 'light');
      await setReloadMarker(page);

      await setSystemScheme(page, 'dark');
      await expectTheme(page, 'dark');
      await setSystemScheme(page, 'light');
      await expectTheme(page, 'light');

      expect(await hasReloadMarker(page), 'the page must not reload').toBe(true);
      await expect(themeRadio(page, 'system')).toBeChecked();
    });

    test('returning to System follows the system again and persists', async ({ page }) => {
      await gotoApp(page);
      await themeRadio(page, 'dark').check();
      await expectTheme(page, 'dark');

      await themeRadio(page, 'system').check();
      await expectTheme(page, 'light');
      expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify('system'));

      await page.reload();
      await expect(themeRadio(page, 'system')).toBeChecked();
      await expectTheme(page, 'light');
      await setSystemScheme(page, 'dark');
      await expectTheme(page, 'dark');
    });
  });
});

test.describe('no flash of the wrong theme', () => {
  /**
   * Blocks the application bundle so only index.html (with its inline head script) and
   * the stylesheet load. Whatever theme is visible then was applied before the app ran.
   */
  async function openWithoutAppScript(page: Page): Promise<void> {
    const blocked: string[] = [];
    await page.route(/\/assets\/[^/?#]+\.js(?:[?#].*)?$/, async (route) => {
      blocked.push(route.request().url());
      await route.abort();
    });
    await page.goto('./');
    await expect
      .poll(() => blocked.length, {
        message: 'the application bundle should have been requested and blocked',
      })
      .toBeGreaterThan(0);
    await expect(page.locator('#app')).toBeEmpty();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  }

  /**
   * Asserts what the page shows before the app runs: `data-theme`, a background that is
   * the theme's `--color-bg` (not the other theme's), and the same background the app
   * paints for the same stored preference and system scheme (a second page, app on).
   */
  async function expectPaintedTheme(page: Page, theme: Theme): Promise<void> {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const painted = await bodyBackground(page);
    expect(painted, 'body background resolves --color-bg').toBe(
      await resolveColorToken(page, '--color-bg'),
    );
    const backgrounds = await measureThemeBackgrounds(page);
    expect(backgrounds.dark, 'dark and light backgrounds differ').not.toBe(backgrounds.light);
    expect(painted, `painted background is the ${theme} one`).toBe(backgrounds[theme]);

    // Storage is shared within the context, so the app sees the same preference.
    const reference = await page.context().newPage();
    try {
      await gotoApp(reference);
      await expectTheme(reference, theme);
      expect(painted, 'the background before the app runs is the one the app shows').toBe(
        await bodyBackground(reference),
      );
    } finally {
      await reference.close();
    }
  }

  for (const stored of THEMES) {
    test.describe(`stored ${stored} with a ${opposite(stored)} system`, () => {
      test.use({ colorScheme: opposite(stored) });

      test('is applied by the inline script before the app runs', async ({ page }) => {
        await seedStorage(page, { theme: stored });
        await openWithoutAppScript(page);
        await expectPaintedTheme(page, stored);
      });
    });
  }

  for (const scheme of THEMES) {
    test.describe(`no stored preference with a ${scheme} system`, () => {
      test.use({ colorScheme: scheme });

      test('follows the system before the app runs', async ({ page }) => {
        await openWithoutAppScript(page);
        await expectPaintedTheme(page, scheme);
      });
    });
  }

  test.describe('stored System with a light system', () => {
    test.use({ colorScheme: 'light' });

    test('resolves System before the app runs', async ({ page }) => {
      await seedStorage(page, { theme: 'system' });
      await openWithoutAppScript(page);
      await expectPaintedTheme(page, 'light');
    });
  });

  test.describe('corrupt stored value with a light system', () => {
    test.use({ colorScheme: 'light' });

    test('falls back to the system scheme', async ({ page }) => {
      await page.addInitScript((key: string) => {
        try {
          window.localStorage.setItem(key, '{not json');
        } catch {
          // Storage is unavailable in this document (e.g. about:blank).
        }
      }, STORAGE_KEYS.theme);
      await openWithoutAppScript(page);
      await expectPaintedTheme(page, 'light');
    });
  });
});
