// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectTheme,
  gotoApp,
  LANGUAGES,
  languageSelect,
  menuButton,
  message,
  openMenuSheet,
  panels,
  seedStorage,
  themeButton,
  themeGroup,
  THEMES,
  type Language,
} from './helpers.ts';

// Sub-pixel tolerance for layout comparisons.
const EPSILON = 1;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The element's bounding box in CSS pixels, relative to the viewport. Fails the test if the
 * element is not visible; the zero box after that check only satisfies the type checker.
 */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'element should be rendered').not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Width of the layout viewport without any classic scrollbar. */
async function viewportWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.clientWidth);
}

/**
 * Visible elements inside `root` (a CSS selector, the whole body by default) that stick out
 * of the viewport horizontally, described for a message.
 */
async function overflowingElements(page: Page, root = 'body'): Promise<string[]> {
  return page.evaluate(
    ({ epsilon, selector }) => {
      const limit = document.documentElement.clientWidth;
      const offenders: string[] = [];
      for (const element of document.querySelector(selector)?.querySelectorAll('*') ?? []) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        if (rect.left < -epsilon || rect.right > limit + epsilon) {
          const classes = element.getAttribute('class') ?? '';
          const name = `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes.trim().split(/\s+/).join('.')}`}`;
          offenders.push(
            `${name} [${String(Math.round(rect.left))}, ${String(Math.round(rect.right))}]`,
          );
        }
      }
      return offenders;
    },
    { epsilon: EPSILON, selector: root },
  );
}

/**
 * Asserts that the document is no wider than the layout viewport and cannot be scrolled
 * sideways; `state` names what is open, for the failure messages.
 */
async function expectNoHorizontalScroll(page: Page, state: string): Promise<void> {
  const scroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(scroll.clientWidth, `layout viewport width (${state})`).toBeGreaterThan(0);
  expect(scroll.scrollWidth, `document scroll width (${state})`).toBeLessThanOrEqual(
    scroll.clientWidth,
  );
  expect(scroll.bodyScrollWidth, `body scroll width (${state})`).toBeLessThanOrEqual(
    scroll.clientWidth,
  );

  // The page cannot actually be scrolled sideways; the vertical position is kept.
  const scrolledX = await page.evaluate(() => {
    const top = window.scrollY;
    window.scrollTo({ left: 200, top, behavior: 'instant' });
    const x = window.scrollX;
    window.scrollTo({ left: 0, top, behavior: 'instant' });
    return x;
  });
  expect(scrolledX, `horizontal scroll offset after scrolling right (${state})`).toBe(0);
}

/**
 * Asserts that the element's left and right edges lie within the layout viewport, within
 * `EPSILON`; only the horizontal axis is checked. `name` labels the failure messages.
 */
async function expectInsideViewport(page: Page, name: string, locator: Locator): Promise<void> {
  const width = await viewportWidth(page);
  const box = await boxOf(locator);
  expect(box.x, `${name}: left edge`).toBeGreaterThanOrEqual(-EPSILON);
  expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(width + EPSILON);
}

/**
 * Asserts the one-column layout: the results panel starts below the parameters panel and
 * both share the left edge and width, within `EPSILON`. `language` is the UI language the
 * panel names are in.
 */
async function expectStacked(page: Page, language: Language): Promise<void> {
  const { parameters, results } = panels(page, language);
  const top = await boxOf(parameters);
  const bottom = await boxOf(results);
  expect(bottom.y, 'results start below parameters').toBeGreaterThanOrEqual(
    top.y + top.height - EPSILON,
  );
  expect(Math.abs(top.x - bottom.x), 'panels share the left edge').toBeLessThanOrEqual(EPSILON);
  expect(Math.abs(top.width - bottom.width), 'panels share the width').toBeLessThanOrEqual(EPSILON);
}

/**
 * The parts of the phone layout as [description, locator] pairs, for per-part layout
 * checks: the header and its menu button, both panels and the footer; `language` is the UI
 * language the accessible names are in.
 */
function shellParts(page: Page, language: Language): [string, Locator][] {
  const { parameters, results } = panels(page, language);
  return [
    ['header', page.getByRole('banner')],
    ['menu button', menuButton(page, language)],
    ['parameters panel', parameters],
    ['results panel', results],
    ['footer', page.getByRole('contentinfo')],
  ];
}

test.describe('narrow screens (360 × 740)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const language of LANGUAGES) {
    for (const theme of THEMES) {
      test.describe(`${language}, ${theme} theme`, () => {
        test.use({ locale: 'en-US', colorScheme: theme });

        test('has no horizontal scroll and nothing overflows', async ({ page }) => {
          await seedStorage(page, { language, theme });
          await gotoApp(page);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expectTheme(page, theme);

          await expectNoHorizontalScroll(page, 'closed');

          for (const [name, locator] of shellParts(page, language)) {
            await expectInsideViewport(page, name, locator);
          }
          expect(await overflowingElements(page), 'elements wider than the viewport').toEqual([]);

          // The phone header shows the menu button instead of the desktop settings.
          await expect(themeButton(page, language)).toBeHidden();
          await expect(
            page.getByRole('banner').getByText(message(language, 'header.byline')),
          ).toBeHidden();

          await expectStacked(page, language);

          // The menu sheet and its controls fit as well.
          const sheet = await openMenuSheet(page, language);
          for (const [name, locator] of [
            ['menu sheet', sheet],
            ['language select', languageSelect(page, language)],
            ['theme radios', themeGroup(page, language)],
          ] as const) {
            await expectInsideViewport(page, name, locator);
          }
          expect(
            await overflowingElements(page),
            'elements wider than the viewport with the menu open',
          ).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(sheet).toBeHidden();

          // The fee editor and Advanced, behind "Fees and advanced settings" on a phone.
          for (const id of ['more-button', 'advanced-button']) {
            const button = page.locator(`#${id}`);
            await button.click();
            await expect(button).toHaveAttribute('aria-expanded', 'true');
          }
          await expect(page.locator('#advanced-content')).toBeVisible();
          await expectNoHorizontalScroll(page, 'with Advanced open');
          expect(
            await overflowingElements(page),
            'elements wider than the viewport with Advanced open',
          ).toEqual([]);

          // A periodic fee shows the most controls (calculation of three, per-period hint).
          await page
            .getByRole('button', { name: message(language, 'fees.addLabel'), exact: true })
            .click();
          const fee = page.locator('.fees__list > li').last();
          await fee.locator('select[id$="-kind"]').selectOption('periodic');
          await fee.locator('select[id$="-calc"]').selectOption('pct-balance');
          await fee.locator('input[id$="-value"]').fill('1');
          await expect(fee.locator('.fee__summary')).toBeVisible();
          await expectNoHorizontalScroll(page, 'with a periodic fee');
          expect(
            await overflowingElements(page),
            'elements wider than the viewport with a periodic fee',
          ).toEqual([]);
        });
      });
    }
  }
});

