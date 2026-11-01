// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleTotals, sumMoney } from '../state/derived';
import { setLanguage } from '../state/i18n';
import {
  type FeeDraft,
  type LoanForm,
  okResult,
  resetForm,
  setInputInvalid,
  updateForm,
} from '../state/loan';
import { ChartCard } from './ChartCard';
import { LABEL_PX } from './layout';
import { estimateTextWidth } from './scale';
import { chartTable, chartView, resetChartView, setChartView } from './view';

interface VectorFee {
  readonly id: string;
  readonly kind: FeeDraft['kind'];
  readonly calc: FeeDraft['calc'];
  readonly value: string;
  readonly financing?: FeeDraft['financing'];
  readonly inApr: boolean;
}

interface LoanVector {
  readonly id: string;
  readonly kind: string;
  readonly input: {
    readonly currency: string;
    readonly amount: string;
    readonly annualRatePct: string;
    readonly repayment: LoanForm['repayment'];
    readonly frequency: LoanForm['frequency'];
    readonly term: {
      readonly years?: number;
      readonly months?: number;
      readonly payments?: number;
    };
    readonly disbursementDate: string;
    readonly accrual?: {
      readonly mode: LoanForm['accrualMode'];
      readonly method?: LoanForm['dayCount'];
      readonly paymentBasis?: LoanForm['paymentBasis'];
    };
    readonly fees?: readonly VectorFee[];
  };
  readonly expected: { readonly summary?: { readonly totalPaid: string } };
}

const FILES = import.meta.glob<LoanVector>('../../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

function vector(id: string): LoanVector {
  const found = Object.values(FILES).find((file) => file.id === id);
  if (found === undefined) {
    throw new Error(`no vector ${id}`);
  }
  return found;
}

/** Sets the form to a golden vector's input and checks the app computes the same loan. */
function loadVector(id: string): void {
  const { input, expected } = vector(id);
  updateForm({
    currency: input.currency,
    amount: input.amount,
    annualRatePct: input.annualRatePct,
    repayment: input.repayment,
    frequency: input.frequency,
    disbursementDate: input.disbursementDate,
    ...(input.term.payments === undefined
      ? {
          termMode: 'years',
          termYears: String(input.term.years ?? 0),
          termMonths: String(input.term.months ?? 0),
        }
      : { termMode: 'payments', termPayments: String(input.term.payments) }),
    ...(input.accrual?.mode === 'daycount'
      ? {
          accrualMode: 'daycount',
          dayCount: input.accrual.method ?? 'act-365f',
          paymentBasis: input.accrual.paymentBasis ?? 'nominal',
        }
      : {}),
    fees: (input.fees ?? []).map((fee) => ({
      uid: fee.id,
      name: '',
      kind: fee.kind,
      calc: fee.calc,
      value: fee.value,
      financing: fee.financing ?? 'paid',
      inApr: fee.inApr,
    })),
  });
  expect(okResult.value?.summary.totalPaid).toBe(expected.summary?.totalPaid);
}

/** Makes ResizeObserver report a container `width` px wide. */
function stubWidth(width: number): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this);
      }

      unobserve(): void {
        // Nothing observed per element.
      }

      disconnect(): void {
        // Nothing to release.
      }
    },
  );
}

function renderCard(): Element {
  const { container } = render(<ChartCard />);
  return container;
}

function card(): HTMLElement {
  const section = document.querySelector<HTMLElement>('section.chart');
  if (section === null) {
    throw new Error('no chart card');
  }
  return section;
}

function figure(): HTMLElement {
  const found = card().querySelector<HTMLElement>('figure');
  if (found === null) {
    throw new Error('no figure');
  }
  return found;
}

function svg(): SVGSVGElement {
  const found = figure().querySelector('svg');
  if (found === null) {
    throw new Error('no svg');
  }
  return found;
}

/** The bars or points: the focusable images of the chart. */
function items(): HTMLElement[] {
  return within(figure()).getAllByRole('img');
}

function item(position: number): HTMLElement {
  const found = items()[position];
  if (found === undefined) {
    throw new Error(`no item ${String(position)}`);
  }
  return found;
}

function labels(): (string | null)[] {
  return items().map((element) => element.getAttribute('aria-label'));
}

function legend(): string[] {
  return Array.from(card().querySelectorAll('.chart__legend-item'), (entry) => entry.textContent);
}

function annotation(): string | null {
  return card().querySelector('.chart__annotation-label')?.textContent ?? null;
}

function tooltip(): HTMLElement | null {
  return card().querySelector<HTMLElement>('.chart__tooltip');
}

function tooltipRows(): string[] {
  return Array.from(
    tooltip()?.querySelectorAll('.chart__tooltip-row') ?? [],
    (row) =>
      `${row.querySelector('dt')?.textContent ?? ''} ${row.querySelector('dd')?.textContent ?? ''}`,
  );
}

