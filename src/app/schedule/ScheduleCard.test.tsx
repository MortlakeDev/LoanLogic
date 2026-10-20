// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sumMoney } from '../state/derived';
import { amount } from '../state/display';
import { setLanguage, t } from '../state/i18n';
import {
  type FeeDraft,
  type LoanForm,
  resetForm,
  setInputInvalid,
  updateForm,
} from '../state/loan';
import { ScheduleCard } from './ScheduleCard';
import { resetScheduleView } from './view';

const CAPTION = 'Payment schedule, amounts in USD';

/** The exact-basis loan of SPEC §5.1 whose 31-day months have a negative principal. */
const EXACT_BASIS: Partial<LoanForm> = {
  amount: '100000.00',
  annualRatePct: '30',
  accrualMode: 'daycount',
  dayCount: 'act-360',
  paymentBasis: 'exact',
  fees: [],
};

function fee(kind: FeeDraft['kind'], value: string): FeeDraft {
  return {
    uid: `test-${kind}`,
    name: '',
    kind,
    calc: 'fixed',
    value,
    financing: 'paid',
    inApr: true,
  };
}

function renderCard(): void {
  render(<ScheduleCard />);
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: CAPTION });
}

function list(): HTMLElement {
  return screen.getByRole('list', { name: CAPTION });
}

/** Text of each cell of a row (header and data cells). */
function cells(row: Element | null | undefined): string[] {
  if (row === null || row === undefined) {
    throw new Error('no such row');
  }
  return Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent);
}

function yearBody(year: number): HTMLElement {
  const body = document.getElementById(`schedule-year-${String(year)}`);
  if (body === null) {
    throw new Error(`year ${String(year)} is not rendered`);
  }
  return body;
}

/** Payment rows (rows with a row header) of a year's group. */
function paymentRows(year: number): Element[] {
  return Array.from(yearBody(year).querySelectorAll('tr')).filter(
    (row) => row.querySelector('th[scope="row"]') !== null,
  );
}

function groupRow(year: number): Element {
  const row = yearBody(year).querySelector('.schedule-table__group');
  if (row === null) {
    throw new Error('no group row');
  }
  return row;
}

function toggle(year: number): HTMLElement {
  return within(groupRow(year) as HTMLElement).getByRole('button');
}

/** An en-US table amount back to an engine string ("-1,234.50" → "-1234.50"). */
function engine(text: string): string {
  return text.replace(/,/g, '');
}

/** Opens every year group and the rest of year 1. */
function expandEverything(): void {
  const more = within(table()).queryByRole('button', { name: /more years?$/ });
  if (more !== null) {
    fireEvent.click(more);
  }
  const rest = within(table()).queryByRole('button', { name: /^Show \d+ more payments?$/ });
  if (rest !== null) {
    fireEvent.click(rest);
  }
  for (const button of within(table()).queryAllByRole('button', { expanded: false })) {
    fireEvent.click(button);
  }
}

beforeEach(() => {
  resetForm();
  setLanguage('en');
  resetScheduleView();
  updateForm({ disbursementDate: '2026-11-01' });
});

afterEach(() => {
  cleanup();
});

