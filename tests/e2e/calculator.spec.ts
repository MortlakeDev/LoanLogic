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

/** Replaces a field's text as a user would (select all, type). */
async function type(page: Page, id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).fill(value);
}

/**
 * Asserts the hero number of the results column: the full amount that assistive
 * technology reads and the styled parts that are drawn (aria-hidden) both read `amount`.
 */
async function expectHero(column: Locator, amount: string): Promise<void> {
  const hero = column.locator('.hero-amount');
  await expect(hero).toHaveCount(1);
  await expect(hero.locator('.visually-hidden'), 'hero amount (read aloud)').toHaveText(amount);
  await expect(hero.locator('[aria-hidden="true"]'), 'hero amount (drawn parts)').toHaveText(
    amount,
  );
}

test.describe('design scenario (vector us-mortgage-30y-origination-fee)', () => {
  test('shows the exact payment, APR, totals and year-1 subtotals', async ({ page }) => {
    await gotoApp(page);
    // The opening scenario is the design scenario disbursed today; fix the date.
    await type(page, 'field-disbursementDate', '2026-11-01');

    const column = results(page);
    await expectHero(column, '$2,299.25');
    await expect(column.locator('.hero-meta')).toContainText(
      text('en', 'hero.finalPayment', { amount: '$2,300.28' }),
    );

    const card = column.locator('.rate-card');
    await expect(card.locator('.rate-card__title')).toHaveText(
      message('en', 'rateMethod.usRegZApr'),
    );
    await expect(card.locator('.rate-card__rate')).toHaveText('6.974%');

    await expect(column.locator('.kpi__value--accent')).toHaveText('$477,731.03');

    // Without fees or insurance in the payments the table has six columns; the group row
    // spans the first three (#, date, payment) with its toggle, then principal, interest
    // and the closing balance.
    const table = column.locator('.schedule-table table');
    const headers = table.locator('thead th');
    await expect(headers).toHaveCount(6);
    await expect(headers.nth(3)).toHaveText(message('en', 'schedule.colPrincipal'));
    await expect(headers.nth(4)).toHaveText(message('en', 'schedule.colInterest'));
    const yearOne = table.locator('tr.schedule-table__group').filter({
      has: page.getByText(text('en', 'schedule.year', { year: '1' }), { exact: true }),
    });
    await expect(yearOne).toHaveCount(1);
    const subtotals = yearOne.locator('td');
    await expect(subtotals).toHaveCount(3);
    await expect(subtotals.nth(0), 'year 1 principal').toHaveText('3,641.84');
    await expect(subtotals.nth(1), 'year 1 interest').toHaveText('23,949.16');
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
    await expectHero(column, '¥4,270.16');

    // The headline is the simple annualized rate (title, then value); the IRR rate is the
    // secondary rate in the card's list (term, then value).
    const card = column.locator('.rate-card');
    await expect(card.locator('.rate-card__title')).toHaveText(
      message('zh-CN', 'rateMethod.cnAnnualized'),
    );
    await expect(card.locator('.rate-card__rate')).toHaveText('3.10%');
    const irr = card.locator('.rate-card__item').filter({
      has: page.getByText(message('zh-CN', 'rateMethod.irrEffective'), { exact: true }),
    });
    await expect(irr).toHaveCount(1);
    await expect(irr.locator('.rate-card__minor')).toHaveText('3.14%');

    // Amounts stay in JetBrains Mono on a Chinese page (DESIGN §1, §4.1): the CJK stack
    // replaces only the sans font.
    const fonts = await column.evaluate((root) =>
      ['.hero-amount [aria-hidden="true"] *', '.kpi__value *', '.rate-card__rate'].flatMap(
        (selector) =>
          Array.from(
            root.querySelectorAll(selector),
            (element) => getComputedStyle(element).fontFamily,
          ),
      ),
    );
    expect(fonts.length).toBeGreaterThan(0);
    for (const family of fonts) {
      expect(family).toMatch(/^"?JetBrains Mono/);
    }
  });
});

test.describe('invalid input', () => {
  test('an invalid term shows the localized error and no stale numbers', async ({ page }) => {
    await gotoApp(page);
    await type(page, 'field-disbursementDate', '2026-11-01');
    const column = results(page);
    await expect(column).toContainText('$2,299.25');

    await type(page, 'field-term-years', '101');
    // The fix list (after 300 ms) repeats the message after the field name, so the error
    // under the field is found by its own element.
    const error = page
      .locator('.field__error')
      .filter({ hasText: text('en', 'errors.termRangeYears', { max: '100' }) });
    await expect(error).toHaveCount(1);
    await expect(error).toBeVisible();
    await expect(page.locator('#field-term-years')).toHaveAttribute('aria-invalid', 'true');
    // Blanked, not stale: no payment, rate, totals or schedule are left on the page.
    await expect(page.locator('main')).not.toContainText('$2,299.25');
    for (const selector of ['.hero-amount', '.rate-card', '.kpi__value', '.schedule-table']) {
      await expect(page.locator(selector), `${selector} while the input is invalid`).toHaveCount(0);
    }
    await expect(
      column.getByRole('heading', { name: message('en', 'results.fixFields'), exact: true }),
    ).toBeVisible();

    await type(page, 'field-term-years', '30');
    await expect(column).toContainText('$2,299.25');
    await expect(page.locator('#field-term-years')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(error).toHaveCount(0);
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
              // The animation frame callback runs before that frame's style, layout and
              // paint; a task posted from it runs only after the frame has been rendered,
              // so the clock stops once the new payment is painted.
              requestAnimationFrame(() => {
                setTimeout(() => {
                  clearTimeout(timeout);
                  resolve(performance.now() - start);
                }, 0);
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
