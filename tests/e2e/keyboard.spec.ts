// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import { LICENSE_ID } from '../../src/config.ts';
import {
  expectTheme,
  gotoApp,
  languageSelect,
  linkTabKey,
  menuButton,
  menuSheet,
  message,
  NO_LINK_TAB_REASON,
  readStorage,
  STORAGE_KEYS,
  themeButton,
  themeGroup,
  themeRadio,
  type TabKey,
} from './helpers.ts';

// A light system scheme makes arrow-key changes to Dark visible.
test.use({ locale: 'en-US', colorScheme: 'light' });

/**
 * Describes what is missing from the focus ring of a focused element (empty when a ring
 * is drawn). A theme radio draws its ring on the option row (the label around it), which
 * is the visible target. Checks the drawn ring rather than `:focus-visible`, because what
 * users need is the ring, whatever selector draws it.
 */
async function focusRingProblems(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const target =
      element instanceof HTMLInputElement && element.type === 'radio'
        ? (element.closest('label') ?? element)
        : element;
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

/**
 * Asserts that the element has focus and draws a visible focus ring (see
 * `focusRingProblems`), retrying both checks until they pass or time out; `name` labels the
 * failure messages.
 */
async function expectVisibleFocus(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name} should be focused`).toBeFocused();
  await expect
    .poll(() => focusRingProblems(locator), { message: `${name} should show a focus ring` })
    .toEqual([]);
}

/** Whether keyboard focus is inside `<main>` (but not on `<main>` itself). */
async function focusIsInMain(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const active = document.activeElement;
    return main !== null && active !== main && main.contains(active);
  });
}

/** The skip link to `<main>`, by its English accessible name. */
function skipLink(page: Page): Locator {
  return page.getByRole('link', { name: message('en', 'a11y.skipToContent'), exact: true });
}

/**
 * The footer's license and source code links, by their English accessible names: the link
 * text plus the visually hidden "opens in a new tab" note.
 */
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
 * Tabs from the top of the page to the theme button: past the skip link (where links take
 * focus) and the language select. The exact order is asserted by the tab order test.
 */
async function tabToThemeButton(page: Page, linkKey: TabKey | undefined): Promise<void> {
  const stops = linkKey === undefined ? 2 : 3;
  for (let stop = 0; stop < stops; stop += 1) {
    await page.keyboard.press(linkKey ?? 'Tab');
  }
  await expect(themeButton(page)).toBeFocused();
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

    // The skip link bypasses the header controls: the next stop is inside main.
    await page.keyboard.press(tab);
    await expect.poll(() => focusIsInMain(page), { message: 'focus should be in main' }).toBe(true);
  });

  test('tab order runs through the header controls into main', async ({ page }) => {
    const tab = await linkTabKey(page);
    test.skip(tab === undefined, NO_LINK_TAB_REASON);
    if (tab === undefined) {
      return;
    }
    await gotoApp(page);
    const stops: [string, Locator][] = [
      ['skip link', skipLink(page)],
      ['language select', languageSelect(page, 'en')],
      ['theme button', themeButton(page)],
    ];
    for (const [name, locator] of stops) {
      await page.keyboard.press(tab);
      await expectVisibleFocus(locator, name);
    }
    // The closed theme menu has no tab stops: the next one is in main.
    await page.keyboard.press(tab);
    await expect.poll(() => focusIsInMain(page), { message: 'focus should be in main' }).toBe(true);

    // And back again.
    for (const [name, locator] of stops.slice().reverse()) {
      await page.keyboard.press(`Shift+${tab}`);
      await expectVisibleFocus(locator, name);
    }
  });

  test('the footer links are consecutive tab stops with a focus ring', async ({ page }) => {
    const tab = await linkTabKey(page);
    test.skip(tab === undefined, NO_LINK_TAB_REASON);
    if (tab === undefined) {
      return;
    }
    await gotoApp(page);
    const { license, source } = footerLinks(page);
    await source.focus();
    await page.keyboard.press(`Shift+${tab}`);
    await expectVisibleFocus(license, 'license link');
    await page.keyboard.press(tab);
    await expectVisibleFocus(source, 'source code link');
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
    await expectVisibleFocus(themeButton(page), 'theme button');
  });

  test('the theme menu opens from the keyboard, arrow keys change the theme, Esc closes it', async ({
    page,
  }) => {
    const linkKey = await linkTabKey(page);
    await gotoApp(page);
    await expectTheme(page, 'light');
    await tabToThemeButton(page, linkKey);
    const button = themeButton(page);
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Opening moves focus to the checked option.
    await expectVisibleFocus(themeRadio(page, 'system'), 'System radio');

    await page.keyboard.press('ArrowDown');
    await expect(themeRadio(page, 'dark')).toBeChecked();
    await expect(themeRadio(page, 'dark')).toBeFocused();
    await expectTheme(page, 'dark');

    await page.keyboard.press('ArrowDown');
    await expect(themeRadio(page, 'light')).toBeChecked();
    await expectTheme(page, 'light');
    expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify('light'));

    await page.keyboard.press('ArrowUp');
    await expect(themeRadio(page, 'dark')).toBeChecked();
    await expectTheme(page, 'dark');
    expect(await readStorage(page, STORAGE_KEYS.theme)).toBe(JSON.stringify('dark'));

    // The menu stays open while browsing; Esc closes it and returns focus to the button.
    await expect(themeGroup(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(themeGroup(page)).toBeHidden();
    await expectVisibleFocus(button, 'theme button after Escape');
    await expectTheme(page, 'dark');
  });

  test('Tab leaves the open theme menu in one step and closes it', async ({ page }) => {
    const linkKey = await linkTabKey(page);
    await gotoApp(page);
    await tabToThemeButton(page, linkKey);
    await page.keyboard.press('Space');
    await expect(themeRadio(page, 'system')).toBeFocused();

    await page.keyboard.press(linkKey ?? 'Tab');
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(themeGroup(page)).toBeHidden();
    await expect.poll(() => focusIsInMain(page), { message: 'focus should be in main' }).toBe(true);
  });

  test('the focus ring follows arrow-key moves in the theme menu', async ({ page }) => {
    const linkKey = await linkTabKey(page);
    await gotoApp(page);
    await tabToThemeButton(page, linkKey);
    await page.keyboard.press('Enter');
    await expectVisibleFocus(themeRadio(page, 'system'), 'System radio');

    await page.keyboard.press('ArrowRight');
    await expectVisibleFocus(themeRadio(page, 'dark'), 'Dark radio after ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectVisibleFocus(themeRadio(page, 'light'), 'Light radio after ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expectVisibleFocus(themeRadio(page, 'dark'), 'Dark radio after ArrowLeft');
  });
});

test.describe('keyboard navigation on a phone-sized screen', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the menu sheet traps focus, Esc closes it and focus returns to the menu button', async ({
    page,
  }) => {
    const linkKey = await linkTabKey(page);
    const tab = linkKey ?? 'Tab';
    await gotoApp(page);
    const button = menuButton(page);
    await button.focus();
    await page.keyboard.press('Enter');
    const sheet = menuSheet(page);
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', {
      name: message('en', 'header.closeMenu'),
      exact: true,
    });
    await expectVisibleFocus(close, 'close button');

    await page.keyboard.press(tab);
    await expectVisibleFocus(themeRadio(page, 'system'), 'System radio in the sheet');
    await page.keyboard.press(tab);
    await expectVisibleFocus(languageSelect(page, 'en'), 'language select in the sheet');
    // Last stop: Tab wraps around to the close button, and Shift+Tab back to the select.
    await page.keyboard.press(tab);
    await expectVisibleFocus(close, 'close button after wrapping');
    await page.keyboard.press(`Shift+${tab}`);
    await expectVisibleFocus(languageSelect(page, 'en'), 'language select after wrapping back');

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expectVisibleFocus(button, 'menu button after Escape');
  });
});
