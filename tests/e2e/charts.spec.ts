// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  catalog,
  expectNoBlockingViolations,
  expectTheme,
  gotoApp,
  message,
  seedStorage,
  systemColor,
  THEMES,
} from './helpers.ts';

/*
 * The chart card end to end (T04 brief, Tests): one tab stop with arrow keys through the
 * bars and points, a tooltip with the schedule's exact figures, the view switch and the
 * table from the keyboard, axe in every view, forced colors, and no overflow at 360 px.
 */

test.use({ locale: 'en-US' });

// Sub-pixel tolerance for layout comparisons.
const EPSILON = 1;

/** The opening scenario is the design scenario disbursed today; tests fix the date. */
const DISBURSEMENT = '2026-11-01';

type ChartView = 'bars' | 'balance' | 'cumulative';

const VIEWS: readonly ChartView[] = ['bars', 'balance', 'cumulative'];

const VIEW_LABELS: Readonly<Record<ChartView, string>> = {
  bars: 'chart.viewBars',
  balance: 'chart.viewBalance',
  cumulative: 'chart.viewCumulative',
};

/** A catalog message (English) with its placeholders filled in. */
function text(key: string, params: Readonly<Record<string, string>> = {}): string {
  const template = catalog('en')[key];
  if (template === undefined) {
    throw new Error(`Missing message "${key}" in en.json`);
  }
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, value),
    template,
  );
}

/** The chart card. */
function chartCard(page: Page): Locator {
  return page.locator('section.card.chart');
}

/** A bar or line point of the chart by its position (0-based). */
function chartItem(card: Locator, position: number): Locator {
  return card.locator(`.chart__item[data-index="${String(position)}"]`);
}

/** The "Show as table" switch. */
function tableToggle(card: Locator): Locator {
  return card.getByRole('button', { name: message('en', 'chart.showTable'), exact: true });
}

/** The view switch's radio of a view. */
function viewRadio(card: Locator, view: ChartView): Locator {
  return card.getByRole('radio', { name: message('en', VIEW_LABELS[view]), exact: true });
}

/** The tooltip (rendered only while a bar or point is hovered or focused). */
function tooltip(card: Locator): Locator {
  return card.locator('.chart__tooltip');
}

/** Opens the app with the design scenario disbursed on a fixed date. */
async function openDesignScenario(page: Page): Promise<void> {
  await gotoApp(page);
  await page.locator('#field-disbursementDate').fill(DISBURSEMENT);
  await expect(chartCard(page)).toBeVisible();
}

/** Switches the chart view with the view switch. */
async function showView(card: Locator, view: ChartView): Promise<void> {
  await viewRadio(card, view).check();
  await expect(viewRadio(card, view)).toBeChecked();
}

/** Whether keyboard focus is inside the chart's SVG. */
async function focusIsInChart(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelector('.chart__svg')?.contains(document.activeElement) ?? false,
  );
}

/** A loan year's group row in the schedule table (desktop): subtotals and its date range. */
interface ScheduleYear {
  /** "Year 1 · Dec 2026 – Nov 2027". */
  readonly heading: string;
  /** Amounts as the table shows them, without the currency symbol ("3,641.84"). */
  readonly principal: string;
  readonly interest: string;
  readonly closing: string;
}

const AMOUNT = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;

/**
 * Reveals every loan year's group row of the schedule table ("27 more years"), then parks
 * the pointer in the corner, where no chart item can scroll under it.
 */
async function revealAllYears(page: Page): Promise<void> {
  const more = page.locator('section.results .schedule-table__more-years');
  await more.click();
  await expect(more).toBeHidden();
  await page.mouse.move(0, 0);
}

/** Reads a loan year's group row from the schedule table. */
async function scheduleYear(page: Page, year: number): Promise<ScheduleYear> {
  const label = text('schedule.year', { year: String(year) });
  const row = page.locator('section.results .schedule-table tr.schedule-table__group').filter({
    has: page.getByText(label, { exact: true }),
  });
  await expect(row, `group row of ${label}`).toHaveCount(1);
  const cells = row.locator('td.num');
  await expect(cells).toHaveCount(3);
  const [principal, interest, closing] = await cells.allTextContents();
  const range = (await row.locator('.schedule-table__range').textContent()) ?? '';
  const figures = { principal: principal ?? '', interest: interest ?? '', closing: closing ?? '' };
  for (const [name, value] of Object.entries(figures)) {
    expect(value, `${label} ${name}`).toMatch(AMOUNT);
  }
  return { heading: `${label} ${range}`.replace(/\s+/gu, ' ').trim(), ...figures };
}

/** An amount as shown ("27,591.00") in minor units, exactly. */
function cents(amount: string): bigint {
  expect(amount).toMatch(AMOUNT);
  return BigInt(amount.replace(/[,.]/g, ''));
}

