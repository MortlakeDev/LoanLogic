// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import { LICENSE_ID } from '../../src/config.ts';
import {
  expectTheme,
  gotoApp,
  languageSelect,
  linkTabKey,
  message,
  NO_LINK_TAB_REASON,
  readStorage,
  STORAGE_KEYS,
  themeGroup,
  themeRadio,
  type TabKey,
} from './helpers.ts';

// A light system scheme makes arrow-key changes to Dark visible.
test.use({ locale: 'en-US', colorScheme: 'light' });

/**
 * Describes what is missing from the focus ring of a focused element (empty when a ring
 * is drawn). A transparent native control (the radio inputs of the segmented theme
 * switcher) draws its ring on the face right after it. Checks the drawn ring rather than
 * `:focus-visible`, because what users need is the ring, whatever selector draws it.
 */
async function focusRingProblems(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const transparent = getComputedStyle(element).opacity === '0';
    const target = transparent ? (element.nextElementSibling ?? element) : element;
    const style = getComputedStyle(target);
    const problems: string[] = [];
    if (style.outlineStyle === 'none') {
      problems.push('outline-style is none');
    }
    if (!(Number.parseFloat(style.outlineWidth) > 0)) {
      problems.push(`outline-width is ${style.outlineWidth}`);
    }
    if (/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.outlineColor)) {
      problems.push('outline-color is transparent');
    }
    return problems;
  });
}

async function expectVisibleFocus(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name} should be focused`).toBeFocused();
  await expect
    .poll(() => focusRingProblems(locator), { message: `${name} should show a focus ring` })
    .toEqual([]);
}

function skipLink(page: Page): Locator {
  return page.getByRole('link', { name: message('en', 'a11y.skipToContent'), exact: true });
}

function footerLinks(page: Page): { license: Locator; source: Locator } {
  const footer = page.getByRole('contentinfo');
  const newTab = message('en', 'footer.opensInNewTab');
  return {
    license: footer.getByRole('link', { name: `${LICENSE_ID} ${newTab}`, exact: true }),
    source: footer.getByRole('link', {
      name: `${message('en', 'footer.sourceCode')} ${newTab}`,
      exact: true,
    }),
  };
}

/**
 * Tabs from the top of the page to the theme group: past the skip link (where links take
 * focus) and the language select. The exact order is asserted by the tab order test.
 */
async function tabToThemeGroup(page: Page, linkKey: TabKey | undefined): Promise<void> {
  const stops = linkKey === undefined ? 2 : 3;
  for (let stop = 0; stop < stops; stop += 1) {
    await page.keyboard.press(linkKey ?? 'Tab');
  }
}

test.describe('keyboard navigation', () => {
  test('the skip link comes first, is visible when focused and jumps to main', async ({ page }) => {
    const tab = await linkTabKey(page);
    test.skip(tab === undefined, NO_LINK_TAB_REASON);
    if (tab === undefined) {
      return;
    }
    await gotoApp(page);
    const link = skipLink(page);
    await expect(link).not.toBeInViewport();

    await page.keyboard.press(tab);
    await expectVisibleFocus(link, 'skip link');
    await expect(link).toBeInViewport({ ratio: 1 });

    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await expect(page).toHaveURL(/#main$/);

    // The skip link bypasses the header controls: the next stop is in the footer.
    await page.keyboard.press(tab);
    await expectVisibleFocus(footerLinks(page).license, 'license link');
  });

  test('tab order runs through the header controls to the footer', async ({ page }) => {
    const tab = await linkTabKey(page);
    test.skip(tab === undefined, NO_LINK_TAB_REASON);
    if (tab === undefined) {
      return;
    }
    await gotoApp(page);
    const { license, source } = footerLinks(page);
    const stops: [string, Locator][] = [
      ['skip link', skipLink(page)],
      ['language select', languageSelect(page, 'en')],
      ['theme radio group (checked option)', themeRadio(page, 'system')],
      ['license link', license],
      ['source code link', source],
    ];
    for (const [name, locator] of stops) {
      await page.keyboard.press(tab);
      await expectVisibleFocus(locator, name);
    }

    // And back again.
    for (const [name, locator] of stops.slice(0, -1).reverse()) {
      await page.keyboard.press(`Shift+${tab}`);
      await expectVisibleFocus(locator, name);
    }
  });

  test('the header controls are reachable even where links are not', async ({ page }) => {
    const linkKey = await linkTabKey(page);
    // Where no key reaches links (the skip link included), form controls still take Tab.
    const tab = linkKey ?? 'Tab';
    await gotoApp(page);
    if (linkKey !== undefined) {
      await page.keyboard.press(tab);
      await expect(skipLink(page)).toBeFocused();
    }
    await page.keyboard.press(tab);
    await expectVisibleFocus(languageSelect(page, 'en'), 'language select');
    await page.keyboard.press(tab);
    await expectVisibleFocus(themeRadio(page, 'system'), 'System radio');
  });

  test('arrow keys change the theme', async ({ page }) => {
    const linkKey = await linkTabKey(page);
    const tab = linkKey ?? 'Tab';
    await gotoApp(page);
    await expectTheme(page, 'light');
    await tabToThemeGroup(page, linkKey);
    await expect(themeRadio(page, 'system')).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(themeRadio(page, 'dark')).toBeChecked();
    await expect(themeRadio(page, 'dark')).toBeFocused();
    await expectTheme(page, 'dark');

    await page.keyboard.press('ArrowRight');
    await expect(themeRadio(page, 'light')).toBeChecked();
    await expect(themeRadio(page, 'light')).toBeFocused();
    await expectTheme(page, 'light');
    expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify('light'));

    await page.keyboard.press('ArrowLeft');
    await expect(themeRadio(page, 'dark')).toBeChecked();
    await expectTheme(page, 'dark');
    expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify('dark'));

    // Tab leaves the group in one step instead of visiting every option.
    await page.keyboard.press(tab);
    await expect
      .poll(() => themeGroup(page).evaluate((group) => group.contains(document.activeElement)), {
        message: 'focus should have left the theme group',
      })
      .toBe(false);
    if (linkKey !== undefined) {
      await expectVisibleFocus(footerLinks(page).license, 'license link');
    }
  });

  test('the focus ring follows arrow-key moves in the theme switcher', async ({ page }) => {
    const linkKey = await linkTabKey(page);
    await gotoApp(page);
    await tabToThemeGroup(page, linkKey);
    await expectVisibleFocus(themeRadio(page, 'system'), 'System radio');

    await page.keyboard.press('ArrowRight');
    await expectVisibleFocus(themeRadio(page, 'dark'), 'Dark radio after ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectVisibleFocus(themeRadio(page, 'light'), 'Light radio after ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expectVisibleFocus(themeRadio(page, 'dark'), 'Dark radio after ArrowLeft');
  });
});
