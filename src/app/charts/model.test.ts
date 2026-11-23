// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FREQUENCY_IDS,
  type FrequencyId,
  type LedgerRow,
  type LoanResult,
  calculateLoan,
  minorUnits,
} from '../../engine';
import { scheduleTotals, sumMoney, toMinor } from '../state/derived';
import { type LoanForm, defaultForm, toLoanInput } from '../state/loan';
import {
  CHART_VIEWS,
  type ChartBucket,
  type ChartData,
  barRects,
  chartBuckets,
  cumulativeCrossing,
  lineSeries,
  principalOvertakes,
  seriesOf,
  stackBar,
  stackKeys,
  valueExtent,
} from './model';
import { linearScale } from './scale';

type OkResult = Extract<LoanResult, { ok: true }>;

/** The design scenario, disbursed 2026-11-01, with some fields changed; must calculate. */
function calculate(patch: Partial<LoanForm> = {}): OkResult {
  const result = calculateLoan(toLoanInput({ ...defaultForm('2026-11-01'), ...patch }));
  if (!result.ok) {
    throw new Error(`scenario rejected: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

interface LoanVector {
  readonly id: string;
  readonly kind: 'loan' | 'cashflows';
  readonly input: { readonly currency: string; readonly frequency: FrequencyId };
  readonly expected: { readonly ok: boolean };
}

const FILES = import.meta.glob<LoanVector>('../../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

/** The golden loan vectors that calculate, by id. */
const LOAN_VECTORS: ReadonlyMap<string, LoanVector> = new Map(
  Object.values(FILES)
    .filter((vector) => vector.kind === 'loan' && vector.expected.ok)
    .map((vector) => [vector.id, vector]),
);

interface VectorLoan {
  readonly rows: readonly LedgerRow[];
  readonly frequency: FrequencyId;
  readonly digits: number;
}

/** A golden vector's loan computed through the public engine API. */
function vectorLoan(id: string): VectorLoan {
  const vector = LOAN_VECTORS.get(id);
  if (vector === undefined) {
    throw new Error(`no loan vector ${id}`);
  }
  const result = calculateLoan(vector.input);
  if (!result.ok) {
    throw new Error(`vector ${id} rejected`);
  }
  return {
    rows: result.rows,
    frequency: vector.input.frequency,
    digits: minorUnits(vector.input.currency) ?? 2,
  };
}

function vectorData(id: string): ChartData & { readonly digits: number } {
  const loan = vectorLoan(id);
  return { ...chartBuckets(loan.rows, loan.frequency, loan.digits), digits: loan.digits };
}

/** A hand-made bucket: label `index`, given amounts, the rest zero. */
function bucket(index: number, amounts: Partial<ChartBucket> = {}): ChartBucket {
  return {
    index,
    firstDate: '2027-01-01',
    lastDate: '2027-12-01',
    principal: '0.00',
    interest: '0.00',
    fees: '0.00',
    total: '0.00',
    closing: '0.00',
    cumulativePrincipal: '0.00',
    cumulativeInterest: '0.00',
    ...amounts,
  };
}

function at<T>(items: readonly T[], position: number): T {
  const item = items[position];
  if (item === undefined) {
    throw new Error(`nothing at ${String(position)}`);
  }
  return item;
}

/**
 * The checks every chart model must pass against its schedule: the buckets add up to the
 * schedule totals exactly, each bucket's segments add up to its payments, and the running
 * totals and balances are the engine's.
 */
function expectReconciles(data: ChartData, rows: readonly LedgerRow[], digits: number): void {
  const totals = scheduleTotals(rows, digits);
  const sum = (pick: (item: ChartBucket) => string): string =>
    sumMoney(data.buckets.map(pick), digits);
  expect(sum((item) => item.principal)).toBe(totals.principal);
  expect(sum((item) => item.interest)).toBe(totals.interest);
  expect(sum((item) => item.fees)).toBe(sumMoney([totals.fees, totals.insurance], digits));
  expect(sum((item) => item.total)).toBe(totals.payment);
  data.buckets.forEach((item, position) => {
    expect(item.index).toBe(position + 1);
    expect(sumMoney([item.principal, item.interest, item.fees], digits)).toBe(item.total);
  });
  const last = at(data.buckets, data.buckets.length - 1);
  const lastRow = at(rows, rows.length - 1);
  expect(last.closing).toBe(totals.closing);
  expect(last.lastDate).toBe(lastRow.date);
  expect(last.cumulativePrincipal).toBe(lastRow.cumulativePrincipal);
  expect(last.cumulativeInterest).toBe(lastRow.cumulativeInterest);
  expect(data.origin.balance).toBe(at(rows, 0).opening);
  expect(data.hasFees).toBe(
    toMinor(totals.fees, digits) + toMinor(totals.insurance, digits) !== 0n,
  );
}

describe('chartBuckets', () => {
  it('groups the design scenario into 30 loan years with exact sums', () => {
    const result = calculate();
    const data = chartBuckets(result.rows, 'monthly', 2);
    expect(data.unit).toBe('year');
    expect(data.periodsPerYear).toBe(12);
    expect(data.buckets).toHaveLength(30);
    expect(data.hasFees).toBe(false);
    const first = at(data.buckets, 0);
    expect(first).toEqual({
      index: 1,
      firstDate: '2026-12-01',
      lastDate: '2027-11-01',
      principal: '3641.84',
      interest: '23949.16',
      fees: '0.00',
      total: '27591.00',
      closing: at(result.rows, 11).closing,
      cumulativePrincipal: at(result.rows, 11).cumulativePrincipal,
      cumulativeInterest: '23949.16',
    });
    expect(data.origin).toEqual({
      balance: '350000.00',
      cumulativePrincipal: '0.00',
      cumulativeInterest: '0.00',
    });
    expectReconciles(data, result.rows, 2);
  });

  it('switches to loan years at exactly 2·m payments', () => {
    const years = chartBuckets(calculate({ termYears: '2' }).rows, 'monthly', 2);
    expect(years.unit).toBe('year');
    expect(years.buckets).toHaveLength(2);

    const result = calculate({ termYears: '1', termMonths: '11' });
    const payments = chartBuckets(result.rows, 'monthly', 2);
    expect(payments.unit).toBe('payment');
    expect(payments.buckets).toHaveLength(23);
    const row = at(result.rows, 4);
    expect(at(payments.buckets, 4)).toEqual({
      index: 5,
      firstDate: row.date,
      lastDate: row.date,
      principal: row.principal,
      interest: row.interestPaid,
      fees: '0.00',
      total: row.payment,
      closing: row.closing,
      cumulativePrincipal: row.cumulativePrincipal,
      cumulativeInterest: row.cumulativeInterest,
    });
    expectReconciles(payments, result.rows, 2);
  });

  it.each([
    ['weekly', 104, 'year', 2],
    ['weekly', 103, 'payment', 103],
    ['annual', 2, 'year', 2],
    ['annual', 1, 'payment', 1],
  ] as const)('%s with %i payments → %s (%i buckets)', (frequency, count, unit, length) => {
    const result = calculate({
      frequency,
      termMode: 'payments',
      termPayments: String(count),
      termYears: '0',
    });
    const data = chartBuckets(result.rows, frequency, 2);
    expect(data.unit).toBe(unit);
    expect(data.buckets).toHaveLength(length);
    expectReconciles(data, result.rows, 2);
  });

  it('adds fees and insurance into one segment and marks the loan as having fees', () => {
    const result = calculate({
      termYears: '3',
      fees: [
        {
          uid: 'f',
          name: '',
          kind: 'periodic',
          calc: 'fixed',
          value: '5',
          financing: 'paid',
          inApr: true,
        },
        {
          uid: 'i',
          name: '',
          kind: 'insurance',
          calc: 'fixed',
          value: '2.50',
          financing: 'paid',
          inApr: false,
        },
      ],
    });
    const data = chartBuckets(result.rows, 'monthly', 2);
    expect(data.hasFees).toBe(true);
    expect(at(data.buckets, 0).fees).toBe('90.00');
    expectReconciles(data, result.rows, 2);
  });

  it('rejects a schedule without rows', () => {
    expect(() => chartBuckets([], 'monthly', 2)).toThrow(RangeError);
  });

  it('reconciles with the schedule totals exactly (property over engine scenarios)', () => {
    const scenario = fc.record({
      frequency: fc.constantFrom(...FREQUENCY_IDS),
      termYears: fc.integer({ min: 0, max: 4 }),
      termMonths: fc.integer({ min: 0, max: 11 }),
      repayment: fc.constantFrom('annuity', 'equal-principal', 'bullet', 'balloon'),
      annualRatePct: fc.constantFrom('6.875', '0', '-1.5', '12.25'),
      currency: fc.constantFrom('USD', 'JPY', 'KWD'),
      charged: fc.boolean(),
    });
    fc.assert(
      fc.property(scenario, (input) => {
        const digits = input.currency === 'JPY' ? 0 : input.currency === 'KWD' ? 3 : 2;
        const base = defaultForm('2026-11-01');
        const form: LoanForm = {
          ...base,
          currency: input.currency,
          amount: input.currency === 'JPY' ? '3500000' : '35000.00',
          annualRatePct: input.annualRatePct,
          frequency: input.frequency,
          repayment: input.repayment,
          termYears: String(input.termYears),
          termMonths: String(input.termMonths),
          fees: input.charged
            ? [
                ...base.fees,
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
              ]
            : base.fees,
        };
        const result = calculateLoan(toLoanInput(form));
        fc.pre(result.ok);
        const data = chartBuckets(result.rows, input.frequency, digits);
        expect(data.unit).toBe(result.rows.length >= 2 * data.periodsPerYear ? 'year' : 'payment');
        expectReconciles(data, result.rows, digits);
      }),
    );
  });

  it('reconciles every golden loan vector, with at most 100 loan years', () => {
    expect(LOAN_VECTORS.size).toBeGreaterThan(50);
    for (const id of LOAN_VECTORS.keys()) {
      const loan = vectorLoan(id);
      const data = chartBuckets(loan.rows, loan.frequency, loan.digits);
      expectReconciles(data, loan.rows, loan.digits);
      if (data.unit === 'year') {
        expect(data.buckets.length).toBeLessThanOrEqual(100);
      }
    }
    expect(vectorData('long-term-1200-payments').buckets).toHaveLength(100);
  });
});

describe('principalOvertakes', () => {
  it('finds the US design vector in year 21', () => {
    const data = vectorData('us-mortgage-30y-origination-fee');
    const position = principalOvertakes(data.buckets, data.digits);
    expect(position).toBe(20);
    expect(at(data.buckets, 20).index).toBe(21);
  });

  it('finds the Chinese equal-instalment mortgage in year 9', () => {
    const data = vectorData('cn-mortgage-30y-equal-instalments');
    expect(principalOvertakes(data.buckets, data.digits)).toBe(8);
  });

  it('annotates the first bucket when principal leads from the start', () => {
    const data = vectorData('cn-mortgage-30y-equal-principal');
    expect(principalOvertakes(data.buckets, data.digits)).toBe(0);
  });

  it('annotates the last payment of an interest-only loan', () => {
    const data = vectorData('bullet-monthly-interest-only');
    expect(data.unit).toBe('payment');
    expect(principalOvertakes(data.buckets, data.digits)).toBe(11);
  });

  it('needs principal strictly above interest, compared exactly', () => {
    const buckets = [
      bucket(1, { principal: '100.00', interest: '100.01' }),
      bucket(2, { principal: '100.01', interest: '100.01' }),
      bucket(3, { principal: '100.02', interest: '100.01' }),
    ];
    expect(principalOvertakes(buckets, 2)).toBe(2);
    expect(principalOvertakes(buckets.slice(0, 2), 2)).toBeNull();
    expect(principalOvertakes([], 2)).toBeNull();
  });

  it('compares negative amounts by value', () => {
    expect(
      principalOvertakes(
        [
          bucket(1, { principal: '-48.42', interest: '2583.33' }),
          bucket(2, { principal: '-5.00', interest: '-6.00' }),
        ],
        2,
      ),
    ).toBe(1);
  });
});

describe('cumulativeCrossing', () => {
  it('finds no crossing while interest paid stays ahead (US 30-year loan)', () => {
    const data = vectorData('us-mortgage-30y-origination-fee');
    expect(cumulativeCrossing(data.buckets, data.digits)).toBeNull();
  });

  it('finds the year principal paid passes interest paid', () => {
    const data = vectorData('cn-mortgage-30y-equal-instalments');
    const position = cumulativeCrossing(data.buckets, data.digits);
    expect(position).toBe(14);
    const before = at(data.buckets, 13);
    const after = at(data.buckets, 14);
    expect(Number(before.cumulativeInterest)).toBeGreaterThan(Number(before.cumulativePrincipal));
    expect(Number(after.cumulativePrincipal)).toBeGreaterThan(Number(after.cumulativeInterest));
  });

  it('finds no crossing when principal leads from the start', () => {
    const data = vectorData('zero-rate-annuity');
    expect(cumulativeCrossing(data.buckets, data.digits)).toBeNull();
  });

  it('needs interest ahead first, then principal strictly ahead', () => {
    const buckets = [
      bucket(1, { cumulativePrincipal: '5.00', cumulativeInterest: '5.00' }),
      bucket(2, { cumulativePrincipal: '6.00', cumulativeInterest: '9.00' }),
      bucket(3, { cumulativePrincipal: '12.00', cumulativeInterest: '12.00' }),
      bucket(4, { cumulativePrincipal: '15.01', cumulativeInterest: '15.00' }),
    ];
    expect(cumulativeCrossing(buckets, 2)).toBe(3);
    expect(cumulativeCrossing(buckets.slice(0, 3), 2)).toBeNull();
    expect(cumulativeCrossing([at(buckets, 0), at(buckets, 3)], 2)).toBeNull();
  });
});

describe('stackBar', () => {
  it('stacks principal, then interest, up from zero', () => {
    expect(stackBar(bucket(1, { principal: '3641.84', interest: '23949.16' }), false, 2)).toEqual([
      { key: 'principal', value: '3641.84', from: 0, to: 3641.84 },
      { key: 'interest', value: '23949.16', from: 3641.84, to: 27591 },
    ]);
  });

  it('puts fees and insurance between principal and interest when the loan has them', () => {
    const parts = stackBar(
      bucket(1, { principal: '100.00', fees: '7.50', interest: '20.00' }),
      true,
      2,
    );
    expect(parts.map((part) => [part.key, part.from, part.to])).toEqual([
      ['principal', 0, 100],
      ['fees', 100, 107.5],
      ['interest', 107.5, 127.5],
    ]);
  });

  it('leaves zero segments out', () => {
    const parts = stackBar(
      bucket(1, { principal: '0.00', fees: '0.00', interest: '5.00' }),
      true,
      2,
    );
    expect(parts).toEqual([{ key: 'interest', value: '5.00', from: 0, to: 5 }]);
  });

  it('stacks negative principal and negative interest down from zero', () => {
    expect(
      stackBar(bucket(1, { principal: '-48.42', interest: '2583.33' }), false, 2).map((part) => [
        part.key,
        part.from,
        part.to,
      ]),
    ).toEqual([
      ['principal', 0, -48.42],
      ['interest', 0, 2583.33],
    ]);
    expect(
      stackBar(bucket(1, { principal: '-10.00', fees: '1.00', interest: '-2.50' }), true, 2).map(
        (part) => [part.key, part.from, part.to],
      ),
    ).toEqual([
      ['principal', 0, -10],
      ['fees', 0, 1],
      ['interest', -10, -12.5],
    ]);
  });

  it('diverges for the negative-rate balloon: principal up, interest down', () => {
    const data = vectorData('balloon-negative-rate-negative-instalment');
    const first = at(data.buckets, 0);
    const parts = stackBar(first, data.hasFees, data.digits);
    expect(parts.map((part) => part.key)).toEqual(['principal', 'interest']);
    expect(at(parts, 0).to).toBeGreaterThan(0);
    expect(at(parts, 1).to).toBeLessThan(0);
    expect(at(parts, 1).value).toBe(first.interest);
  });
});

describe('barRects', () => {
  // 0 at y = 200, one unit per pixel (exact in floats).
  const y = (value: number): number => 200 - value;

  it('works with a linear scale', () => {
    const scale = linearScale([0, 200], [200, 0]);
    expect(barRects(stackBar(bucket(1, { interest: '50.00' }), false, 2), scale)).toEqual([
      { key: 'interest', value: '50.00', y: 150, height: 50 },
    ]);
  });

  it('leaves a gap above the bottom segment of a stack', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '100.00', fees: '10.00', interest: '50.00' }), true, 2),
      y,
    );
    expect(rects).toEqual([
      { key: 'principal', value: '100.00', y: 100, height: 100 },
      { key: 'fees', value: '10.00', y: 90, height: 8 },
      { key: 'interest', value: '50.00', y: 40, height: 48 },
    ]);
  });

  it('leaves the gap below the first segment of a downward stack', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '-50.00', interest: '-30.00' }), false, 2),
      y,
      3,
    );
    expect(rects).toEqual([
      { key: 'principal', value: '-50.00', y: 200, height: 50 },
      { key: 'interest', value: '-30.00', y: 253, height: 27 },
    ]);
  });

  it('starts both directions of a diverging bar at the baseline without a gap', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '-20.00', interest: '40.00' }), false, 2),
      y,
    );
    expect(rects).toEqual([
      { key: 'principal', value: '-20.00', y: 200, height: 20 },
      { key: 'interest', value: '40.00', y: 160, height: 40 },
    ]);
  });

  it('drops a segment thinner than the gap', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '100.00', fees: '1.50', interest: '50.00' }), true, 2),
      y,
    );
    expect(rects.map((rect) => rect.key)).toEqual(['principal', 'interest']);
    // Interest starts from its own value, 101.50, with the gap below it.
    expect(rects[1]).toEqual({ key: 'interest', value: '50.00', y: 48.5, height: 48 });
  });

  it('draws a thin segment at the minimum height, taken from the segment beyond it', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '100.00', fees: '0.50', interest: '50.00' }), true, 2),
      y,
      2,
      1,
    );
    expect(rects).toEqual([
      { key: 'principal', value: '100.00', y: 100, height: 100 },
      { key: 'fees', value: '0.50', y: 97, height: 1 },
      // The top stays at 150.50.
      { key: 'interest', value: '50.00', y: 49.5, height: 45.5 },
    ]);
  });

  it('keeps segments taller than the minimum as they are', () => {
    const parts = stackBar(
      bucket(1, { principal: '100.00', fees: '10.00', interest: '50.00' }),
      true,
      2,
    );
    expect(barRects(parts, y, 2, 1)).toEqual(barRects(parts, y));
  });

  it('applies the minimum below the baseline too', () => {
    const rects = barRects(
      stackBar(bucket(1, { principal: '-50.00', interest: '-0.25' }), false, 2),
      y,
      2,
      1,
    );
    expect(rects).toEqual([
      { key: 'principal', value: '-50.00', y: 200, height: 50 },
      { key: 'interest', value: '-0.25', y: 252, height: 1 },
    ]);
  });
});

describe('series and extents', () => {
  const data: ChartData = {
    unit: 'year',
    periodsPerYear: 12,
    hasFees: true,
    origin: { balance: '1000.00', cumulativePrincipal: '0.00', cumulativeInterest: '0.00' },
    buckets: [
      bucket(1, {
        principal: '-20.00',
        fees: '5.00',
        interest: '70.00',
        closing: '1020.00',
        cumulativePrincipal: '-20.00',
        cumulativeInterest: '70.00',
      }),
      bucket(2, {
        principal: '1020.00',
        fees: '5.00',
        interest: '-1.00',
        closing: '0.00',
        cumulativePrincipal: '1000.00',
        cumulativeInterest: '69.00',
      }),
    ],
  };

  it('names the series of each view in legend order', () => {
    expect(CHART_VIEWS).toEqual(['bars', 'balance', 'cumulative']);
    expect(seriesOf('bars', true)).toEqual(['principal', 'fees', 'interest']);
    expect(seriesOf('bars', false)).toEqual(['principal', 'interest']);
    expect(stackKeys(false)).toEqual(['principal', 'interest']);
    expect(seriesOf('balance', true)).toEqual(['balance']);
    expect(seriesOf('cumulative', false)).toEqual(['cumulativePrincipal', 'cumulativeInterest']);
  });

  it('starts each line at the origin', () => {
    expect(lineSeries(data, 'balance')).toEqual([
      { key: 'balance', values: ['1000.00', '1020.00', '0.00'] },
    ]);
    expect(lineSeries(data, 'cumulative')).toEqual([
      { key: 'cumulativePrincipal', values: ['0.00', '-20.00', '1000.00'] },
      { key: 'cumulativeInterest', values: ['0.00', '70.00', '69.00'] },
    ]);
  });

  it('gives each view its value range, always including zero', () => {
    expect(valueExtent(data, 'bars', 2)).toEqual({ min: -20, max: 1025 });
    expect(valueExtent(data, 'balance', 2)).toEqual({ min: 0, max: 1020 });
    expect(valueExtent(data, 'cumulative', 2)).toEqual({ min: -20, max: 1000 });
  });

  it('gives the design scenario a bar range up to its largest year', () => {
    const us = vectorData('us-mortgage-30y-origination-fee');
    const extent = valueExtent(us, 'bars', us.digits);
    expect(extent.min).toBe(0);
    expect(extent.max).toBe(Math.max(...us.buckets.map((item) => Number(item.total))));
    expect(valueExtent(us, 'balance', us.digits)).toEqual({ min: 0, max: 350000 });
  });
});