/** Minor units back to the table format ("27,591.00"). */
function formatCents(value: bigint): string {
  return `${(value / 100n).toLocaleString('en-US')}.${(value % 100n).toString().padStart(2, '0')}`;
}

/**
 * Asserts that the bar at `position` has keyboard focus as the chart's only tab stop, with
 * its focus ring drawn around it, and that its name and tooltip carry the loan year's exact
 * figures from the schedule table.
 */
async function expectFocusedBar(page: Page, card: Locator, position: number): Promise<void> {
  const bar = chartItem(card, position);
  await expect(bar, `bar ${String(position + 1)} should be focused`).toBeFocused();
  await expect(card.locator('.chart__item[tabindex="0"]'), 'one tab stop').toHaveCount(1);
  await expect(bar).toHaveAttribute('tabindex', '0');

  const ring = card.locator('.chart__focus');
  await expect(ring).toBeVisible();
  const ringBox = await ring.boundingBox();
  const barBox = await bar.locator('.chart__up').boundingBox();
  expect(ringBox, 'focus ring box').not.toBeNull();
  expect(barBox, 'bar box').not.toBeNull();
  if (ringBox !== null && barBox !== null) {
    expect(ringBox.x, 'focus ring left of the bar').toBeLessThan(barBox.x);
    expect(ringBox.x + ringBox.width, 'focus ring right of the bar').toBeGreaterThan(
      barBox.x + barBox.width,
    );
  }

  const year = await scheduleYear(page, position + 1);
  const label = text('schedule.year', { year: String(position + 1) });
  await expect(bar).toHaveAttribute(
    'aria-label',
    text('chart.barItem', {
      label,
      principal: `$${year.principal}`,
      interest: `$${year.interest}`,
    }),
  );
  const box = tooltip(card);
  await expect(box).toBeVisible();
  await expect(box.locator('.chart__tooltip-title')).toHaveText(year.heading);
  await expect(box.locator('dt')).toHaveText([
    message('en', 'chart.principal'),
    message('en', 'chart.interest'),
    message('en', 'chart.total'),
  ]);
  const total = formatCents(cents(year.principal) + cents(year.interest));
  await expect(box.locator('dd')).toHaveText([
    `$${year.principal}`,
    `$${year.interest}`,
    `$${total}`,
  ]);
}

