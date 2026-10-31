// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  chooseTheme,
  gotoApp,
  languageSelect,
  menuButton,
  openMenuSheet,
  openThemeMenu,
  themeButton,
  themeItem,
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

/** Whether the element draws a visible (non-transparent, non-zero) outline. */
async function hasOutline(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      style.outlineStyle !== 'none' &&
      Number.parseFloat(style.outlineWidth) > 0 &&
      !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.outlineColor)
    );
  });
}

/** A system color keyword as the browser resolves it in the current (forced) palette. */
async function systemColor(page: Page, keyword: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    // Keep the keyword itself rather than the color forced colors would substitute.
    probe.style.forcedColorAdjust = 'none';
    probe.style.backgroundColor = name;
    document.body.append(probe);
    try {
      return getComputedStyle(probe).backgroundColor;
    } finally {
      probe.remove();
    }
  }, keyword);
}

/** The computed background and text colors of an element. */
async function colors(locator: Locator): Promise<{ background: string; text: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: style.color };
  });
}

/** Whether a theme menu item shows a check mark with a painted stroke. */
async function isVisibleCheckMark(item: Locator): Promise<boolean> {
  return item.evaluate((element) => {
    const mark = element.querySelector('.theme-menu__check svg');
    if (mark === null) {
      return false;
    }
    const box = mark.getBoundingClientRect();
    const style = getComputedStyle(mark);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.stroke !== 'none' &&
      !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.stroke)
    );
  });
}

test.describe('forced colors at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the theme button and its menu keep their borders, focus and the checked item', async ({
    page,
  }) => {
    await gotoApp(page);
    expect(await hasBorder(themeButton(page)), 'theme button border').toBe(true);
    await chooseTheme(page, 'dark');
    const menu = await openThemeMenu(page);
    expect(await hasBorder(menu), 'theme menu border').toBe(true);

    const highlight = await systemColor(page, 'Highlight');
    const highlightText = await systemColor(page, 'HighlightText');
    const dark = themeItem(page, 'dark');
    await expect(dark).toBeChecked();
    expect(await colors(dark), 'the checked item is drawn in Highlight').toEqual({
      background: highlight,
      text: highlightText,
    });
    expect(await isVisibleCheckMark(dark), 'the checked item shows its check mark').toBe(true);
    for (const preference of ['system', 'light'] as const) {
      const item = themeItem(page, preference);
      expect((await colors(item)).background, `${preference} is not highlighted`).not.toBe(
        highlight,
      );
      expect(await isVisibleCheckMark(item), `${preference} has no check mark`).toBe(false);
    }

    // The keyboard focus ring survives too, on the checked item and on the others.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(dark).toBeFocused();
    expect(await hasOutline(dark), 'focus ring on the checked item').toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(themeItem(page, 'light')).toBeFocused();
    expect(await hasOutline(themeItem(page, 'light')), 'focus ring on an item').toBe(true);
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
