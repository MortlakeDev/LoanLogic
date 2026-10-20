// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type LocalDate,
  addDays,
  addMonths,
  compareDates,
  fromDayNumber,
  parseIsoDate,
  toDayNumber,
} from '../date';
import { type Rational, ZERO, add, compare, equals, parseDecimal, rational } from '../rational';
import type { CashFlow, FrequencyId } from '../types';
import { aprcTimes, backwardCountedTime, solveAprc } from './aprc';

function date(text: string): LocalDate {
  const parsed = parseIsoDate(text);
  if (parsed === undefined) {
    throw new Error(`bad date ${text}`);
  }
  return parsed;
}

function r(n: number, d: number): Rational {
  return rational(BigInt(n), BigInt(d));
}

function expectTime(actual: Rational, expected: Rational): void {
  expect(`${actual.n.toString()}/${actual.d.toString()}`).toBe(
    `${expected.n.toString()}/${expected.d.toString()}`,
  );
}

describe('backwardCountedTime (SPEC §9.3 b)', () => {
  it('counts whole months back, then days over the complete year back (vector examples)', () => {
    const start = date('2028-02-20');
    expectTime(backwardCountedTime(start, date('2028-04-25'), 'monthly'), add(r(2, 12), r(5, 365)));
    // The year back from 2028-03-05 contains 29 February.
    expectTime(
      backwardCountedTime(start, date('2028-04-05'), 'monthly'),
      add(r(1, 12), r(14, 366)),
    );
  });

  it('counts clamped months from the date itself (SPEC v0.2.1)', () => {
    const start = date('2026-01-31');
    expectTime(backwardCountedTime(start, date('2026-03-31'), 'monthly'), r(2, 12));
    // 30 April − 3 months = 30 January, before the drawdown: 2 months + 28/365.
    expectTime(
      backwardCountedTime(start, date('2026-04-30'), 'monthly'),
      add(r(2, 12), r(28, 365)),
    );
    // 28 February − 1 month = 28 January: no whole month, 28 days.
    expectTime(backwardCountedTime(start, date('2026-02-28'), 'monthly'), r(28, 365));
  });

  it('uses months for every month-based frequency', () => {
    const start = date('2026-01-15');
    for (const frequency of ['monthly', 'quarterly', 'semiannual', 'annual'] as const) {
      expectTime(
        backwardCountedTime(start, date('2026-07-20'), frequency),
        add(r(6, 12), r(5, 365)),
      );
    }
  });

  it('uses weeks for weekly and bi-weekly frequencies', () => {
    const start = date('2026-01-01');
    for (const frequency of ['weekly', 'biweekly'] as const) {
      // 19 days: 2 weeks back to 6 January, 5 days remain.
      expectTime(
        backwardCountedTime(start, date('2026-01-20'), frequency),
        add(r(2, 52), r(5, 365)),
      );
      expectTime(backwardCountedTime(start, date('2026-01-29'), frequency), r(4, 52));
    }
    // The year back from 2028-03-03 contains 29 February.
    expectTime(
      backwardCountedTime(date('2028-03-01'), date('2028-03-10'), 'weekly'),
      add(r(1, 52), r(2, 366)),
    );
  });

  it('is zero on the drawdown date and rejects earlier dates', () => {
    expect(backwardCountedTime(date('2026-05-05'), date('2026-05-05'), 'monthly')).toBe(ZERO);
    expect(() => backwardCountedTime(date('2026-05-05'), date('2026-05-04'), 'weekly')).toThrow(
      RangeError,
    );
  });

  const anyDate = fc
    .integer({
      min: toDayNumber({ y: 1990, m: 1, d: 1 }),
      max: toDayNumber({ y: 2090, m: 12, d: 31 }),
    })
    .map(fromDayNumber);
  const frequency = fc.constantFrom<FrequencyId>(
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'semiannual',
    'annual',
  );

  it('gives whole months exactly when the anchor day exists in every month', () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: 1, max: 600 }), (raw, k) => {
        const start = { ...raw, d: Math.min(raw.d, 28) };
        expectTime(backwardCountedTime(start, addMonths(start, k), 'monthly'), r(k, 12));
      }),
    );
  });

  it('gives whole weeks exactly', () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: 1, max: 2600 }), (start, k) => {
        expectTime(backwardCountedTime(start, addDays(start, 7 * k), 'weekly'), r(k, 52));
      }),
    );
  });

  it('never decreases as the date moves later', () => {
    fc.assert(
      fc.property(
        anyDate,
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 4000 }),
        frequency,
        (start, a, b, freq) => {
          const early = addDays(start, Math.min(a, b));
          const late = addDays(start, Math.max(a, b));
          expect(compareDates(early, late)).toBeLessThanOrEqual(0);
          expect(
            compare(
              backwardCountedTime(start, early, freq),
              backwardCountedTime(start, late, freq),
            ),
          ).toBeLessThanOrEqual(0);
        },
      ),
    );
  });
});