test.describe('the chart from the keyboard (1280 px)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });

  test('one tab stop; arrow keys, Home and End move through the bars; the tooltip is exact', async ({
    page,
  }) => {
    await openDesignScenario(page);
    await revealAllYears(page);
    const card = chartCard(page);
    await expect(card.locator('.chart__item')).toHaveCount(30);

    // The annotation names the first year whose principal exceeds its interest.
    let overtake = 0;
    for (let year = 1; year <= 30 && overtake === 0; year += 1) {
      const figures = await scheduleYear(page, year);
      if (cents(figures.principal) > cents(figures.interest)) {
        overtake = year;
      }
    }
    expect(overtake, 'the design scenario overtakes in year 21').toBe(21);
    await expect(card.locator('.chart__annotation-label')).toHaveText(
      text('chart.overtakes', { label: text('schedule.year', { year: String(overtake) }) }),
    );

    // Tab from the table switch lands on the first bar.
    await tableToggle(card).focus();
    await page.keyboard.press('Tab');
    await expectFocusedBar(page, card, 0);
    // The ring is painted over the hit columns: it lets the pointer through to them.
    expect(
      await card.locator('.chart__focus').evaluate((ring) => getComputedStyle(ring).pointerEvents),
      'focus ring pointer events',
    ).toBe('none');

    const moves: [string, number][] = [
      ['ArrowRight', 1],
      ['ArrowDown', 2],
      ['ArrowUp', 1],
      ['ArrowLeft', 0],
      ['ArrowLeft', 0],
      ['End', 29],
      ['ArrowRight', 29],
      ['Home', 0],
      ['ArrowRight', 1],
    ];
    for (const [key, position] of moves) {
      await page.keyboard.press(key);
      await expectFocusedBar(page, card, position);
    }

    // Escape hides the tooltip and keeps focus (WCAG 1.4.13); the next move shows it again.
    await page.keyboard.press('Escape');
    await expect(tooltip(card)).toBeHidden();
    await expect(chartItem(card, 1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expectFocusedBar(page, card, 2);

    // Tab leaves the chart in one step; Shift+Tab comes back to the same bar.
    await page.keyboard.press('Tab');
    await expect.poll(() => focusIsInChart(page), { message: 'focus left the chart' }).toBe(false);
    await expect(tooltip(card)).toBeHidden();
    await expect(card.locator('.chart__focus')).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expectFocusedBar(page, card, 2);
  });

  test('the view switch and "Show as table" work from the keyboard', async ({ page }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    const title = card.getByRole('heading', { level: 3 });
    const legend = card.locator('.chart__legend-item');
    const year1 = await scheduleYear(page, 1);
    const yearLabel = text('schedule.year', { year: '1' });

    await viewRadio(card, 'bars').focus();
    await expect(viewRadio(card, 'bars')).toBeChecked();
    await expect(title).toHaveText(message('en', 'chart.titleBarsYears'));

    // Balance: one line, the payoff marked.
    await page.keyboard.press('ArrowRight');
    await expect(viewRadio(card, 'balance')).toBeChecked();
    await expect(viewRadio(card, 'balance')).toBeFocused();
    await expect(title).toHaveText(message('en', 'chart.titleBalance'));
    await expect(
      page.getByRole('region', { name: message('en', 'chart.titleBalance'), exact: true }),
    ).toBeVisible();
    await expect(legend).toHaveText([message('en', 'chart.balance')]);
    await expect(card.locator('.chart__annotation-label')).toHaveText(
      text('chart.paidOff', { date: 'Nov 2056' }),
    );

    // The view switch is one tab stop, then the table switch, then the chart.
    await page.keyboard.press('Tab');
    await expect(tableToggle(card)).toBeFocused();
    await page.keyboard.press('Tab');
    const point = chartItem(card, 0);
    await expect(point).toBeFocused();
    await expect(point).toHaveAttribute(
      'aria-label',
      text('chart.balanceItem', { label: yearLabel, balance: `$${year1.closing}` }),
    );
    await expect(tooltip(card).locator('.chart__tooltip-title')).toHaveText(year1.heading);
    await expect(tooltip(card).locator('dd')).toHaveText([`$${year1.closing}`]);
    await expect(card.locator('.chart__marker')).toHaveCount(1);
    await expect(card.locator('.chart__focus')).toBeVisible();

    // "Show as table" swaps the chart for a table of the same figures.
    await page.keyboard.press('Shift+Tab');
    await expect(tableToggle(card)).toBeFocused();
    await expect(tableToggle(card)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(tableToggle(card)).toHaveAttribute('aria-pressed', 'true');
    await expect(tableToggle(card)).toBeFocused();
    const caption = text('chart.caption', {
      title: message('en', 'chart.titleBalance'),
      currency: 'USD',
    });
    const table = card.getByRole('table', { name: caption, exact: true });
    await expect(table).toBeVisible();
    await expect(card.locator('figure')).toHaveCount(0);
    await expect(legend).toHaveCount(0);
    await expect(table.locator('thead th')).toHaveText([
      message('en', 'chart.colYear'),
      message('en', 'chart.colLastDate'),
      message('en', 'chart.balance'),
    ]);
    await expect(table.locator('tbody tr')).toHaveCount(30);
    const firstRow = table.locator('tbody tr').first();
    await expect(firstRow.locator('th')).toHaveText(yearLabel);
    await expect(firstRow.locator('td')).toHaveText(['Nov 1, 2027', year1.closing]);
    // The table scrolls in its own region, the next tab stop.
    await page.keyboard.press('Tab');
    await expect(card.getByRole('region', { name: caption, exact: true })).toBeFocused();

    // Space switches back to the chart.
    await page.keyboard.press('Shift+Tab');
    await expect(tableToggle(card)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(tableToggle(card)).toHaveAttribute('aria-pressed', 'false');
    await expect(card.getByRole('table')).toHaveCount(0);
    await expect(card.locator('figure')).toBeVisible();

    // Paid so far: two lines; this loan's interest paid stays above principal paid.
    await page.keyboard.press('Shift+Tab');
    await expect(viewRadio(card, 'balance')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(viewRadio(card, 'cumulative')).toBeChecked();
    await expect(title).toHaveText(message('en', 'chart.titleCumulative'));
    await expect(legend).toHaveText([
      message('en', 'chart.principalPaid'),
      message('en', 'chart.interestPaid'),
    ]);
    await expect(card.locator('.chart__annotation')).toHaveCount(0);
    await expect(chartItem(card, 0)).toHaveAttribute(
      'aria-label',
      text('chart.cumulativeItem', {
        label: yearLabel,
        principal: `$${year1.principal}`,
        interest: `$${year1.interest}`,
      }),
    );

    // Back to the bars (WebKit's radios do not wrap around at the ends).
    await page.keyboard.press('ArrowLeft');
    await expect(viewRadio(card, 'balance')).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(viewRadio(card, 'bars')).toBeChecked();
    await expect(title).toHaveText(message('en', 'chart.titleBarsYears'));
    await expect(legend).toHaveText([
      message('en', 'chart.principal'),
      message('en', 'chart.interest'),
    ]);
    await expect(card.locator('.chart__annotation-label')).toHaveText(
      text('chart.overtakes', { label: text('schedule.year', { year: '21' }) }),
    );
  });

  test('hovering shows the tooltip; leaving or Escape hides it; a click keeps focus', async ({
    page,
  }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    const year3 = await scheduleYear(page, 3);
    const bar = chartItem(card, 2);

    await bar.hover();
    await expect(tooltip(card)).toBeVisible();
    await expect(tooltip(card).locator('.chart__tooltip-title')).toHaveText(year3.heading);
    await page.mouse.move(1, 1);
    await expect(tooltip(card)).toBeHidden();

    await bar.hover();
    await expect(tooltip(card)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip(card)).toBeHidden();

    // A click shows the tooltip through hover and does not pull focus into the chart.
    await page.mouse.move(1, 1);
    await bar.click();
    await expect(tooltip(card)).toBeVisible();
    await expect.poll(() => focusIsInChart(page), { message: 'focus stays out' }).toBe(false);
  });

  test('the pointer moves from a bar onto its tooltip, which stays (WCAG 1.4.13)', async ({
    page,
  }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    const year3 = await scheduleYear(page, 3);
    const bar = chartItem(card, 2);
    const title = tooltip(card).locator('.chart__tooltip-title');

    await bar.hover();
    await expect(title).toHaveText(year3.heading);
    const column = await bar.locator('.chart__hit').boundingBox();
    const box = await tooltip(card).boundingBox();
    expect(column, 'column box').not.toBeNull();
    expect(box, 'tooltip box').not.toBeNull();
    if (column === null || box === null) {
      return;
    }
    // The tooltip starts at the edge of the bar's column, not in the next one.
    expect(box.x, 'tooltip left edge').toBeLessThanOrEqual(column.x + column.width + EPSILON);
    expect(box.x, 'tooltip left edge').toBeGreaterThanOrEqual(column.x + column.width / 2);
    // Up the column to the tooltip's height, then across onto the tooltip and over it.
    const top = Math.max(column.y, box.y);
    const y = (top + Math.min(column.y + column.height, box.y + box.height)) / 2;
    await page.mouse.move(column.x + column.width / 2, y, { steps: 5 });
    await page.mouse.move(box.x + 16, y, { steps: 8 });
    await expect(title).toHaveText(year3.heading);
    await page.mouse.move(box.x + box.width - 8, box.y + 8, { steps: 8 });
    await expect(title).toHaveText(year3.heading);

    // Leaving the tooltip for the page hides it.
    await page.mouse.move(box.x + box.width - 8, 1, { steps: 4 });
    await expect(tooltip(card)).toBeHidden();

    // Escape hides it while the pointer rests on it, and it stays hidden.
    await bar.hover();
    await page.mouse.move(column.x + column.width / 2, y, { steps: 5 });
    await page.mouse.move(box.x + 16, y, { steps: 8 });
    await expect(title).toHaveText(year3.heading);
    await page.keyboard.press('Escape');
    await expect(tooltip(card)).toBeHidden();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 250);
        }),
    );
    await expect(tooltip(card)).toBeHidden();
  });

  test('a line point takes the pointer through its line; the hovered column stays under it', async ({
    page,
  }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    const year3 = await scheduleYear(page, 3);
    await showView(card, 'balance');
    const svg = card.locator('svg.chart__svg');
    await svg.scrollIntoViewIfNeeded();
    // The 3rd vertex after the origin is year 3's point, in SVG pixels.
    const d = (await card.locator('path.chart__line').getAttribute('d')) ?? '';
    const vertex = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)][3];
    const box = await svg.boundingBox();
    expect(vertex, 'year 3 vertex').toBeDefined();
    expect(box, 'SVG box').not.toBeNull();
    if (vertex === undefined || box === null) {
      return;
    }
    await page.mouse.move(box.x + Number(vertex[1]), box.y + Number(vertex[2]));
    await expect(tooltip(card).locator('.chart__tooltip-title')).toHaveText(year3.heading);
    expect(
      await chartItem(card, 2)
        .locator('.chart__hit')
        .evaluate((element) => getComputedStyle(element).fillOpacity),
      'half-strength highlight',
    ).toBe('0.5');
    // The line is painted over the highlighted column.
    expect(
      await card.evaluate((root) => {
        const hit = root.querySelector('.chart__item[data-index="2"] .chart__hit');
        const line = root.querySelector('path.chart__line');
        return (
          hit !== null &&
          line !== null &&
          (hit.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        );
      }),
    ).toBe(true);
  });
});