test.describe('desktop header (1024 × 768)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, colorScheme: 'dark' });

  for (const language of LANGUAGES) {
    test.describe(language, () => {
      test.use({ locale: 'en-US' });

      test('fits the wordmark, byline, language pill and theme button', async ({ page }) => {
        await seedStorage(page, { language });
        await gotoApp(page);
        await expect(menuButton(page, language)).toBeHidden();
        const settings = page.getByRole('group', {
          name: message(language, 'header.settings'),
          exact: true,
        });
        for (const [name, locator] of [
          ['header settings', settings],
          ['language select', languageSelect(page, language)],
          ['theme button', themeButton(page, language)],
        ] as const) {
          await expect(locator).toBeVisible();
          await expectInsideViewport(page, name, locator);
        }
        // Only the header: a wide schedule table scrolls inside its own card at 1024 px.
        expect(await overflowingElements(page, 'header'), 'header overflow').toEqual([]);
        // Pills and icon buttons are 44 px targets (DESIGN §8.1, §11).
        for (const locator of [languageSelect(page, language), themeButton(page, language)]) {
          expect((await boxOf(locator)).height).toBeGreaterThanOrEqual(44 - EPSILON);
        }

        // The open theme menu stays inside the viewport too.
        await themeButton(page, language).click();
        await expectInsideViewport(page, 'theme menu', themeGroup(page, language));
        expect(await overflowingElements(page, 'header'), 'overflow with the menu open').toEqual(
          [],
        );
      });
    });
  }
});

