// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FREQUENCY_IDS,
  type FrequencyId,
  type LedgerRow,
  type LoanResult,
  type LoanSummary,
  calculateLoan,
} from '../../engine';
import {
  costStructure,
  durationOf,
  fromMinor,
  includedFees,
  periodsPerYear,
  scheduleTotals,
  scheduleYears,
  sumMoney,
  toMinor,
} from './derived';
import { type LoanForm, defaultForm, toLoanInput } from './loan';

type OkResult = Extract<LoanResult, { ok: true }>;

/** The design scenario, disbursed 2026-11-01, with some fields changed; must calculate. */
function calculate(patch: Partial<LoanForm> = {}): OkResult {
  const result = calculateLoan(toLoanInput({ ...defaultForm('2026-11-01'), ...patch }));
  if (!result.ok) {
    throw new Error(`scenario rejected: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

/** The exact sum of decimal strings, independent of `derived.ts`. */
function exactSum(values: readonly string[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

function rowAt(rows: readonly LedgerRow[], index: number): LedgerRow {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`no row ${String(index)}`);
  }
  return row;
}

describe('periodsPerYear', () => {
  it.each([
    ['weekly', 52],
    ['biweekly', 26],
    ['monthly', 12],
    ['quarterly', 4],
    ['semiannual', 2],
    ['annual', 1],
  ] as const)('%s → %i', (frequency, m) => {
    expect(periodsPerYear(frequency)).toBe(m);
  });
});

describe('toMinor / fromMinor', () => {
  it.each([
    ['1234.50', 2, 123450n],
    ['1234.5', 2, 123450n],
    ['1234', 2, 123400n],
    ['0.05', 2, 5n],
    ['-0.05', 2, -5n],
    ['-1234.56', 2, -123456n],
    ['0.00', 2, 0n],
    ['-0.00', 2, 0n],
    ['4270', 0, 4270n],
    ['-4270', 0, -4270n],
    ['1.234', 3, 1234n],
    ['-0.001', 3, -1n],
    ['12.3456', 4, 123456n],
  ] as const)('toMinor(%s, %i) = %s', (value, digits, units) => {
    expect(toMinor(value, digits)).toBe(units);
  });

  it.each([
    [123450n, 2, '1234.50'],
    [5n, 2, '0.05'],
    [-5n, 2, '-0.05'],
    [0n, 2, '0.00'],
    [-0n, 2, '0.00'],
    [4270n, 0, '4270'],
    [-4270n, 0, '-4270'],
    [0n, 0, '0'],
    [1n, 3, '0.001'],
    [-1234n, 3, '-1.234'],
    [-123n, 4, '-0.0123'],
    [0n, 4, '0.0000'],
  ] as const)('fromMinor(%s, %i) = %s', (units, digits, text) => {
    expect(fromMinor(units, digits)).toBe(text);
  });

  const digitsArbitrary = fc.constantFrom(0, 2, 3, 4);
  const unitsArbitrary = fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n });

  it('round-trips any count of minor units (property)', () => {
    fc.assert(
      fc.property(unitsArbitrary, digitsArbitrary, (units, digits) => {
        expect(toMinor(fromMinor(units, digits), digits)).toBe(units);
      }),
    );
  });

  it('writes canonical engine strings, signed only when negative, never "-0" (property)', () => {
    fc.assert(
      fc.property(unitsArbitrary, digitsArbitrary, (units, digits) => {
        const text = fromMinor(units, digits);
        const pattern =
          digits === 0
            ? /^-?(0|[1-9]\d*)$/
            : new RegExp(`^-?(0|[1-9]\\d*)\\.\\d{${String(digits)}}$`);
        expect(text).toMatch(pattern);
        expect(text.startsWith('-')).toBe(units < 0n);
        expect(fromMinor(toMinor(text, digits), digits)).toBe(text);
      }),
    );
  });
});

describe('sumMoney', () => {
  it('adds exactly, with negative values and zero', () => {
    expect(sumMoney(['0.10', '0.20', '-0.05'], 2)).toBe('0.25');
    expect(sumMoney(['-1.00', '0.40'], 2)).toBe('-0.60');
    expect(sumMoney(['1.00', '-1.00'], 2)).toBe('0.00');
    expect(sumMoney([], 2)).toBe('0.00');
    expect(sumMoney([], 0)).toBe('0');
    expect(sumMoney(['999999999999999.99', '0.01'], 2)).toBe('1000000000000000.00');
  });
});

describe('scheduleYears', () => {
  it('groups a weekly loan by payment number, 52 rows per loan year', () => {
    const result = calculate({ frequency: 'weekly', termYears: '2' });
    const years = scheduleYears(result.rows, 'weekly', 2);
    expect(result.rows).toHaveLength(104);
    expect(years.map((year) => year.rows.length)).toEqual([52, 52]);
    expect(years.map((year) => year.year)).toEqual([1, 2]);
    expect(years[1]?.rows[0]?.index).toBe(53);
  });

  it('gives a 30-month monthly loan 3 groups, the last with 6 rows', () => {
    const result = calculate({ termYears: '2', termMonths: '6' });
    const years = scheduleYears(result.rows, 'monthly', 2);
    expect(years.map((year) => year.rows.length)).toEqual([12, 12, 6]);
    const last = years[2];
    expect(last?.firstDate).toBe(rowAt(result.rows, 24).date);
    expect(last?.lastDate).toBe(rowAt(result.rows, 29).date);
    expect(last?.closing).toBe('0.00');
  });

  it('gives the design scenario its year 1 subtotals (golden vector figures)', () => {
    const result = calculate();
    const [first] = scheduleYears(result.rows, 'monthly', 2);
    expect(first?.principal).toBe('3641.84');
    expect(first?.interest).toBe('23949.16');
    expect(first?.firstDate).toBe('2026-12-01');
    expect(first?.lastDate).toBe('2027-11-01');
    expect(first?.closing).toBe(rowAt(result.rows, 11).closing);
  });

  it('returns no groups for no rows', () => {
    expect(scheduleYears([], 'monthly', 2)).toEqual([]);
  });

  it('makes every subtotal the exact sum of its rows (property over engine scenarios)', () => {
    const scenario = fc.record({
      frequency: fc.constantFrom(...FREQUENCY_IDS),
      termYears: fc.integer({ min: 0, max: 4 }),
      termMonths: fc.integer({ min: 0, max: 11 }),
      repayment: fc.constantFrom('annuity', 'equal-principal', 'bullet', 'balloon'),
      annualRatePct: fc.constantFrom('6.875', '0', '-1.5', '12.25'),
      currency: fc.constantFrom('USD', 'JPY', 'KWD'),
    });
    fc.assert(
      fc.property(scenario, (input) => {
        const digits = input.currency === 'JPY' ? 0 : input.currency === 'KWD' ? 3 : 2;
        const form: LoanForm = {
          ...defaultForm('2026-11-01'),
          currency: input.currency,
          amount: input.currency === 'JPY' ? '3500000' : '35000.00',
          annualRatePct: input.annualRatePct,
          frequency: input.frequency,
          repayment: input.repayment,
          termYears: String(input.termYears),
          termMonths: String(input.termMonths),
          fees: [
            ...defaultForm('2026-11-01').fees,
            {
              uid: 'monthly-fee',
              name: '',
              kind: 'periodic',
              calc: 'fixed',
              value: '5',
              financing: 'paid',
              inApr: true,
            },
            {
              uid: 'cover',
              name: '',
              kind: 'insurance',
              calc: 'pct-balance',
              value: '0.01',
              financing: 'paid',
              inApr: false,
            },
          ],
        };
        const result = calculateLoan(toLoanInput(form));
        fc.pre(result.ok);
        const years = scheduleYears(result.rows, input.frequency, digits);
        const m = periodsPerYear(input.frequency);
        expect(years.flatMap((year) => year.rows)).toEqual(result.rows);
        for (const year of years) {
          expect(year.rows.length).toBeLessThanOrEqual(m);
          expect(year.rows[0]?.index).toBe((year.year - 1) * m + 1);
          const sums: [string, (row: LedgerRow) => string][] = [
            [year.payment, (row) => row.payment],
            [year.principal, (row) => row.principal],
            [year.interest, (row) => row.interestPaid],
            [year.fees, (row) => row.fees],
            [year.insurance, (row) => row.insurance],
          ];
          for (const [subtotal, pick] of sums) {
            expect(new Decimal(subtotal).equals(exactSum(year.rows.map(pick)))).toBe(true);
            expect(subtotal).toMatch(digits === 0 ? /^-?\d+$/ : /^-?\d+\.\d+$/);
          }
        }
        const totals = scheduleTotals(result.rows, digits);
        expect(totals.count).toBe(result.rows.length);
        expect(totals.payment).toBe(
          sumMoney(
            years.map((year) => year.payment),
            digits,
          ),
        );
        expect(totals.interest).toBe(
          sumMoney(
            years.map((year) => year.interest),
            digits,
          ),
        );
        expect(totals.principal).toBe(
          sumMoney(
            years.map((year) => year.principal),
            digits,
          ),
        );
        expect(totals.fees).toBe(
          sumMoney(
            years.map((year) => year.fees),
            digits,
          ),
        );
        expect(totals.insurance).toBe(
          sumMoney(
            years.map((year) => year.insurance),
            digits,
          ),
        );
        expect(totals.payment).toBe(result.summary.totalPayments);
        expect(totals.interest).toBe(result.summary.totalInterest);
      }),
      { numRuns: 40 },
    );
  });
});

describe('scheduleTotals', () => {
  it('totals the design scenario', () => {
    const result = calculate();
    expect(scheduleTotals(result.rows, 2)).toEqual({
      count: 360,
      payment: '827731.03',
      principal: '350000.00',
      interest: '477731.03',
      fees: '0.00',
      insurance: '0.00',
      closing: '0.00',
    });
  });

  it('totals no rows as zeros at the minor units', () => {
    expect(scheduleTotals([], 2)).toEqual({
      count: 0,
      payment: '0.00',
      principal: '0.00',
      interest: '0.00',
      fees: '0.00',
      insurance: '0.00',
      closing: '0.00',
    });
    expect(scheduleTotals([], 0).closing).toBe('0');
  });
});

/** A summary with only the cost-structure fields changed. */
function summaryWith(fields: Partial<LoanSummary>): LoanSummary {
  return { ...calculate().summary, ...fields };
}

describe('costStructure (DESIGN §8.9)', () => {
  it('splits the design scenario into principal, interest and fees', () => {
    const cost = costStructure(calculate().summary, 2);
    expect(cost.parts.map((part) => part.key)).toEqual(['principal', 'interest', 'fees']);
    expect(cost.parts.map((part) => part.amount)).toEqual(['350000.00', '477731.03', '3500.00']);
    expect(cost.parts.map((part) => part.share)).toEqual(['0.421', '0.575', '0.004']);
    expect(cost.total).toBe('831231.03');
    expect(cost.ratio).toBe('2.37');
    const widths = cost.parts.map((part) => part.width);
    expect(widths.every((width) => width > 0 && width < 1)).toBe(true);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1, 3);
  });

  it('keeps negative interest negative and gives it no bar width', () => {
    const result = calculate({ annualRatePct: '-1' });
    const cost = costStructure(result.summary, 2);
    const interest = cost.parts.find((part) => part.key === 'interest');
    expect(interest?.amount).toBe(result.summary.totalInterest);
    expect(interest?.amount.startsWith('-')).toBe(true);
    expect(interest?.share.startsWith('-')).toBe(true);
    expect(interest?.width).toBe(0);
    const widths = cost.parts.map((part) => part.width);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1, 3);
    expect(Number(cost.ratio)).toBeLessThan(1);
  });

  it('gives the ratio 2 decimals in a currency without minor units', () => {
    const result = calculate({ currency: 'JPY', amount: '35000000' });
    const cost = costStructure(result.summary, 0);
    expect(cost.ratio).toMatch(/^\d+\.\d{2}$/);
    expect(cost.total).toMatch(/^\d+$/);
    expect(cost.parts[0]?.amount).toBe('35000000');
  });

  it('rounds the ratio and shares half away from zero', () => {
    const half = costStructure(
      summaryWith({
        amount: '200.00',
        totalInterest: '273.00',
        totalFees: '0.00',
        totalInsurance: '0.00',
        totalPaid: '473.00',
      }),
      2,
    );
    expect(half.ratio).toBe('2.37');
    expect(half.parts.map((part) => part.share)).toEqual(['0.423', '0.577', '0.000']);
    const negative = costStructure(
      summaryWith({
        amount: '200.00',
        totalInterest: '-673.00',
        totalFees: '0.00',
        totalInsurance: '0.00',
        totalPaid: '-473.00',
      }),
      2,
    );
    expect(negative.ratio).toBe('-2.37');
    expect(negative.parts.map((part) => part.share)).toEqual(['-0.423', '1.423', '0.000']);
  });

  it('counts fees and insurance together', () => {
    const cost = costStructure(
      summaryWith({
        amount: '1000.00',
        totalInterest: '100.00',
        totalFees: '30.00',
        totalInsurance: '20.00',
        totalPaid: '1150.00',
      }),
      2,
    );
    expect(cost.parts[2]?.amount).toBe('50.00');
  });

  it('shows an all-zero summary as zero shares, widths and ratio', () => {
    const cost = costStructure(
      summaryWith({
        amount: '0.00',
        totalInterest: '0.00',
        totalFees: '0.00',
        totalInsurance: '0.00',
        totalPaid: '0.00',
      }),
      2,
    );
    expect(cost.parts.map((part) => [part.share, part.width])).toEqual([
      ['0.000', 0],
      ['0.000', 0],
      ['0.000', 0],
    ]);
    expect(cost.ratio).toBe('0.00');
    expect(cost.total).toBe('0.00');
  });
});

describe('includedFees', () => {
  it('lists the fees included in the rate with their exact total', () => {
    const result = calculate({
      fees: [
        ...defaultForm('2026-11-01').fees,
        {
          uid: 'service',
          name: '',
          kind: 'periodic',
          calc: 'fixed',
          value: '10',
          financing: 'paid',
          inApr: true,
        },
        {
          uid: 'cover',
          name: '',
          kind: 'insurance',
          calc: 'fixed',
          value: '25',
          financing: 'paid',
          inApr: false,
        },
      ],
    });
    const included = new Set(['service', result.fees[0]?.id]);
    const fees = includedFees(result.fees, (id) => included.has(id), 2);
    expect(fees.items.map((fee) => fee.id)).toEqual([result.fees[0]?.id, 'service']);
    expect(fees.total).toBe('7100.00');
  });

  it('is empty with a zero total when nothing is included', () => {
    const result = calculate();
    expect(includedFees(result.fees, () => false, 2)).toEqual({ items: [], total: '0.00' });
    expect(includedFees([], () => true, 0)).toEqual({ items: [], total: '0' });
  });
});

describe('durationOf', () => {
  it.each([
    [360, 'monthly', { years: 30, months: 0 }],
    [30, 'monthly', { years: 2, months: 6 }],
    [1, 'monthly', { years: 0, months: 1 }],
    [10, 'quarterly', { years: 2, months: 6 }],
    [3, 'semiannual', { years: 1, months: 6 }],
    [5, 'annual', { years: 5, months: 0 }],
    [104, 'weekly', { years: 2, months: 0 }],
    [52, 'biweekly', { years: 2, months: 0 }],
  ] as const)('%i %s payments → %o', (payments, frequency, duration) => {
    expect(durationOf(payments, frequency)).toEqual(duration);
  });

  it.each([
    [100, 'weekly'],
    [30, 'weekly'],
    [27, 'biweekly'],
  ] as [number, FrequencyId][])(
    '%i %s payments do not fill whole months → null',
    (payments, frequency) => {
      expect(durationOf(payments, frequency)).toBeNull();
    },
  );
});