/** Focuses the first bar or point, which shows its tooltip and focus ring. */
async function focusFirstItem(card: Locator): Promise<void> {
  await chartItem(card, 0).focus();
  await expect(tooltip(card)).toBeVisible();
}

const AXE_STATES: readonly {
  readonly name: string;
  /** Brings the card into the state; `null` scans it as it opens. */
  readonly open: ((card: Locator) => Promise<void>) | null;
}[] = [
  { name: 'payments view', open: null },
  {
    name: 'payments view with a focused bar',
    open: async (card) => {
      await focusFirstItem(card);
    },
  },
  {
    name: 'balance view with a focused point',
    open: async (card) => {
      await showView(card, 'balance');
      await focusFirstItem(card);
    },
  },
  {
    name: 'paid-so-far view with a focused point',
    open: async (card) => {
      await showView(card, 'cumulative');
      await focusFirstItem(card);
    },
  },
  {
    name: 'table',
    open: async (card) => {
      await tableToggle(card).click();
      await expect(card.getByRole('table')).toBeVisible();
    },
  },
];

for (const theme of THEMES) {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    for (const state of AXE_STATES) {
      test.describe(`chart, ${theme} theme, ${String(viewport.width)}px, ${state.name}`, () => {
        test.use({ colorScheme: theme, viewport });

        test('has no serious or critical axe violations', async ({ page }) => {
          await seedStorage(page, { language: 'en', theme });
          await gotoApp(page);
          await expectTheme(page, theme);
          const card = chartCard(page);
          await expect(card).toBeVisible();
          await state.open?.(card);
          await expectNoBlockingViolations(page);
        });
      });
    }
  }
}