test.describe('workspace columns', () => {
  test.use({ locale: 'en-US', colorScheme: 'dark' });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test.describe(`${String(viewport.width)} × ${String(viewport.height)}`, () => {
      test.use({ viewport });

      test('shows the panels side by side', async ({ page }) => {
        await gotoApp(page);
        const { parameters, results } = panels(page);
        const left = await boxOf(parameters);
        const right = await boxOf(results);
        expect(Math.abs(left.y - right.y), 'panels share the same top edge').toBeLessThanOrEqual(
          EPSILON,
        );
        expect(left.x + left.width, 'parameters sit left of results').toBeLessThanOrEqual(
          right.x + EPSILON,
        );
        expect(right.x + right.width, 'results stay inside the viewport').toBeLessThanOrEqual(
          (await viewportWidth(page)) + EPSILON,
        );
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(await viewportWidth(page));
      });
    });
  }

  for (const viewport of [
    { width: 1023, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    test.describe(`${String(viewport.width)} × ${String(viewport.height)}`, () => {
      test.use({ viewport });

      test('stacks results below parameters', async ({ page }) => {
        await gotoApp(page);
        await expectStacked(page, 'en');
      });
    });
  }

  test.describe('resizing across the breakpoint', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('switches between columns and a stack without a reload', async ({ page }) => {
      await gotoApp(page);
      const { parameters, results } = panels(page);
      /** Whether the panels form two columns: same top edge, parameters left of results. */
      const sideBySide = async (): Promise<boolean> => {
        const left = await boxOf(parameters);
        const right = await boxOf(results);
        return Math.abs(left.y - right.y) <= EPSILON && left.x + left.width <= right.x + EPSILON;
      };
      expect(await sideBySide()).toBe(true);

      await page.setViewportSize({ width: 800, height: 800 });
      await expect.poll(sideBySide, { message: 'panels stack below 1024 px' }).toBe(false);
      await expectStacked(page, 'en');

      await page.setViewportSize({ width: 1024, height: 800 });
      await expect.poll(sideBySide, { message: 'panels sit side by side at 1024 px' }).toBe(true);
    });
  });
});

test.describe('segmented controls', () => {
  for (const width of [360, 1280]) {
    test(`every segment is a 44 px target at ${String(width)} px (DESIGN §11)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page);
      const segments = page.locator('.segmented__option:has(input[name="frequency"])');
      await expect(segments).toHaveCount(6);
      for (const segment of await segments.all()) {
        expect((await boxOf(segment)).height).toBeGreaterThanOrEqual(44 - EPSILON);
      }
    });
  }
});

test.describe('sticky inputs panel (1280 × 800)', () => {
  test.use({ locale: 'en-US', colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

  test('sticks to the top and scrolls on its own', async ({ page }) => {
    await gotoApp(page);
    const style = await page.locator('.inputs').evaluate((element) => {
      const computed = getComputedStyle(element);
      return { position: computed.position, overflowY: computed.overflowY };
    });
    expect(style).toEqual({ position: 'sticky', overflowY: 'auto' });
  });
});

test.describe('compact bar on a phone (360 × 740)', () => {
  test.use({ locale: 'en-US', colorScheme: 'dark', viewport: { width: 360, height: 740 } });

  test('appears once the summary card scrolls away and never covers a focused field', async ({
    page,
  }) => {
    await gotoApp(page);
    const bar = page.getByRole('region', {
      name: message('en', 'results.compactBar'),
      exact: true,
    });
    await expect(page.locator('.mobile-summary')).toBeInViewport();
    await expect(bar).toBeHidden();

    // Far down the page (the schedule), the summary card and the inputs are above it.
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await expect(bar).toBeVisible();
    const barBox = await boxOf(bar);
    expect(barBox.y, 'the bar is at the top of the viewport').toBeLessThanOrEqual(EPSILON);
    const amount = page.locator('#field-amount');
    await expect(amount).not.toBeInViewport();

    // Focusing scrolls the field back into view below the bar (scroll padding).
    await amount.focus();
    await expect(amount).toBeFocused();
    await expect(amount).toBeInViewport();
    const fieldTop = (await boxOf(amount)).y;
    expect(fieldTop, 'focused field top vs. compact bar bottom').toBeGreaterThanOrEqual(
      barBox.y + barBox.height - EPSILON,
    );
  });
});
