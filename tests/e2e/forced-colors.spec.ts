// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator } from '@playwright/test';
import {
  gotoApp,
  languageSelect,
  menuButton,
  openMenuSheet,
  openThemeMenu,
  themeButton,
  themeRadio,
} from './helpers.ts';

// Windows contrast themes (forced colors) drop author backgrounds, box-shadows and
// background images. Only Chromium emulates forced colors.
test.use({ locale: 'en-US', forcedColors: 'active', reducedMotion: 'reduce' });

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium emulates forced-colors mode');
});

/** Whether the element draws a visible (non-transparent, non-zero) top border. */
async function hasBorder(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      style.borderTopStyle !== 'none' &&
      Number.parseFloat(style.borderTopWidth) > 0 &&
      !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.borderTopColor)
    );
  });
}

/** Whether a radio is drawn by the platform, so its checked state survives forced colors. */
async function isNativeRadio(locator: Locator): Promise<boolean> {
  return locator.evaluate((radio) => getComputedStyle(radio).appearance !== 'none');
}

test.describe('forced colors at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the theme button and its menu keep their borders and the checked radio', async ({
    page,
  }) => {
    await gotoApp(page);
    expect(await hasBorder(themeButton(page)), 'theme button border').toBe(true);
    const group = await openThemeMenu(page);
    await themeRadio(page, 'dark').check();
    const panel = page.locator('.theme-menu__panel');
    expect(await hasBorder(panel), 'theme menu panel border').toBe(true);
    await expect(themeRadio(page, 'dark')).toBeChecked();
    for (const radio of await group.getByRole('radio').all()) {
      expect(await isNativeRadio(radio), 'theme radios are native').toBe(true);
    }
  });

  test('the language select keeps a native dropdown arrow and its border', async ({ page }) => {
    await gotoApp(page);
    const select = languageSelect(page, 'en');
    const appearance = await select.evaluate((element) => getComputedStyle(element).appearance);
    expect(appearance).not.toBe('none');
    expect(await hasBorder(select), 'language pill border').toBe(true);
  });

  test('the page glow is not painted', async ({ page }) => {
    await gotoApp(page);
    const image = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
    expect(image).toBe('none');
  });
});

test.describe('forced colors at 360px', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('the menu sheet keeps its border and the checked theme radio', async ({ page }) => {
    await gotoApp(page);
    expect(await hasBorder(menuButton(page)), 'menu button border').toBe(true);
    const sheet = await openMenuSheet(page);
    expect(await hasBorder(sheet), 'menu sheet border').toBe(true);
    const light = themeRadio(page, 'light');
    await light.check();
    await expect(light).toBeChecked();
    expect(await isNativeRadio(light), 'theme radios are native').toBe(true);
    const select = sheet.locator(languageSelect(page, 'en'));
    await expect(select).toBeVisible();
    expect(await select.evaluate((element) => getComputedStyle(element).appearance)).not.toBe(
      'none',
    );
  });
});