/** Computed paint of an SVG element. */
async function paint(
  locator: Locator,
): Promise<{ fill: string; stroke: string; dash: string; strokeWidth: number }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fill: style.fill,
      stroke: style.stroke,
      dash: style.strokeDasharray,
      strokeWidth: Number.parseFloat(style.strokeWidth),
    };
  });
}

test.describe('forced colors (1280 px)', () => {
  // Windows contrast themes; only Chromium emulates forced colors.
  test.use({
    forcedColors: 'active',
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
  });

  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium emulates forced-colors mode');
  });

  test('the bars use system colors and interest keeps a visible hatch', async ({ page }) => {
    await gotoApp(page);
    const card = chartCard(page);
    const svg = card.locator('svg.chart__svg');
    const canvasText = await systemColor(page, 'CanvasText');
    const highlight = await systemColor(page, 'Highlight');
    const grayText = await systemColor(page, 'GrayText');
    const canvas = await systemColor(page, 'Canvas');
    expect(await svg.evaluate((element) => getComputedStyle(element).forcedColorAdjust)).toBe(
      'none',
    );

    const bar = chartItem(card, 0);
    const principal = bar.locator('rect.chart__principal');
    await expect(principal).toBeVisible();
    expect((await paint(principal)).fill, 'principal fill').toBe(canvasText);

    // Interest is painted with this chart's hatch: Highlight with Canvas lines.
    const interest = bar.locator('.chart__up > rect:not(.chart__segment)');
    await expect(interest).toBeVisible();
    const interestFill = (await paint(interest)).fill;
    const patternId = /^url\("?#([^")]+)"?\)$/.exec(interestFill)?.[1];
    expect(patternId, `interest fill ${interestFill} is a pattern`).toBeDefined();
    const pattern = svg.locator(`pattern[id="${patternId ?? ''}"]`);
    await expect(pattern).toHaveCount(1);
    expect((await paint(pattern.locator('.chart__interest'))).fill, 'hatch ground').toBe(highlight);
    const hatch = await paint(pattern.locator('.chart__hatch'));
    expect(hatch.stroke, 'hatch lines').toBe(canvas);
    expect(hatch.stroke, 'hatch lines differ from the ground').not.toBe(highlight);
    expect(hatch.strokeWidth, 'hatch line width').toBeGreaterThan(0);
    expect(
      await pattern
        .locator('.chart__hatch')
        .evaluate((element) => getComputedStyle(element).strokeOpacity),
    ).toBe('1');

    // The legend names the series with the same paint.
    const swatches = card.locator('.chart__legend-item svg > rect');
    await expect(swatches).toHaveCount(2);
    expect((await paint(swatches.nth(0))).fill, 'principal swatch').toBe(canvasText);
    expect((await paint(swatches.nth(1))).fill, 'interest swatch').toBe(interestFill);

    // Grid, labels and the annotation stay visible.
    expect((await paint(card.locator('.chart__grid-line').first())).stroke).toBe(grayText);
    expect((await paint(card.locator('.chart__tick').first())).fill).toBe(canvasText);
    expect((await paint(card.locator('.chart__annotation-line'))).stroke).toBe(canvasText);
    expect((await paint(card.locator('.chart__annotation-label'))).fill).toBe(canvasText);

    // The focus ring is drawn in a system color.
    await bar.focus();
    const ring = await paint(card.locator('.chart__focus'));
    expect(ring.stroke, 'focus ring').toBe(canvasText);
    expect(ring.strokeWidth, 'focus ring width').toBeGreaterThanOrEqual(2);

    // The hovered column is outlined in a system color; nothing is painted under the bar.
    await chartItem(card, 25).hover();
    const hit = await paint(chartItem(card, 25).locator('.chart__hit'));
    expect(hit.fill, 'hovered column fill').toBe('rgba(0, 0, 0, 0)');
    expect(hit.stroke, 'hovered column outline').toBe(grayText);
  });

  // The app theme set opposite to the contrast theme: the theme's own grid color would
  // nearly hide the hovered bar.
  for (const [theme, scheme] of [
    ['dark', 'light'],
    ['light', 'dark'],
  ] as const) {
    test(`the hovered column keeps system colors with the ${theme} app theme on a ${scheme} contrast theme`, async ({
      page,
    }) => {
      await seedStorage(page, { theme });
      await page.emulateMedia({ colorScheme: scheme, forcedColors: 'active' });
      await gotoApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const card = chartCard(page);
      const grayText = await systemColor(page, 'GrayText');
      await chartItem(card, 3).hover();
      const hit = await paint(chartItem(card, 3).locator('.chart__hit'));
      expect(hit.fill, 'hovered column fill').toBe('rgba(0, 0, 0, 0)');
      expect(hit.stroke, 'hovered column outline').toBe(grayText);
    });
  }

  test('the lines use system colors and the interest line is dashed', async ({ page }) => {
    await gotoApp(page);
    const card = chartCard(page);
    const canvasText = await systemColor(page, 'CanvasText');
    const highlight = await systemColor(page, 'Highlight');

    await showView(card, 'cumulative');
    const principal = await paint(card.locator('path.chart__line--principal'));
    const interest = await paint(card.locator('path.chart__line--interest'));
    expect(principal.stroke, 'principal paid line').toBe(canvasText);
    expect(principal.dash, 'principal paid line is solid').toBe('none');
    expect(interest.stroke, 'interest paid line').toBe(highlight);
    expect(interest.dash, 'interest paid line is dashed').not.toBe('none');
    const swatch = await paint(card.locator('.chart__legend-item line.chart__line--interest'));
    expect(swatch.stroke, 'interest paid swatch').toBe(highlight);
    expect(swatch.dash, 'interest paid swatch is dashed').not.toBe('none');

    await showView(card, 'balance');
    expect((await paint(card.locator('path.chart__line--principal'))).stroke).toBe(canvasText);
    expect((await paint(card.locator('.chart__payoff'))).fill, 'payoff dot').toBe(canvasText);
  });

  test('the view switch and the table switch show their state in Highlight', async ({ page }) => {
    await gotoApp(page);
    const card = chartCard(page);
    const highlight = await systemColor(page, 'Highlight');
    const highlightText = await systemColor(page, 'HighlightText');
    /** The computed background and text colors of an element. */
    const colors = (locator: Locator): Promise<{ background: string; text: string }> =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color };
      });

    await showView(card, 'balance');
    const face = (view: ChartView): Locator =>
      card.locator(`.segmented__option:has(input[value="${view}"]) .segmented__face`);
    expect(await colors(face('balance')), 'the checked view').toEqual({
      background: highlight,
      text: highlightText,
    });
    expect((await colors(face('bars'))).background, 'an unchecked view').not.toBe(highlight);

    const toggle = tableToggle(card);
    expect((await colors(toggle)).background, 'the table switch, off').not.toBe(highlight);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await colors(toggle), 'the table switch, on').toEqual({
      background: highlight,
      text: highlightText,
    });
  });
});

