// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectTheme,
  gotoApp,
  LANGUAGES,
  languageSelect,
  message,
  panels,
  seedStorage,
  THEME_PREFERENCES,
  themeGroup,
  themeRadio,
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

/** Visible elements that stick out of the viewport horizontally, described for a message. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate((epsilon) => {
    const limit = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
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
  }, EPSILON);
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
 * The header, its settings controls, both panels and the footer as [description, locator]
 * pairs, for per-part layout checks; `language` is the UI language the accessible names are
 * in.
 */
function shellParts(page: Page, language: Language): [string, Locator][] {
  const { parameters, results } = panels(page, language);
  return [
    ['header', page.getByRole('banner')],
    [
      'header settings',
      page.getByRole('group', { name: message(language, 'header.settings'), exact: true }),
    ],
    ['language select', languageSelect(page, language)],
    ['theme switcher', themeGroup(page, language)],
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

          const scroll = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
          }));
          expect(scroll.clientWidth, 'layout viewport width').toBeGreaterThan(0);
          expect(scroll.scrollWidth, 'document scroll width').toBeLessThanOrEqual(
            scroll.clientWidth,
          );
          expect(scroll.bodyScrollWidth, 'body scroll width').toBeLessThanOrEqual(
            scroll.clientWidth,
          );

          // The page cannot actually be scrolled sideways.
          const scrolledX = await page.evaluate(() => {
            window.scrollTo({ left: 200, top: 0, behavior: 'instant' });
            const x = window.scrollX;
            window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
            return x;
          });
          expect(scrolledX, 'horizontal scroll offset after scrolling right').toBe(0);

          for (const [name, locator] of shellParts(page, language)) {
            await expectInsideViewport(page, name, locator);
          }
          expect(await overflowingElements(page), 'elements wider than the viewport').toEqual([]);

          // Icon-only segments must keep their text as the accessible name.
          for (const preference of THEME_PREFERENCES) {
            await expect(themeRadio(page, preference, language)).toHaveCount(1);
          }

          await expectStacked(page, language);
        });
      });
    }
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