describe('ScheduleCard — design scenario table', () => {
  it('titles the card and names the columns', () => {
    renderCard();
    expect(screen.getByRole('region', { name: 'Payment schedule' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Payment schedule' })).toBeTruthy();
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      '#Payment number',
      'Date',
      'Payment',
      'Principal',
      'Interest',
      'Balance',
    ]);
    expect(within(table()).getByRole('columnheader', { name: 'Payment number' })).toBeTruthy();
    // The scroll container is a focusable region named by the caption.
    const region = screen.getByRole('region', { name: CAPTION });
    expect(region.tabIndex).toBe(0);
  });

  it('shows year 1 with its subtotals and first six payments', () => {
    renderCard();
    const year1 = within(table()).getByRole('button', { name: 'Year 1 · Dec 2026 – Nov 2027' });
    expect(year1.getAttribute('aria-expanded')).toBe('true');
    expect(year1.getAttribute('aria-controls')).toBe('schedule-year-1');
    expect(cells(groupRow(1))).toEqual([
      'Year 1 · Dec 2026 – Nov 2027',
      '3,641.84',
      '23,949.16',
      '346,358.16',
    ]);
    const rows = paymentRows(1);
    expect(rows).toHaveLength(6);
    expect(cells(rows[0])).toEqual([
      '1',
      'Dec 1, 2026',
      '2,299.25',
      '294.04',
      '2,005.21',
      '349,705.96',
    ]);
    expect(cells(rows[5])).toEqual([
      '6',
      'May 1, 2027',
      '2,299.25',
      '302.56',
      '1,996.69',
      '348,210.29',
    ]);
    // The interest column carries the accent; the row index is muted.
    expect(rows[0]?.querySelectorAll('td')[3]?.classList.contains('schedule__interest')).toBe(true);
    expect(rows[0]?.querySelector('th')?.classList.contains('schedule-table__index')).toBe(true);
  });

  it('reveals the rest of year 1 and moves focus to the first new payment', () => {
    renderCard();
    const more = within(table()).getByRole('button', { name: 'Show 6 more payments' });
    fireEvent.click(more);
    const rows = paymentRows(1);
    expect(rows).toHaveLength(12);
    expect(cells(rows[11]).slice(0, 2)).toEqual(['12', 'Nov 1, 2027']);
    expect(within(table()).queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
    expect(document.activeElement).toBe(rows[6]?.querySelector('th'));
    expect(document.activeElement?.textContent).toBe('7');
  });

  it('collapses and reopens a year with its group button', () => {
    renderCard();
    const year1 = toggle(1);
    year1.focus();
    fireEvent.click(year1);
    expect(year1.getAttribute('aria-expanded')).toBe('false');
    expect(paymentRows(1)).toHaveLength(0);
    // Reopened, year 1 shows all its payments: the toggle acts on the whole year.
    fireEvent.click(year1);
    expect(year1.getAttribute('aria-expanded')).toBe('true');
    expect(paymentRows(1)).toHaveLength(12);
    expect(document.activeElement).toBe(year1);

    const year2 = within(table()).getByRole('button', { name: 'Year 2 · Dec 2027 – Nov 2028' });
    expect(year2.getAttribute('aria-expanded')).toBe('false');
    expect(paymentRows(2)).toHaveLength(0);
    expect(cells(groupRow(2))).toEqual([
      'Year 2 · Dec 2027 – Nov 2028',
      '3,900.26',
      '23,690.74',
      '342,457.90',
    ]);
    fireEvent.click(year2);
    expect(year2.getAttribute('aria-expanded')).toBe('true');
    expect(paymentRows(2)).toHaveLength(12);
    fireEvent.click(year2);
    expect(paymentRows(2)).toHaveLength(0);
  });

  it('shows years 2 and 3 collapsed, then reveals the other 27 years collapsed', () => {
    renderCard();
    const toggles = within(table()).getAllByRole('button', { expanded: false });
    expect(toggles.map((button) => button.textContent)).toEqual([
      'Year 2 · Dec 2027 – Nov 2028',
      'Year 3 · Dec 2028 – Nov 2029',
    ]);
    expect(cells(groupRow(3)).slice(1)).toEqual(['4,176.99', '23,414.01', '338,280.91']);
    expect(document.getElementById('schedule-year-4')).toBeNull();

    fireEvent.click(within(table()).getByRole('button', { name: '27 more years' }));
    expect(within(table()).queryByRole('button', { name: '27 more years' })).toBeNull();
    const year4 = toggle(4);
    expect(year4.textContent).toBe('Year 4 · Dec 2029 – Nov 2030');
    expect(year4.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(year4);
    expect(toggle(30).textContent).toBe('Year 30 · Dec 2055 – Nov 2056');
    expect(cells(groupRow(30)).at(-1)).toBe('0.00');
    expect(within(table()).getAllByRole('button', { expanded: false })).toHaveLength(29);
  });

  it('ends with the totals row and the reconciliation note', () => {
    renderCard();
    const foot = table().querySelector('tfoot tr');
    expect(cells(foot)).toEqual([
      'Total · 360 payments',
      '827,731.03',
      '350,000.00',
      '477,731.03',
      '0.00',
    ]);
    expect(foot?.querySelector('th')?.getAttribute('scope')).toBe('row');
    expect(foot?.lastElementChild?.classList.contains('schedule-table__settled')).toBe(true);
    expect(
      screen.getByText(
        'Every row reconciles to the cent: opening − principal = closing, and principal adds up to $350,000.00.',
      ),
    ).toBeTruthy();
  });

  it('keeps the open years while invalid input blanks the results', async () => {
    renderCard();
    fireEvent.click(toggle(2));
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(screen.queryByRole('table')).toBeNull();
    await act(() => {
      setInputInvalid('amount', false);
    });
    expect(toggle(2).getAttribute('aria-expanded')).toBe('true');
    expect(paymentRows(2)).toHaveLength(12);
  });
});

describe('ScheduleCard — columns and states', () => {
  it('adds a Fees column when a periodic fee is set', () => {
    updateForm({ fees: [fee('periodic', '10.00')] });
    renderCard();
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      '#Payment number',
      'Date',
      'Payment',
      'Principal',
      'Interest',
      'Fees',
      'Balance',
    ]);
    expect(cells(paymentRows(1)[0])).toEqual([
      '1',
      'Dec 1, 2026',
      '2,309.25',
      '294.04',
      '2,005.21',
      '10.00',
      '349,705.96',
    ]);
    // The group row leaves the fee column empty (DESIGN: principal, interest, balance).
    expect(cells(groupRow(1))).toEqual([
      'Year 1 · Dec 2026 – Nov 2027',
      '3,641.84',
      '23,949.16',
      '',
      '346,358.16',
    ]);
    const foot = table().querySelector('tfoot tr');
    expect(cells(foot)).toEqual([
      'Total · 360 payments',
      '831,331.03',
      '350,000.00',
      '477,731.03',
      '3,600.00',
      '0.00',
    ]);
    const more = table().querySelector('.schedule-table__more td');
    expect(more?.getAttribute('colspan')).toBe('7');
    expect(within(list()).getAllByRole('listitem')[0]?.textContent).toContain('Fees 10.00');
  });

  it('adds an Insurance column when insurance is set', () => {
    updateForm({ fees: [fee('insurance', '25.00')] });
    renderCard();
    expect(within(table()).getByRole('columnheader', { name: 'Insurance' })).toBeTruthy();
    expect(within(table()).queryByRole('columnheader', { name: 'Fees' })).toBeNull();
    expect(cells(paymentRows(1)[0])[5]).toBe('25.00');
    expect(within(list()).getAllByRole('listitem')[0]?.textContent).toContain('Insurance 25.00');
  });

  it('renders nothing without a valid result', async () => {
    const { container } = render(<ScheduleCard />);
    expect(container.querySelector('table')).not.toBeNull();
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

  it('shows a short loan in full, with singular plural forms', () => {
    updateForm({ termMode: 'payments', termPayments: '7', fees: [] });
    renderCard();
    expect(paymentRows(1)).toHaveLength(6);
    expect(within(table()).getByRole('button', { name: 'Show 1 more payment' })).toBeTruthy();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show all 7 payments' })).toBeTruthy();

    cleanup();
    updateForm({ termPayments: '1' });
    renderCard();
    expect(paymentRows(1)).toHaveLength(1);
    expect(within(table()).queryByRole('button', { name: /^Show/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
    expect(cells(table().querySelector('tfoot tr'))[0]).toBe('Total · 1 payment');

    cleanup();
    updateForm({ termMode: 'years', termYears: '4' });
    renderCard();
    expect(within(table()).getByRole('button', { name: '1 more year' })).toBeTruthy();
  });

  it('takes its plural forms and number formats from the catalog of the language', () => {
    setLanguage('ru');
    renderCard();
    const ruTable = screen.getByRole('table', {
      name: t('schedule.caption', { currency: 'USD' }),
    });
    expect(
      within(ruTable).getByRole('button', { name: t('schedule.moreYears', { count: 27 }) }),
    ).toBeTruthy();
    expect(
      within(ruTable).getByRole('button', { name: t('schedule.showMore', { count: 6 }) }),
    ).toBeTruthy();
    expect(cells(groupRow(1)).slice(1)).toEqual([
      amount('3641.84'),
      amount('23949.16'),
      amount('346358.16'),
    ]);
    expect(amount('3641.84')).not.toBe('3,641.84');
    expect(cells(ruTable.querySelector('tfoot tr'))[0]).toBe(t('schedule.total', { count: 360 }));
  });
});

describe('ScheduleCard — negative amounts', () => {
  it('shows a negative principal of the exact payment basis with a minus sign', () => {
    updateForm(EXACT_BASIS);
    renderCard();
    const row2 = cells(paymentRows(1)[1]);
    expect(row2).toEqual(['2', 'Jan 1, 2027', '2,535.75', '-46.66', '2,582.41', '100,010.91']);
    const item2 = within(list()).getAllByRole('listitem')[1];
    expect(item2?.textContent).toContain('Principal -46.66');
    expect(item2?.textContent).toContain('Balance 100,010.91');
  });

  it('shows a negative payment of a negative rate with a minus sign', () => {
    updateForm({
      amount: '100000.00',
      annualRatePct: '-1',
      repayment: 'bullet',
      termYears: '2',
      fees: [],
    });
    renderCard();
    expect(cells(paymentRows(1)[0]).slice(2, 5)).toEqual(['-83.33', '0.00', '-83.33']);
    expect(within(list()).getAllByRole('listitem')[0]?.textContent).toContain('-$83.33');
  });
});

describe('ScheduleCard — subtotals are exact sums of the rows', () => {
  const scenarios: [string, Partial<LoanForm>, number][] = [
    ['design scenario, monthly', {}, 12],
    ['weekly, 52-payment years', { frequency: 'weekly', termYears: '3' }, 52],
    [
      'equal principal, quarterly, with fees and insurance',
      {
        repayment: 'equal-principal',
        frequency: 'quarterly',
        termYears: '10',
        fees: [fee('periodic', '7.50'), fee('insurance', '3.25')],
      },
      4,
    ],
    ['exact payment basis with negative principal', EXACT_BASIS, 12],
  ];

  it.each(scenarios)('%s', (_name, patch, perYear) => {
    updateForm(patch);
    renderCard();
    expandEverything();
    const years = table().querySelectorAll('tbody[id^="schedule-year-"]');
    const all: string[][] = [];
    for (let year = 1; year <= years.length; year += 1) {
      const rows = paymentRows(year).map((row) => cells(row).map(engine));
      if (year < years.length) {
        expect(rows).toHaveLength(perYear);
      }
      all.push(...rows);
      // Group cells: label, principal, interest, (empty fee cells), closing.
      const group = cells(groupRow(year)).map(engine);
      expect(group[1]).toBe(
        sumMoney(
          rows.map((row) => row[3] ?? ''),
          2,
        ),
      );
      expect(group[2]).toBe(
        sumMoney(
          rows.map((row) => row[4] ?? ''),
          2,
        ),
      );
      expect(group.at(-1)).toBe(rows.at(-1)?.at(-1));
    }
    const totals = cells(table().querySelector('tfoot tr')).map(engine);
    expect(all).toHaveLength(Number(/\d+/.exec(totals[0] ?? '')?.[0]));
    // Every money column of the totals row is the exact sum of that column.
    for (let column = 2; column <= totals.length; column += 1) {
      const expected =
        column === totals.length
          ? (all.at(-1)?.[column] ?? '')
          : sumMoney(
              all.map((row) => row[column] ?? ''),
              2,
            );
      expect(totals[column - 1]).toBe(expected);
    }
  });
});

describe('ScheduleCard — mobile list', () => {
  it('lists the first six payments and reveals all of them', () => {
    renderCard();
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    const first = items[0];
    expect(first?.textContent).toContain('No. 1 · Dec 1, 2026');
    expect(first?.textContent).toContain('Balance 349,705.96');
    expect(first?.textContent).toContain('$2,299.25');
    expect(first?.textContent).toContain('Principal 294.04 · Interest 2,005.21');
    expect(first?.querySelector('.schedule__interest')?.textContent).toBe('2,005.21');

    fireEvent.click(screen.getByRole('button', { name: 'Show all 360 payments' }));
    const all = within(list()).getAllByRole('listitem');
    expect(all).toHaveLength(360);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
    expect(document.activeElement).toBe(all[6]);
    expect(all[6]?.textContent).toContain('No. 7 · Jun 1, 2027');
    expect(all[359]?.textContent).toContain('$2,300.28');
  });

  it('switches to a yearly summary', () => {
    renderCard();
    const toggleButton = screen.getByRole('button', { name: 'Yearly summary' });
    expect(toggleButton.getAttribute('aria-pressed')).toBe('false');
    expect(toggleButton.getAttribute('aria-controls')).toBe('schedule-list');
    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute('aria-pressed')).toBe('true');
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(30);
    const first = items[0]?.textContent ?? '';
    expect(first).toContain('Year 1 · Dec 2026 – Nov 2027');
    expect(first).toContain('Balance 346,358.16');
    expect(first).toContain('Paid $27,591.00');
    expect(first).toContain('Principal 3,641.84 · Interest 23,949.16');
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();

    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute('aria-pressed')).toBe('false');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(6);
  });
});