describe('aprcTimes', () => {
  const regular: CashFlow[] = [
    { date: date('2026-01-31'), amount: parseDecimal('1000'), period: 0 },
    { date: date('2026-02-28'), amount: parseDecimal('-510'), period: 1 },
    { date: date('2026-03-31'), amount: parseDecimal('-510'), period: 2 },
  ];

  it('places whole periods at period / m years', () => {
    const monthly = aprcTimes(regular, 'monthly', true).map((flow) => flow.time);
    expect(monthly.map((time) => equals(time, ZERO) || time.d)).toEqual([true, 12n, 6n]);
    const weekly = aprcTimes(regular, 'weekly', true).map((flow) => flow.time);
    expectTime(weekly[2] ?? ZERO, r(2, 52));
    const biweekly = aprcTimes(regular, 'biweekly', true).map((flow) => flow.time);
    expectTime(biweekly[1] ?? ZERO, r(1, 26));
    const quarterly = aprcTimes(regular, 'quarterly', true).map((flow) => flow.time);
    expectTime(quarterly[2] ?? ZERO, r(2, 4));
  });

  it('counts back from each date without periods', () => {
    const times = aprcTimes(regular, 'monthly', false).map((flow) => flow.time);
    expectTime(times[1] ?? ZERO, r(28, 365));
    expectTime(times[2] ?? ZERO, r(2, 12));
  });

  it('keeps the amounts', () => {
    expect(aprcTimes(regular, 'monthly', true).map((flow) => flow.amount)).toEqual(
      regular.map((flow) => flow.amount),
    );
  });

  it('handles an empty list and rejects a missing period', () => {
    expect(aprcTimes([], 'monthly', true)).toEqual([]);
    const missing: CashFlow[] = [
      { date: date('2026-01-31'), amount: parseDecimal('1'), period: 0 },
      { date: date('2026-02-28'), amount: parseDecimal('-1') },
    ];
    expect(() => aprcTimes(missing, 'monthly', true)).toThrow(RangeError);
  });
});

describe('solveAprc', () => {
  it('equals (1 + r)^m − 1 of the periodic rate on a regular schedule', () => {
    const flows: CashFlow[] = [
      { date: date('2026-01-15'), amount: parseDecimal('1000'), period: 0 },
      ...Array.from({ length: 12 }, (_, k) => ({
        date: addMonths(date('2026-01-15'), k + 1),
        amount: parseDecimal('-88.85'),
        period: k + 1,
      })),
    ];
    const periods = solveAprc(flows, 'monthly', true);
    const counted = solveAprc(flows, 'monthly', false);
    expect(periods.ok && counted.ok).toBe(true);
    if (periods.ok && counted.ok) {
      expect(Math.abs(periods.root - counted.root)).toBeLessThanOrEqual(1e-12);
      expect(periods.multiple).toBe(false);
    }
  });
});
