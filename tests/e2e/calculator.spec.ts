// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import { catalog, gotoApp, message, seedStorage, type Language } from './helpers.ts';

/*
 * The calculator end to end (T03 brief, Tests): the golden-vector scenarios show their
 * exact figures, invalid input never shows stale numbers, and the input-to-paint time of a
 * 1 200-period loan is measured.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** The results column (desktop). */
function results(page: Page): Locator {
  return page.locator('section.results');
}

/** A catalog message with its placeholders filled in. */
function text(language: Language, key: string, params: Readonly<Record<string, string>>): string {
  return Object.entries(params).reduce(
    (template, [name, value]) => template.replaceAll(`{${name}}`, value),
    catalog(language)[key] ?? '',
  );
}

/** Escapes regular-expression metacharacters so `value` matches literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces a field's text as a user would (select all, type). */
async function type(page: Page, id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).fill(value);
}

test.describe('design scenario (vector us-mortgage-30y-origination-fee)', () => {
  test('shows the exact payment, APR, totals and year-1 subtotals', async ({ page }) => {
    await gotoApp(page);
    // The opening scenario is the design scenario disbursed today; fix the date.
    await type(page, 'field-disbursementDate', '2026-11-01');

    const column = results(page);
    await expect(column).toContainText('$2,299.25');
    await expect(column).toContainText('$2,300.28');
    await expect(column).toContainText('6.974%');
    await expect(column).toContainText('$477,731.03');

    const yearOne = column
      .getByRole('row')
      .filter({ hasText: text('en', 'schedule.year', { year: '1' }) })
      .first();
    await expect(yearOne).toContainText('3,641.84');
    await expect(yearOne).toContainText('23,949.16');
  });
});

test.describe('CN scenario in zh-CN (vector cn-mortgage-30y-equal-instalments)', () => {
  test('shows ¥4,270.16 with the simple and the IRR annualized rates', async ({ page }) => {
    await seedStorage(page, { language: 'zh-CN' });
    await gotoApp(page);
    await page.locator('#field-currency').selectOption('CNY');
    await type(page, 'field-amount', '1000000.00');
    await type(page, 'field-annualRatePct', '3.10');
    await type(page, 'field-term-years', '30');
    await type(page, 'field-term-months', '0');
    await type(page, 'field-disbursementDate', '2026-11-01');
    const removeFee = text('zh-CN', 'fees.remove', {
      name: message('zh-CN', 'fees.defaultUpfront'),
    });
    await page.getByRole('button', { name: removeFee }).click();

    const column = results(page);
    await expect(column).toContainText('¥4,270.16');
    const simple = message('zh-CN', 'rateMethod.cnAnnualized');
    const irr = message('zh-CN', 'rateMethod.irrEffective');
    await expect(column).toContainText(simple);
    await expect(column).toContainText(irr);
    // Each rate's value follows its name (DESIGN §8.7: title then value; dl term then value).
    await expect(column).toContainText(new RegExp(`${escapeRegExp(simple)}[\\s\\S]*3\\.10%`));
    await expect(column).toContainText(new RegExp(`${escapeRegExp(irr)}[\\s\\S]*3\\.14%`));
  });
});

test.describe('invalid input', () => {
  test('an invalid term shows the localized error and no stale numbers', async ({ page }) => {
    await gotoApp(page);
    await type(page, 'field-disbursementDate', '2026-11-01');
    const column = results(page);
    await expect(column).toContainText('$2,299.25');

    await type(page, 'field-term-years', '101');
    await expect(page.getByText(text('en', 'errors.termRangeYears', { max: '100' }))).toBeVisible();
    await expect(page.locator('#field-term-years')).toHaveAttribute('aria-invalid', 'true');
    await expect(column).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('main')).not.toContainText('$2,299.25');
    await expect(column).toContainText(message('en', 'results.fixFields'));

    await type(page, 'field-term-years', '30');
    await expect(column).toContainText('$2,299.25');
    await expect(page.locator('#field-term-years')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('text that does not parse blanks the results at once', async ({ page }) => {
    await gotoApp(page);
    await type(page, 'field-disbursementDate', '2026-11-01');
    await type(page, 'field-amount', '12,34,567');
    await expect(page.locator('main')).not.toContainText('$2,299.25');
    await expect(page.locator('#field-amount')).toHaveAttribute('aria-invalid', 'true');
    await type(page, 'field-amount', '350,000.00');
    await expect(results(page)).toContainText('$2,299.25');
  });
});

test.describe('performance', () => {
  test('input-to-paint time of a 1 200-period loan (informational)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Measured in Chromium only (T03 brief §4).');
    await gotoApp(page);
    await type(page, 'field-term-years', '100');
    await type(page, 'field-term-months', '0');
    await expect(results(page)).toContainText(
      text('en', 'hero.payments_other', { count: '1,200' }),
    );

    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const elapsed = await page.evaluate(
        async (amount) => {
          const input = document.getElementById('field-amount');
          const target = document.querySelector('section.results');
          if (!(input instanceof HTMLInputElement) || target === null) {
            throw new Error('amount field or results column missing');
          }
          return new Promise<number>((resolve, reject) => {
            // Fails loudly instead of hanging if the change never reaches the results.
            const timeout = setTimeout(() => {
              reject(new Error('the results did not change'));
            }, 10_000);
            let start = 0;
            const observer = new MutationObserver(() => {
              observer.disconnect();
              // The frame that paints the new payment starts with this callback.
              requestAnimationFrame(() => {
                clearTimeout(timeout);
                resolve(performance.now() - start);
              });
            });
            observer.observe(target, { subtree: true, childList: true, characterData: true });
            start = performance.now();
            input.value = amount;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
        },
        // A new amount every run (the opening scenario has 350,000.00).
        `36${String(run)}000.00`,
      );
      samples.push(elapsed);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[2] ?? Number.NaN;
    const report = `median ${median.toFixed(1)} ms of [${samples.map((ms) => ms.toFixed(1)).join(', ')}] (target 100 ms, informational)`;
    test.info().annotations.push({ type: 'input-to-paint (1 200 periods)', description: report });
    console.log(`input-to-paint (1 200 periods): ${report}`);
    expect(Number.isFinite(median)).toBe(true);
  });
});