/**
 * Layout problems of the chart card, described for a message: elements outside the card,
 * SVG parts outside the SVG, overlapping x labels or y labels, and an annotation label
 * that overlaps an axis label.
 */
async function chartLayoutProblems(card: Locator): Promise<string[]> {
  return card.evaluate((root, epsilon) => {
    const problems: string[] = [];
    /** A short description of an element: tag, classes and text. */
    const describe = (element: Element): string => {
      const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/).join('.');
      const label = element.textContent.trim().slice(0, 40);
      return `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`}${label === '' ? '' : ` "${label}"`}`;
    };
    const outside = (inner: DOMRect, outer: DOMRect, vertical: boolean): boolean =>
      inner.left < outer.left - epsilon ||
      inner.right > outer.right + epsilon ||
      (vertical && (inner.top < outer.top - epsilon || inner.bottom > outer.bottom + epsilon));
    const overlap = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    const cardBox = root.getBoundingClientRect();
    for (const element of root.querySelectorAll('*')) {
      // The table scrolls inside its own region; only the region has to fit.
      if (element.parentElement?.closest('.chart-table') != null) {
        continue;
      }
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && outside(box, cardBox, false)) {
        problems.push(`${describe(element)} sticks out of the card`);
      }
    }
    const svg = root.querySelector('svg.chart__svg');
    if (svg === null) {
      return problems;
    }
    const svgBox = svg.getBoundingClientRect();
    for (const element of svg.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && outside(box, svgBox, true)) {
        problems.push(`${describe(element)} sticks out of the SVG`);
      }
    }
    const boxes = (selector: string): { text: string; box: DOMRect }[] =>
      [...svg.querySelectorAll(selector)].map((element) => ({
        text: element.textContent,
        box: element.getBoundingClientRect(),
      }));
    const xLabels = boxes('text.chart__tick[text-anchor="middle"]').sort(
      (a, b) => a.box.left - b.box.left,
    );
    const yLabels = boxes('text.chart__tick[text-anchor="end"]').sort(
      (a, b) => a.box.top - b.box.top,
    );
    for (const labels of [xLabels, yLabels]) {
      for (let index = 1; index < labels.length; index += 1) {
        const previous = labels[index - 1];
        const current = labels[index];
        if (previous !== undefined && current !== undefined && overlap(previous.box, current.box)) {
          problems.push(`axis labels "${previous.text}" and "${current.text}" overlap`);
        }
      }
    }
    for (const annotation of boxes('.chart__annotation-label')) {
      for (const label of [...xLabels, ...yLabels]) {
        if (overlap(annotation.box, label.box)) {
          problems.push(`annotation "${annotation.text}" overlaps axis label "${label.text}"`);
        }
      }
    }
    return problems;
  }, EPSILON);
}

/** Asserts that `inner`'s box lies inside `outer`'s horizontally; `name` labels failures. */
async function expectInsideHorizontally(
  inner: Locator,
  outer: Locator,
  name: string,
): Promise<void> {
  const a = await inner.boundingBox();
  const b = await outer.boundingBox();
  expect(a, `${name} box`).not.toBeNull();
  expect(b, `${name} container box`).not.toBeNull();
  if (a !== null && b !== null) {
    expect(a.x, `${name}: left edge`).toBeGreaterThanOrEqual(b.x - EPSILON);
    expect(a.x + a.width, `${name}: right edge`).toBeLessThanOrEqual(b.x + b.width + EPSILON);
  }
}

test.describe('narrow screens (360 × 740)', () => {
  test.use({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });

  const LOANS = [
    { name: 'the design scenario', years: null, bars: 30 },
    { name: 'a 100-year loan (1 200 monthly payments)', years: '100', bars: 100 },
  ] as const;

  for (const loan of LOANS) {
    test(`nothing in the chart card overflows: ${loan.name}`, async ({ page }) => {
      await gotoApp(page);
      if (loan.years !== null) {
        await page.locator('#field-term-years').fill(loan.years);
        await page.locator('#field-term-months').fill('0');
      }
      const card = chartCard(page);
      await expect(card.locator('.chart__subtitle')).toHaveText(
        text('chart.subtitleYears_other', { last: String(loan.bars), count: '12' }),
      );
      for (const view of VIEWS) {
        await showView(card, view);
        await expect(card.locator('.chart__item')).toHaveCount(loan.bars);
        expect(await chartLayoutProblems(card), `${view} view`).toEqual([]);
        // The tooltips of the first and the last item stay inside the card.
        for (const position of [0, loan.bars - 1]) {
          await chartItem(card, position).focus();
          await expect(tooltip(card)).toBeVisible();
          await expectInsideHorizontally(
            tooltip(card),
            card,
            `${view} tooltip of item ${String(position + 1)}`,
          );
        }
      }
      // The table keeps the card's width and scrolls inside its own region.
      await tableToggle(card).click();
      const region = card.locator('.chart-table');
      await expect(region).toBeVisible();
      expect(await chartLayoutProblems(card), 'table').toEqual([]);
      await expectInsideHorizontally(region, card, 'table region');
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scroll.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(scroll.clientWidth);
    });
  }

  test('the tooltip of a focused balance point never covers the point or its focus ring', async ({
    page,
  }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    await showView(card, 'balance');
    for (let position = 0; position < 30; position += 1) {
      await chartItem(card, position).focus();
      await expect(tooltip(card)).toBeVisible();
      await expect
        .poll(
          () =>
            card.evaluate((root) => {
              const ring = root.querySelector('.chart__focus')?.getBoundingClientRect();
              const box = root.querySelector('.chart__tooltip')?.getBoundingClientRect();
              return ring !== undefined && box !== undefined
                ? ring.left < box.right &&
                    box.left < ring.right &&
                    ring.top < box.bottom &&
                    box.top < ring.bottom
                : null;
            }),
          { message: `the tooltip of year ${String(position + 1)} covers its focus ring` },
        )
        .toBe(false);
    }
  });
});

test.describe('touch screens (360 × 740)', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('the tooltip lets taps through to the bars it covers', async ({ page }) => {
    await openDesignScenario(page);
    const card = chartCard(page);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches), 'no hover').toBe(true);
    await focusFirstItem(card);
    expect(
      await tooltip(card).evaluate((box) => getComputedStyle(box).pointerEvents),
      'tooltip pointer events',
    ).toBe('none');
  });
});

/**
 * Records the name of every CSS animation that starts on the page, from before the app
 * runs: the bars' intro ends within 320 ms, too fast to catch by polling the DOM.
 */
async function recordAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const started: string[] = [];
    Object.assign(window, { startedAnimations: started });
    document.addEventListener(
      'animationstart',
      (event) => {
        started.push(event.animationName);
      },
      true,
    );
  });
}

/** The names recorded by `recordAnimations`. */
async function startedAnimations(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { startedAnimations: string[] }).startedAnimations,
  );
}

test.describe('the bars grow in once (DESIGN §6)', () => {
  test('on the first render only, not after a recalculation', async ({ page }) => {
    await recordAnimations(page);
    await gotoApp(page);
    const card = chartCard(page);
    await expect(chartItem(card, 0)).toBeVisible();
    await expect.poll(async () => startedAnimations(page)).toContain('chart-grow');
    // The intro class goes once the animation has ended.
    await expect(card.locator('.chart__series--intro')).toHaveCount(0);
    const before = (await startedAnimations(page)).length;
    const firstBar = (await chartItem(card, 0).getAttribute('aria-label')) ?? '';

    await page.locator('#field-amount').fill('300000.00');
    await expect(chartItem(card, 0)).not.toHaveAttribute('aria-label', firstBar);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 500);
        }),
    );
    expect((await startedAnimations(page)).slice(before)).not.toContain('chart-grow');
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('not at all', async ({ page }) => {
      await recordAnimations(page);
      await gotoApp(page);
      await expect(chartItem(chartCard(page), 0)).toBeVisible();
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 500);
          }),
      );
      expect(await startedAnimations(page)).not.toContain('chart-grow');
    });
  });
});

/** Text of a view switch segment that spills out of the segment, described for a message. */
async function spilledSegments(card: Locator): Promise<string[]> {
  return card.locator('.chart__switch .segmented__face').evaluateAll((faces) =>
    faces.flatMap((face) => {
      const range = document.createRange();
      range.selectNodeContents(face);
      const box = face.getBoundingClientRect();
      return [...range.getClientRects()]
        .filter((line) => line.left < box.left - 0.5 || line.right > box.right + 0.5)
        .map(
          (line) =>
            `"${face.textContent}" spans ${line.left.toFixed(1)}–${line.right.toFixed(1)} in a segment at ${box.left.toFixed(1)}–${box.right.toFixed(1)}`,
        );
    }),
  );
}

for (const language of ['ru', 'uk'] as const) {
  test.describe(`narrow screens in ${language} (360 × 740)`, () => {
    test.use({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });

    test('the view switch labels fit their segments', async ({ page }) => {
      await seedStorage(page, { language });
      await gotoApp(page);
      const card = chartCard(page);
      await expect(card).toBeVisible();
      for (const view of VIEWS) {
        await card.locator(`.chart__switch input[value="${view}"]`).check();
        expect(await spilledSegments(card), `${view} selected`).toEqual([]);
      }
    });

    test('a short loan keeps its wrapped annotation labels inside the chart', async ({ page }) => {
      await seedStorage(page, { language });
      await gotoApp(page);
      // A 12-month interest-only loan: principal overtakes and passes in payment 12.
      await page.locator('#field-repayment input[value="bullet"]').check();
      await page.locator('#field-term-years').fill('1');
      await page.locator('#field-term-months').fill('0');
      const card = chartCard(page);
      await expect(card.locator('.chart__item')).toHaveCount(12);
      for (const view of ['bars', 'cumulative'] as const) {
        await card.locator(`.chart__switch input[value="${view}"]`).check();
        const label = card.locator('.chart__annotation-label');
        await expect(label).toBeVisible();
        // The payment on the first line, the phrase below it.
        await expect(label.locator('tspan').first()).toHaveText(
          message(language, 'chart.payment').replace('{number}', '12'),
        );
        expect(await chartLayoutProblems(card), `${view} view`).toEqual([]);
      }
    });
  });
}

test.describe('a larger browser font (20 px root)', () => {
  test.use({ colorScheme: 'dark' });

  for (const width of [360, 1280]) {
    test(`the axis and annotation labels fit the chart at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      // The browser's default font size, as a reader with "Large" text sets it: on the root
      // element as soon as the parser creates it, before the app renders.
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const root = document.querySelector('html');
          if (root !== null) {
            root.style.fontSize = '20px';
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true });
      });
      await openDesignScenario(page);
      const card = chartCard(page);
      expect(
        await card
          .locator('.chart__tick')
          .first()
          .evaluate((tick) => getComputedStyle(tick).fontSize),
      ).toBe('15px');
      for (const view of VIEWS) {
        await showView(card, view);
        expect(await chartLayoutProblems(card), `${view} view`).toEqual([]);
      }
    });
  }
});
