// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  expectTheme,
  gotoApp,
  LANGUAGES,
  message,
  openMenuSheet,
  openThemeMenu,
  seedStorage,
  THEMES,
} from './helpers.ts';

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeViolation = AxeResults['violations'][number];

/** WCAG 2.2 AA, including the 2.0 and 2.1 A/AA rules it builds on. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Impacts that fail the build (T01 acceptance: no serious or critical violations). */
const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
] as const;

/**
 * Formats axe violations for a failure message or annotation: per rule its impact, id, help
 * text and URL, then the selector and failure summary of each failing node.
 */
function describeViolations(violations: readonly AxeViolation[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => {
          const summary = node.failureSummary?.replace(/\s+/g, ' ').trim() ?? '';
          return `    - ${node.target.join(' ')}${summary === '' ? '' : `: ${summary}`}`;
        })
        .join('\n');
      return `[${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * Scans the current page with axe's WCAG 2.2 AA rules and fails on any serious or critical
 * violation; moderate and minor ones are attached to the test as an annotation instead.
 * Also fails if the contrast, title, lang or select-name rules were not evaluated, as on a
 * page that has not rendered.
 */
async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ''),
  );
  const minor = results.violations.filter((violation) => !blocking.includes(violation));
  if (minor.length > 0) {
    test.info().annotations.push({
      type: 'axe (moderate/minor)',
      description: describeViolations(minor),
    });
  }
  expect(
    blocking,
    `axe found serious/critical violations:\n\n${describeViolations(blocking)}`,
  ).toEqual([]);
  // Guards against a scan of an empty page: contrast and naming rules must have run.
  const evaluated = new Set(
    [...results.passes, ...results.violations, ...results.incomplete].map((rule) => rule.id),
  );
  for (const rule of ['color-contrast', 'document-title', 'html-has-lang', 'select-name']) {
    expect(evaluated, `axe should have evaluated "${rule}"`).toContain(rule);
  }
}

/** Longest transition or animation duration (seconds) of any element or pseudo-element. */
async function longestMotion(page: Page): Promise<number> {
  return page.evaluate(() => {
    /**
     * Longest entry of a computed duration list such as "0.2s, 150ms", in seconds;
     * unparsable entries count as 0.
     */
    const seconds = (list: string): number =>
      Math.max(
        0,
        ...list.split(',').map((item) => {
          const value = item.trim();
          const amount = Number.parseFloat(value);
          if (!Number.isFinite(amount)) {
            return 0;
          }
          return value.endsWith('ms') ? amount / 1000 : amount;
        }),
      );
    let longest = 0;
    for (const element of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        longest = Math.max(
          longest,
          seconds(style.transitionDuration),
          seconds(style.animationDuration),
        );
      }
    }
    return longest;
  });
}

for (const language of LANGUAGES) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test.describe(`${language}, ${theme} theme, ${String(viewport.width)}px`, () => {
        test.use({ locale: 'en-US', colorScheme: theme, viewport });

        test('has no serious or critical axe violations', async ({ page }) => {
          await seedStorage(page, { language, theme });
          await gotoApp(page);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expectTheme(page, theme);
          await expectNoBlockingViolations(page);
        });
      });
    }
  }
}

for (const theme of THEMES) {
  test.describe(`${theme} theme with the header theme menu open, 1280px`, () => {
    test.use({ locale: 'en-US', colorScheme: theme, viewport: { width: 1280, height: 800 } });

    test('has no serious or critical axe violations', async ({ page }) => {
      await gotoApp(page);
      await expectTheme(page, theme);
      await openThemeMenu(page);
      await expectNoBlockingViolations(page);
    });
  });

  test.describe(`${theme} theme with the menu sheet open, 360px`, () => {
    test.use({ locale: 'en-US', colorScheme: theme, viewport: { width: 360, height: 740 } });

    test('has no serious or critical axe violations', async ({ page }) => {
      await gotoApp(page);
      await expectTheme(page, theme);
      await openMenuSheet(page);
      await expectNoBlockingViolations(page);
    });
  });
}

/**
 * Opens the Advanced disclosure; below 64rem it sits inside "Fees and advanced settings",
 * which is opened first (on a desktop that disclosure has no button and is always open).
 */
async function openAdvanced(page: Page): Promise<void> {
  const more = page.locator('#more-button');
  if (await more.isVisible()) {
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
  }
  const advanced = page.locator('#advanced-button');
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#advanced-content')).toBeVisible();
}

/**
 * Opens the Explain sheet from "How it's calculated": the formula strip's action on a
 * desktop, the summary card's button on a phone (only the visible one is a candidate).
 */
async function openExplainSheet(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: message('en', 'hero.howCalculated'), exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: message('en', 'explain.instalmentTitle'), exact: true }),
  ).toBeVisible();
}

/** Types text that does not parse into the rate and waits for the fix list (300 ms). */
async function showErrorState(page: Page): Promise<void> {
  await page.locator('#field-annualRatePct').fill('abc');
  await expect(page.locator('#field-annualRatePct')).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('heading', { name: message('en', 'results.fixFields'), exact: true }),
  ).toBeVisible();
}

const CALCULATOR_STATES = [
  { name: 'with Advanced open', open: openAdvanced },
  { name: 'with the Explain sheet open', open: openExplainSheet },
  { name: 'in the error state', open: showErrorState },
] as const;

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const state of CALCULATOR_STATES) {
      test.describe(`en, ${theme} theme, ${String(viewport.width)}px, ${state.name}`, () => {
        test.use({ locale: 'en-US', colorScheme: theme, viewport });

        test('has no serious or critical axe violations', async ({ page }) => {
          await seedStorage(page, { language: 'en', theme });
          await gotoApp(page);
          await expectTheme(page, theme);
          await state.open(page);
          await expectNoBlockingViolations(page);
        });
      });
    }
  }
}

for (const theme of THEMES) {
  test.describe(`${theme} theme with the skip link focused`, () => {
    test.use({ locale: 'en-US', colorScheme: theme });

    test('has no serious or critical axe violations', async ({ page }) => {
      await gotoApp(page);
      await expectTheme(page, theme);
      // Focused directly: keyboard reachability is covered in keyboard.spec.ts.
      const skipLink = page.getByRole('link', {
        name: message('en', 'a11y.skipToContent'),
        exact: true,
      });
      await skipLink.focus();
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toBeInViewport({ ratio: 1 });
      await expectNoBlockingViolations(page);
    });
  });
}

test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' });

  test('turns transitions and animations off', async ({ page }) => {
    await gotoApp(page);
    expect(await longestMotion(page), 'longest transition/animation in seconds').toBeLessThan(
      0.001,
    );
  });
});