function view(name: string): void {
  fireEvent.click(within(card()).getByRole('radio', { name }));
}

function tableToggle(): HTMLElement {
  return within(card()).getByRole('button', { name: 'Show as table' });
}

/** An element a query must have found. */
function present(element: Element | null | undefined): Element {
  if (element === null || element === undefined) {
    throw new Error('element not found');
  }
  return element;
}

/** Text of each cell of a table row. */
function cells(row: Element | null | undefined): string[] {
  return Array.from(present(row).querySelectorAll('th, td'), (cell) => cell.textContent);
}

/** An en-US table amount back to an engine string ("1,234.50" → "1234.50"). */
function engine(text: string): string {
  return text.replace(/,/g, '');
}

/** A numeric attribute of an element a query must have found. */
function attr(element: Element | null | undefined, name: string): number {
  return Number(present(element).getAttribute(name));
}

function height(): number {
  return attr(svg(), 'height');
}

beforeEach(() => {
  resetForm();
  setLanguage('en');
  resetChartView();
  updateForm({ disbursementDate: '2026-11-01' });
});

afterEach(() => {
  cleanup();
});

describe('ChartCard — payments per loan year (us-mortgage-30y-origination-fee)', () => {
  it('titles the card per view and describes the loan years', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    expect(screen.getByRole('region', { name: "Where each year's payments go" })).toBe(card());
    expect(
      within(card()).getByRole('heading', { level: 3, name: "Where each year's payments go" }),
    ).toBeTruthy();
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe(
      'Loan years 1–30 · 12 payments a year',
    );
    const switcher = within(card()).getByRole('group', { name: 'Chart view' });
    expect(
      within(switcher)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Payments', 'Balance', 'Paid so far']);
    expect(within(switcher).getByRole('radio', { name: 'Payments' })).toHaveProperty(
      'checked',
      true,
    );
    expect(tableToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('is a chart figure named by the title and described by the summary', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    const chart = screen.getByRole('group', {
      name: "Where each year's payments go",
      description:
        'Interest goes from $23,949 in year 1 to $1,001 in year 30, principal from $3,642 to $26,591. Principal first exceeds interest in year 21.',
    });
    expect(chart).toBe(figure());
    expect(chart.getAttribute('aria-roledescription')).toBe('chart');
  });

  it('draws 30 stacked bars named with their exact amounts', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    expect(items()).toHaveLength(30);
    expect(labels().slice(0, 2)).toEqual([
      'Year 1: principal $3,641.84, interest $23,949.16',
      'Year 2: principal $3,900.26, interest $23,690.74',
    ]);
    // Year 30: 11 × 2,299.25 + the final 2,300.28 = 27,592.03, split exactly.
    expect(labels()[29]).toBe('Year 30: principal $26,591.37, interest $1,000.66');
    // Principal at the bottom, interest on top (hatch pattern), no fees segment.
    const segments = item(0).querySelectorAll('.chart__up rect');
    expect(segments).toHaveLength(2);
    expect(segments[0]?.getAttribute('class')).toContain('chart__principal');
    expect(segments[1]?.getAttribute('fill')).toMatch(/^url\(#.+-hatch\)$/);
    expect(attr(segments[1], 'y')).toBeLessThan(attr(segments[0], 'y'));
    // 2 px between the stacked segments.
    expect(
      attr(segments[0], 'y') - (attr(segments[1], 'y') + attr(segments[1], 'height')),
    ).toBeCloseTo(2, 6);
    expect(segments[0]?.getAttribute('rx')).toBe('1.5');
    expect(legend()).toEqual(['Principal', 'Interest']);
  });

  it('marks year 21, where principal overtakes interest, in the gap before its bar', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    expect(annotation()).toBe('Year 21 · principal overtakes interest');
    const line = card().querySelector('.chart__annotation-line');
    const hit20 = item(20).querySelector('.chart__hit');
    expect(attr(line, 'x1')).toBeCloseTo(attr(hit20, 'x'), 6);
    expect(line?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(card().querySelector('.chart__axes')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('labels the y axis in compact currency and the x axis every 5 years', () => {
    loadVector('us-mortgage-30y-origination-fee');
    stubWidth(1280);
    renderCard();
    const ticks = Array.from(card().querySelectorAll('.chart__axes text'), (text) => [
      text.getAttribute('text-anchor'),
      text.textContent,
    ]);
    expect(ticks.filter(([anchor]) => anchor === 'end').map(([, text]) => text)).toEqual([
      '$0',
      '$5K',
      '$10K',
      '$15K',
      '$20K',
      '$25K',
      '$30K',
    ]);
    expect(ticks.filter(([anchor]) => anchor === 'middle').map(([, text]) => text)).toEqual([
      '1',
      '5',
      '10',
      '15',
      '20',
      '25',
      '30',
    ]);
  });
});

describe('ChartCard — other loans', () => {
  it('draws one bar per payment for a loan shorter than 2 years (bullet-monthly-interest-only)', () => {
    loadVector('bullet-monthly-interest-only');
    renderCard();
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Where each payment goes',
    );
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe('12 payments');
    expect(items()).toHaveLength(12);
    expect(labels()[0]).toBe('Payment 1: principal $0.00, interest $1,333.33');
    expect(labels()[11]).toBe('Payment 12: principal $200,000.00, interest $1,333.33');
    // A zero principal draws no segment.
    expect(item(0).querySelectorAll('rect:not(.chart__hit)')).toHaveLength(1);
    expect(annotation()).toBe('Payment 12 · principal overtakes interest');
    expect(figure().querySelector('p')?.textContent).toBe(
      'Interest goes from $1,333 in payment 1 to $1,333 in payment 12, principal from $0 to $200,000. Principal first exceeds interest in payment 12.',
    );
  });

  it('adds a fees and insurance segment and legend entry (equal-principal-quarterly-fees)', () => {
    loadVector('equal-principal-quarterly-fees');
    renderCard();
    expect(items()).toHaveLength(3);
    expect(legend()).toEqual(['Principal', 'Fees and insurance', 'Interest']);
    for (const bar of items()) {
      const segments = bar.querySelectorAll('.chart__up rect');
      expect(segments).toHaveLength(3);
      expect(segments[1]?.getAttribute('class')).toContain('chart__fees');
      expect(bar.getAttribute('aria-label')).toMatch(
        /^Year \d: principal €80,000\.00, fees and insurance €[\d,.]+, interest €[\d,.]+$/,
      );
    }
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe(
      'Loan years 1–3 · 4 payments a year',
    );
    // The line views: a point per loan year, each line from the origin through 3 year ends.
    for (const [name, lines] of [
      ['Balance', 1],
      ['Paid so far', 2],
    ] as const) {
      view(name);
      expect(items()).toHaveLength(3);
      const paths = svg().querySelectorAll('path.chart__line');
      expect(paths).toHaveLength(lines);
      for (const path of paths) {
        expect(path.getAttribute('d')?.match(/[ML]/g)).toHaveLength(4);
      }
    }
  });

  it.each([360, 1280])(
    'keeps 100 year bars and every x label inside a %i px SVG (long-term-1200-payments)',
    (width) => {
      loadVector('long-term-1200-payments');
      stubWidth(width);
      renderCard();
      expect(svg().getAttribute('width')).toBe(String(width));
      expect(items()).toHaveLength(100);
      for (const rect of svg().querySelectorAll('.chart__series rect')) {
        expect(attr(rect, 'x')).toBeGreaterThanOrEqual(0);
        expect(attr(rect, 'x') + attr(rect, 'width')).toBeLessThanOrEqual(width + 1e-9);
      }
      const texts = Array.from(svg().querySelectorAll('.chart__axes text'));
      expect(texts.length).toBeGreaterThan(0);
      let previousEnd = -Infinity;
      for (const text of texts) {
        const labelWidth = estimateTextWidth(text.textContent, LABEL_PX);
        const x = attr(text, 'x');
        const anchor = text.getAttribute('text-anchor');
        const start = anchor === 'end' ? x - labelWidth : x - labelWidth / 2;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + labelWidth).toBeLessThanOrEqual(width);
        if (anchor === 'middle') {
          expect(start).toBeGreaterThan(previousEnd);
          previousEnd = start + labelWidth;
        }
      }
      // The plot keeps the height it has in a 240 or 200 px chart with 12 px labels; the SVG
      // grows with the bands around it (jsdom computes 16 px labels).
      const plotHeight = width >= 640 ? 186 : 146;
      expect(attr(svg().querySelector('.chart__hit'), 'height')).toBe(plotHeight);
      expect(height()).toBeGreaterThan(plotHeight);
      // The line views: 100 points, lines through the origin and 100 year ends, all inside.
      for (const [name, lines] of [
        ['Balance', 1],
        ['Paid so far', 2],
      ] as const) {
        view(name);
        expect(items()).toHaveLength(100);
        const paths = svg().querySelectorAll('path.chart__line');
        expect(paths).toHaveLength(lines);
        for (const path of paths) {
          const vertices = Array.from(
            (path.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g),
            (match) => [Number(match[1]), Number(match[2])] as const,
          );
          expect(vertices).toHaveLength(101);
          for (const [x, y] of vertices) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(height());
          }
        }
        for (const hit of svg().querySelectorAll('.chart__hit')) {
          expect(attr(hit, 'x')).toBeGreaterThanOrEqual(0);
          expect(attr(hit, 'x') + attr(hit, 'width')).toBeLessThanOrEqual(width + 1e-9);
        }
      }
    },
  );

  it('marks year 9 in zh-CN (cn-mortgage-30y-equal-instalments)', () => {
    setLanguage('zh-CN');
    loadVector('cn-mortgage-30y-equal-instalments');
    renderCard();
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe('每年还款的构成');
    expect(annotation()).toBe('第 9 年 · 本金超过利息');
    expect(figure().getAttribute('aria-roledescription')).toBe('图表');
    expect(labels()[0]).toMatch(/^第 1 年：本金 ¥[\d,.]+，利息 ¥[\d,.]+$/);
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe(
      '贷款第 1–30 年 · 每年 12 期',
    );
  });

  it('describes a single payment by its bar', () => {
    updateForm({ termMode: 'payments', termPayments: '1' });
    renderCard();
    expect(items()).toHaveLength(1);
    const label = labels()[0] ?? '';
    expect(label).toMatch(/^Payment 1: principal \$350,000\.00, interest \$[\d,]+\.\d\d$/);
    expect(figure().querySelector('p')?.textContent).toBe(label);
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe('1 payment');
    expect(chartTable.value).toBe(false);
  });

  it('hangs negative segments below the baseline', () => {
    loadVector('daycount-exact-basis-negative-principal');
    renderCard();
    const negative = items().filter((bar) => bar.querySelector('.chart__down') !== null);
    expect(negative.length).toBeGreaterThan(0);
    for (const bar of negative) {
      expect(bar.getAttribute('aria-label')).toContain('principal -');
      const down = bar.querySelector('.chart__down rect');
      const up = bar.querySelector('.chart__up rect');
      expect(attr(down, 'y')).toBeGreaterThanOrEqual(attr(up, 'y') + attr(up, 'height'));
    }
  });
});

describe('ChartCard — views', () => {
  it('shows the balance as a line through every loan year with the payoff marked', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    view('Balance');
    expect(chartView.value).toBe('balance');
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe('Balance over time');
    expect(legend()).toEqual(['Balance']);
    expect(items()).toHaveLength(30);
    expect(labels()[0]).toBe('Year 1: balance $346,358.16');
    expect(labels()[29]).toBe('Year 30: balance $0.00');
    const paths = svg().querySelectorAll('path.chart__line');
    expect(paths).toHaveLength(1);
    // The origin and 30 year ends.
    expect(paths[0]?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(31);
    expect(annotation()).toBe('Paid off Nov 2056');
    expect(svg().querySelector('.chart__payoff')).not.toBeNull();
    expect(figure().querySelector('p')?.textContent).toBe(
      'The balance falls from $350,000 to $0; the loan is paid off in Nov 2056.',
    );
    // No bars and no intro in a line view.
    expect(svg().querySelector('.chart__up')).toBeNull();
  });

  it('shows principal and interest paid so far as two lines, without a crossing for this loan', () => {
    loadVector('us-mortgage-30y-origination-fee');
    renderCard();
    view('Paid so far');
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Principal and interest paid so far',
    );
    expect(legend()).toEqual(['Principal paid', 'Interest paid']);
    expect(items()).toHaveLength(30);
    expect(labels()[0]).toBe('Year 1: principal paid $3,641.84, interest paid $23,949.16');
    expect(labels()[29]).toBe('Year 30: principal paid $350,000.00, interest paid $477,731.03');
    const paths = svg().querySelectorAll('path.chart__line');
    expect(Array.from(paths, (path) => path.getAttribute('class'))).toEqual([
      'chart__line chart__line--principal',
      'chart__line chart__line--interest',
    ]);
    expect(annotation()).toBeNull();
    expect(figure().querySelector('p')?.textContent).toBe(
      'By the last payment, you have paid $350,000 of principal and $477,731 of interest.',
    );
  });

  it('marks the crossing of the cumulative lines when there is one', () => {
    loadVector('cn-mortgage-30y-equal-instalments');
    renderCard();
    view('Paid so far');
    expect(annotation()).toBe('Year 15 · principal paid passes interest paid');
    expect(figure().querySelector('p')?.textContent).toMatch(
      /Principal paid first passes interest paid in year 15\.$/,
    );
  });

  it('draws one point per payment in the line views of a short loan', () => {
    loadVector('bullet-monthly-interest-only');
    renderCard();
    view('Balance');
    expect(items()).toHaveLength(12);
    expect(labels()[0]).toBe('Payment 1: balance $200,000.00');
    view('Paid so far');
    expect(items()).toHaveLength(12);
    expect(annotation()).toBe('Payment 12 · principal paid passes interest paid');
  });

  it('paints the lines, the annotation and the focus ring over the hovered column', async () => {
    /** Whether `later` comes after `earlier` in the SVG, i.e. is painted over it. */
    const paintedOver = (earlier: Element | null, later: Element | null): boolean =>
      (present(earlier).compareDocumentPosition(present(later)) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    renderCard();
    const series = (): Element | null => svg().querySelector('.chart__series');
    expect(paintedOver(series(), svg().querySelector('.chart__annotation'))).toBe(true);
    view('Balance');
    for (const path of svg().querySelectorAll('path.chart__line')) {
      expect(paintedOver(series(), path)).toBe(true);
    }
    expect(paintedOver(series(), svg().querySelector('.chart__annotation'))).toBe(true);
    await act(() => {
      item(29).focus();
    });
    expect(
      paintedOver(svg().querySelector('.chart__annotation'), svg().querySelector('.chart__focus')),
    ).toBe(true);
    view('Paid so far');
    for (const path of svg().querySelectorAll('path.chart__line')) {
      expect(paintedOver(series(), path)).toBe(true);
    }
  });

  it('keeps the view while invalid input blanks the results', async () => {
    renderCard();
    view('Balance');
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(document.querySelector('section.chart')).toBeNull();
    await act(() => {
      setInputInvalid('amount', false);
    });
    expect(within(card()).getByRole('radio', { name: 'Balance' })).toHaveProperty('checked', true);
    expect(legend()).toEqual(['Balance']);
  });
});

describe('ChartCard — keyboard, focus and tooltip', () => {
  it('is one tab stop; arrow keys, Home and End move between the bars', () => {
    renderCard();
    const tabStops = (): number[] =>
      items()
        .map((element, position) => (element.getAttribute('tabindex') === '0' ? position : -1))
        .filter((position) => position >= 0);
    expect(tabStops()).toEqual([0]);
    expect(
      items().every((element) => ['0', '-1'].includes(element.getAttribute('tabindex') ?? '')),
    ).toBe(true);
    item(0).focus();
    fireEvent.keyDown(item(0), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item(1));
    expect(tabStops()).toEqual([1]);
    fireEvent.keyDown(item(1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item(2));
    fireEvent.keyDown(item(2), { key: 'ArrowLeft' });
    fireEvent.keyDown(item(1), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item(0));
    fireEvent.keyDown(item(0), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(item(0));
    fireEvent.keyDown(item(0), { key: 'End' });
    expect(document.activeElement).toBe(item(29));
    expect(tabStops()).toEqual([29]);
    fireEvent.keyDown(item(29), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item(29));
    fireEvent.keyDown(item(29), { key: 'Home' });
    expect(document.activeElement).toBe(item(0));
    // Other keys are left alone.
    const tab = fireEvent.keyDown(item(0), { key: 'Tab' });
    expect(tab).toBe(true);
  });

  it('shows the exact amounts in a tooltip on focus and draws a focus ring; Escape hides it', async () => {
    renderCard();
    const region = card().querySelector('.chart__tooltip-region');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    // Each change is read whole, with the series names, not just the changed amounts.
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    expect(tooltip()).toBeNull();
    await act(() => {
      item(0).focus();
    });
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Year 1 · Dec 2026 – Nov 2027',
    );
    expect(tooltipRows()).toEqual([
      'Principal $3,641.84',
      'Interest $23,949.16',
      'Total $27,591.00',
    ]);
    expect(svg().querySelectorAll('.chart__focus')).toHaveLength(1);
    fireEvent.keyDown(item(0), { key: 'ArrowRight' });
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Year 2 · Dec 2027 – Nov 2028',
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    // Focus stays, and so does its ring.
    expect(document.activeElement).toBe(item(1));
    expect(svg().querySelectorAll('.chart__focus')).toHaveLength(1);
    fireEvent.keyDown(item(1), { key: 'ArrowRight' });
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Year 3 · Dec 2028 – Nov 2029',
    );
    await act(() => {
      item(2).blur();
    });
    expect(tooltip()).toBeNull();
    expect(svg().querySelector('.chart__focus')).toBeNull();
  });

  it('shows the tooltip on hover and hides it when the pointer leaves', () => {
    renderCard();
    // Content moving under a resting pointer fires mouseenter without a move: no tooltip.
    fireEvent.mouseEnter(item(4));
    expect(tooltip()).toBeNull();
    fireEvent.mouseMove(item(4));
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Year 5 · Dec 2030 – Nov 2031',
    );
    expect(tooltipRows()[0]).toBe('Principal $4,790.83');
    expect(document.activeElement).not.toBe(item(4));
    fireEvent.mouseLeave(item(4));
    expect(tooltip()).toBeNull();
    fireEvent.mouseMove(item(6));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    // An item that comes under the resting pointer (the hidden tooltip was over it) does not
    // bring the tooltip back; a move over an item does.
    fireEvent.mouseEnter(item(7));
    expect(tooltip()).toBeNull();
    fireEvent.mouseMove(item(7));
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Year 8 · Dec 2033 – Nov 2034',
    );
    // A click does not move focus into the chart.
    const press = fireEvent.mouseDown(item(7));
    expect(press).toBe(false);
  });

  it('keeps the tooltip while the pointer moves onto it (WCAG 1.4.13), hides it on leaving', () => {
    renderCard();
    const title = (): string | null | undefined =>
      tooltip()?.querySelector('.chart__tooltip-title')?.textContent;
    fireEvent.mouseMove(item(4));
    fireEvent.mouseLeave(item(4), { relatedTarget: tooltip() });
    expect(title()).toBe('Year 5 · Dec 2030 – Nov 2031');
    // Leaving the tooltip for nothing hides it.
    fireEvent.mouseLeave(present(tooltip()), { relatedTarget: document.body });
    expect(tooltip()).toBeNull();
    // Leaving it for a bar hands the tooltip to that bar.
    fireEvent.mouseMove(item(4));
    fireEvent.mouseLeave(item(4), { relatedTarget: tooltip() });
    fireEvent.mouseLeave(present(tooltip()), { relatedTarget: item(6).querySelector('rect') });
    expect(title()).toBe('Year 5 · Dec 2030 – Nov 2031');
    fireEvent.mouseMove(item(6));
    expect(title()).toBe('Year 7 · Dec 2032 – Nov 2033');
  });

  it('lets the keyboard take the tooltip over from a resting pointer, and back', async () => {
    renderCard();
    const title = (): string | null | undefined =>
      tooltip()?.querySelector('.chart__tooltip-title')?.textContent;
    fireEvent.mouseMove(item(4));
    await act(() => {
      item(0).focus();
    });
    expect(title()).toBe('Year 1 · Dec 2026 – Nov 2027');
    fireEvent.keyDown(item(0), { key: 'ArrowRight' });
    expect(title()).toBe('Year 2 · Dec 2027 – Nov 2028');
    // An item coming under a resting pointer (a scroll) does not take it from the keyboard.
    fireEvent.mouseEnter(item(6));
    expect(title()).toBe('Year 2 · Dec 2027 – Nov 2028');
    fireEvent.mouseMove(item(6));
    expect(title()).toBe('Year 7 · Dec 2032 – Nov 2033');
  });

  it('forgets the hover on Escape: no markers stay behind the hidden tooltip', () => {
    renderCard();
    view('Balance');
    fireEvent.mouseMove(item(4));
    expect(svg().querySelectorAll('.chart__marker')).toHaveLength(1);
    fireEvent.mouseLeave(item(4), { relatedTarget: tooltip() });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    expect(svg().querySelector('.chart__marker')).toBeNull();
  });

  it('drops a hover past the last bucket, so a regrown chart does not bring it back', async () => {
    renderCard();
    fireEvent.mouseMove(item(29));
    expect(tooltip()).not.toBeNull();
    // The item goes away with the shorter term without a mouseleave.
    await act(() => {
      updateForm({ termYears: '20' });
    });
    expect(items()).toHaveLength(20);
    expect(tooltip()).toBeNull();
    await act(() => {
      updateForm({ termYears: '30' });
    });
    expect(items()).toHaveLength(30);
    expect(tooltip()).toBeNull();
  });

  it('names the payment and its date in the tooltip of a short loan', () => {
    loadVector('bullet-monthly-interest-only');
    renderCard();
    fireEvent.mouseMove(item(2));
    expect(tooltip()?.querySelector('.chart__tooltip-title')?.textContent).toBe(
      'Payment 3 · Sep 30, 2026',
    );
    expect(tooltipRows()).toEqual(['Principal $0.00', 'Interest $1,333.33', 'Total $1,333.33']);
  });

  it('shows the markers and series of a line point in its tooltip', async () => {
    renderCard();
    view('Paid so far');
    expect(svg().querySelector('.chart__marker')).toBeNull();
    await act(() => {
      item(0).focus();
    });
    expect(svg().querySelectorAll('.chart__marker')).toHaveLength(2);
    expect(svg().querySelectorAll('.chart__focus')).toHaveLength(1);
    expect(tooltipRows()).toEqual(['Principal paid $3,641.84', 'Interest paid $23,949.16']);
    view('Balance');
    fireEvent.mouseMove(item(29));
    expect(tooltipRows()).toEqual(['Balance $0.00']);
  });
});

describe('ChartCard — table alternative', () => {
  it('replaces the chart with a table of the same yearly amounts', () => {
    renderCard();
    fireEvent.click(tableToggle());
    expect(chartTable.value).toBe(true);
    expect(tableToggle().getAttribute('aria-pressed')).toBe('true');
    expect(card().querySelector('figure')).toBeNull();
    expect(card().querySelector('.chart__legend')).toBeNull();
    const table = within(card()).getByRole('table', {
      name: "Where each year's payments go, amounts in USD",
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Loan year', 'Principal', 'Interest', 'Total']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(30);
    expect(cells(rows[0])).toEqual(['Year 1', '3,641.84', '23,949.16', '27,591.00']);
    expect(rows[0]?.querySelector('th')?.getAttribute('scope')).toBe('row');
    expect(
      screen.getByRole('region', { name: "Where each year's payments go, amounts in USD" })
        .tabIndex,
    ).toBe(0);
    // The rows add up to the schedule's totals, exactly.
    const result = okResult.value;
    if (result === null) {
      throw new Error('no result');
    }
    const totals = scheduleTotals(result.rows, 2);
    const column = (index: number): string =>
      sumMoney(
        rows.map((row) => engine(cells(row)[index] ?? '')),
        2,
      );
    expect([column(1), column(2), column(3)]).toEqual([
      totals.principal,
      totals.interest,
      totals.payment,
    ]);
    fireEvent.click(tableToggle());
    expect(card().querySelector('table')).toBeNull();
    expect(card().querySelector('figure')).not.toBeNull();
  });

  it('adds the fees column and adds up to the totals with fees', () => {
    loadVector('equal-principal-quarterly-fees');
    renderCard();
    fireEvent.click(tableToggle());
    const table = within(card()).getByRole('table', {
      name: "Where each year's payments go, amounts in EUR",
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Loan year', 'Principal', 'Fees and insurance', 'Interest', 'Total']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const result = okResult.value;
    if (result === null) {
      throw new Error('no result');
    }
    const totals = scheduleTotals(result.rows, 2);
    const column = (index: number): string =>
      sumMoney(
        rows.map((row) => engine(cells(row)[index] ?? '')),
        2,
      );
    expect([column(1), column(2), column(3), column(4)]).toEqual([
      totals.principal,
      sumMoney([totals.fees, totals.insurance], 2),
      totals.interest,
      totals.payment,
    ]);
  });

  it('lists the balance and the paid-so-far amounts in their views', () => {
    renderCard();
    fireEvent.click(tableToggle());
    view('Balance');
    let table = within(card()).getByRole('table', {
      name: 'Balance over time, amounts in USD',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Loan year', 'Last payment date', 'Balance']);
    const balanceRows = table.querySelectorAll('tbody tr');
    expect(cells(balanceRows[0])).toEqual(['Year 1', 'Nov 1, 2027', '346,358.16']);
    expect(cells(balanceRows[29])).toEqual(['Year 30', 'Nov 1, 2056', '0.00']);
    view('Paid so far');
    table = within(card()).getByRole('table', {
      name: 'Principal and interest paid so far, amounts in USD',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Loan year', 'Principal paid', 'Interest paid']);
    expect(cells(table.querySelectorAll('tbody tr')[29])).toEqual([
      'Year 30',
      '350,000.00',
      '477,731.03',
    ]);
  });

  it('names payments in the table of a short loan', () => {
    loadVector('bullet-monthly-interest-only');
    renderCard();
    fireEvent.click(tableToggle());
    view('Balance');
    const table = within(card()).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Payment number', 'Date', 'Balance']);
    expect(cells(table.querySelectorAll('tbody tr')[0])).toEqual([
      'Payment 1',
      'Jul 31, 2026',
      '200,000.00',
    ]);
  });
});

describe('ChartCard — intro and states', () => {
  it('grows the bars in on the first render only, not after a recalculation', async () => {
    renderCard();
    expect(svg().querySelector('.chart__series--intro')).not.toBeNull();
    await act(() => {
      updateForm({ amount: '300000.00' });
    });
    expect(svg().querySelector('.chart__series')).not.toBeNull();
    expect(svg().querySelector('.chart__series--intro')).toBeNull();
    cleanup();
    renderCard();
    expect(svg().querySelector('.chart__series--intro')).toBeNull();
  });

  it('ends the intro when its animation ends', () => {
    renderCard();
    fireEvent.animationEnd(present(svg().querySelector('.chart__series--intro')));
    expect(svg().querySelector('.chart__series--intro')).toBeNull();
  });

  it('plays the intro when the bars first appear after another view, then never again', () => {
    setChartView('balance');
    renderCard();
    view('Payments');
    // The bars mount for the first time here: this is their first render.
    expect(svg().querySelector('.chart__series--intro')).not.toBeNull();
    view('Balance');
    view('Payments');
    expect(svg().querySelector('.chart__series--intro')).toBeNull();
  });

  it('renders nothing without a valid result', async () => {
    const container = renderCard();
    expect(container.querySelector('svg')).not.toBeNull();
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(container.innerHTML).toBe('');
    await act(() => {
      setInputInvalid('amount', false);
      updateForm({ amount: '0' });
    });
    expect(container.innerHTML).toBe('');
  });

  it('formats its words and numbers in the language of the UI', () => {
    setLanguage('ru');
    renderCard();
    expect(card().querySelector('.chart__subtitle')?.textContent).toBe(
      'Годы кредита 1–30 · 12 платежей в год',
    );
    expect(annotation()).toBe('Год 21 · основной долг больше процентов');
    expect(within(card()).getByRole('button', { name: 'Показать таблицей' })).toBeTruthy();
    expect(labels()[0]?.replace(/\s/gu, ' ')).toBe(
      'Год 1: основной долг 3 641,84 $, проценты 23 949,16 $',
    );
  });
});

describe('ChartCard — ru and uk wording', () => {
  /** The view switch's labels. */
  function switchLabels(): (string | null | undefined)[] {
    return within(card())
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
  }

  it('keeps the view switch short and titles the balance view naturally', () => {
    setLanguage('ru');
    renderCard();
    expect(switchLabels()).toEqual(['Платежи', 'Остаток долга', 'Выплачено']);
    view('Остаток долга');
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Динамика остатка долга',
    );
    cleanup();
    setLanguage('uk');
    renderCard();
    expect(switchLabels()).toEqual(['Платежі', 'Залишок', 'Сплачено']);
    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Динаміка залишку заборгованості',
    );
  });

  it.each([
    ['ru', 'Остаток долга', 'Полное погашение — '],
    ['uk', 'Залишок', 'Повне погашення — '],
  ] as const)(
    'puts the %s payoff date first: its abbreviation period never doubles the full stop',
    (language, name, start) => {
      setLanguage(language);
      renderCard();
      view(name);
      const summary = figure().querySelector('p')?.textContent ?? '';
      expect(summary.startsWith(start)).toBe(true);
      expect(summary).not.toContain('..');
    },
  );

  it('words the ru summaries without an ordinal after "в" (no "в 2-м году")', () => {
    setLanguage('ru');
    renderCard();
    expect(figure().querySelector('p')?.textContent).toMatch(
      / Основной долг впервые больше процентов на 21-м году\.$/,
    );
    cleanup();
    loadVector('bullet-monthly-interest-only');
    renderCard();
    expect(figure().querySelector('p')?.textContent).toMatch(
      / Основной долг впервые больше процентов в платеже № 12\.$/,
    );
    view('Выплачено');
    expect(figure().querySelector('p')?.textContent).toMatch(
      / Выплаченный основной долг впервые превышает выплаченные проценты после платежа № 12\.$/,
    );
    cleanup();
    loadVector('cn-mortgage-30y-equal-instalments');
    renderCard();
    view('Выплачено');
    expect(figure().querySelector('p')?.textContent).toMatch(
      / Выплаченный основной долг впервые превышает выплаченные проценты по итогам 15-го года\.$/,
    );
  });

  it.each([
    ['ru', 'Платёж № 12', 'основного долга выплачено больше, чем процентов'],
    ['uk', 'Платіж № 12', 'основного боргу сплачено більше, ніж процентів'],
  ] as const)(
    'wraps the %s crossing label inside a 360 px SVG, naming principal by its glossary term',
    (language, label, phrase) => {
      setLanguage(language);
      loadVector('bullet-monthly-interest-only');
      stubWidth(360);
      renderCard();
      fireEvent.click(present(within(card()).getAllByRole('radio')[2]));
      const text = present(card().querySelector('.chart__annotation-label'));
      const lines = Array.from(text.querySelectorAll('tspan'), (line) => line.textContent);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toBe(label);
      expect(lines.slice(1).join(' ')).toBe(phrase);
      const x = attr(text, 'x');
      for (const line of lines) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + estimateTextWidth(line, LABEL_PX)).toBeLessThanOrEqual(360);
      }
      // The band above the plot holds the extra lines: the first baseline stays an em down.
      expect(attr(text, 'y')).toBeGreaterThanOrEqual(LABEL_PX);
    },
  );
});

describe('ChartCard — label size', () => {
  afterEach(() => {
    document.getElementById('label-size')?.remove();
  });

  it('lays the axes out for the rendered label size (a larger browser font)', () => {
    const style = document.createElement('style');
    style.id = 'label-size';
    style.textContent = '.chart__tick { font-size: 15px; }';
    document.head.append(style);
    stubWidth(360);
    renderCard();
    const yLabels = Array.from(svg().querySelectorAll('.chart__axes text[text-anchor="end"]'));
    const widest = Math.max(...yLabels.map((text) => estimateTextWidth(text.textContent, 15)));
    for (const text of yLabels) {
      // Right-aligned 6 px left of the plot, the widest label starts inside the SVG.
      expect(attr(text, 'x') - widest).toBeGreaterThanOrEqual(0);
    }
    const left = attr(svg().querySelector('.chart__grid-line'), 'x1');
    expect(left).toBe(Math.ceil(widest) + 8);
  });
});
