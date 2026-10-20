// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LocalDate, addDays, compareDates, parseIsoDate } from './date';
import { FREQUENCY_IDS, periodsPerYear, scheduleDate } from './frequency';
import { MAX_PAYMENTS, type TermResult, type TermSpec, resolvePayments } from './term';
import type { FrequencyId } from './types';

function day(text: string): LocalDate {
  const date = parseIsoDate(text);
  if (date === undefined) {
    throw new Error(`Bad test date ${text}`);
  }
  return date;
}

const D0 = day('2026-01-15');

function years(y: number, months: number, frequency: FrequencyId): TermResult {
  return resolvePayments({ kind: 'years', years: y, months }, D0, frequency, true);
}

function until(
  anchor: string,
  endDate: string,
  frequency: FrequencyId,
  endOfMonth = true,
): TermResult {
  return resolvePayments(
    { kind: 'endDate', endDate: day(endDate) },
    day(anchor),
    frequency,
    endOfMonth,
  );
}

const ok = (payments: number): TermResult => ({ ok: true, payments });
const TOO_SHORT: TermResult = { ok: false, code: 'TERM_TOO_SHORT' };
const RANGE: TermResult = { ok: false, code: 'TERM_RANGE' };

describe('resolvePayments (SPEC §2.4)', () => {
  it('uses a number of payments as given', () => {
    expect(MAX_PAYMENTS).toBe(1200);
    const spec = (payments: number): TermSpec => ({ kind: 'payments', payments });
    expect(resolvePayments(spec(1), D0, 'monthly', true)).toEqual(ok(1));
    expect(resolvePayments(spec(1200), D0, 'weekly', false)).toEqual(ok(1200));
    // Phase 1 catches these on term.payments; the resolver still refuses them.
    expect(resolvePayments(spec(0), D0, 'monthly', true)).toEqual(TOO_SHORT);
    expect(resolvePayments(spec(1201), D0, 'monthly', true)).toEqual(RANGE);
  });

  it('rounds years and months half-up: 7 months weekly → 30', () => {
    expect(years(0, 7, 'weekly')).toEqual(ok(30));
    expect(years(25, 0, 'monthly')).toEqual(ok(300));
    expect(years(20, 0, 'monthly')).toEqual(ok(240));
    expect(years(35, 0, 'monthly')).toEqual(ok(420));
    expect(years(15, 0, 'biweekly')).toEqual(ok(390));
    expect(years(1, 0, 'weekly')).toEqual(ok(52));
    expect(years(3, 0, 'quarterly')).toEqual(ok(12));
    expect(years(0, 3, 'weekly')).toEqual(ok(13));
    expect(years(0, 5, 'weekly')).toEqual(ok(22)); // 21.67
    expect(years(0, 1, 'biweekly')).toEqual(ok(2)); // 2.17
    expect(years(0, 2, 'quarterly')).toEqual(ok(1)); // 0.67
  });

  it('rounds exact halves up', () => {
    expect(years(0, 3, 'semiannual')).toEqual(ok(1)); // 0.5
    expect(years(0, 6, 'annual')).toEqual(ok(1)); // 0.5
    expect(years(1, 6, 'annual')).toEqual(ok(2)); // 1.5
    expect(years(0, 9, 'semiannual')).toEqual(ok(2)); // 1.5
  });

  it('reports a term below one payment as TERM_TOO_SHORT', () => {
    expect(years(0, 0, 'monthly')).toEqual(TOO_SHORT);
    expect(years(0, 1, 'quarterly')).toEqual(TOO_SHORT); // 0.33
    expect(years(0, 1, 'semiannual')).toEqual(TOO_SHORT); // 0.17
    expect(years(0, 5, 'annual')).toEqual(TOO_SHORT); // 0.42
  });

  it('reports more than 1 200 payments as TERM_RANGE', () => {
    expect(years(100, 0, 'monthly')).toEqual(ok(1200));
    expect(years(100, 1, 'monthly')).toEqual(RANGE);
    expect(years(100, 0, 'weekly')).toEqual(RANGE);
    expect(years(46, 2, 'biweekly')).toEqual(ok(1200)); // 554 months × 26 / 12 = 1200.33
    expect(years(46, 3, 'biweekly')).toEqual(RANGE); // 1202.5 → 1203
    expect(years(100, 11, 'annual')).toEqual(ok(101));
  });

  it('agrees with the definition for every years/months combination', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 11 }),
        fc.constantFrom(...FREQUENCY_IDS),
        (y, months, frequency) => {
          // N = roundHalfUp(totalMonths × m / 12), computed on integers.
          const twelfths = (y * 12 + months) * periodsPerYear(frequency);
          const n = Math.floor(twelfths / 12) + (twelfths % 12 >= 6 ? 1 : 0);
          const expected = n < 1 ? TOO_SHORT : n > 1200 ? RANGE : ok(n);
          expect(years(y, months, frequency)).toEqual(expected);
        },
      ),
    );
  });

  it('counts the schedule dates up to an end date (vector term-end-date-monthly)', () => {
    expect(until('2026-03-15', '2027-03-20', 'monthly')).toEqual(ok(12));
    // A schedule date equal to the end date counts.
    expect(until('2026-03-15', '2027-03-15', 'monthly')).toEqual(ok(12));
    expect(until('2026-03-15', '2027-03-14', 'monthly')).toEqual(ok(11));
    expect(until('2026-01-01', '2026-01-29', 'weekly')).toEqual(ok(4));
    expect(until('2026-01-01', '2026-01-28', 'weekly')).toEqual(ok(3));
    expect(until('2026-01-15', '2026-02-15', 'monthly')).toEqual(ok(1));
  });

  it('reports an end date before the first payment as TERM_TOO_SHORT', () => {
    // Vector error-end-date-before-first-payment.
    expect(until('2026-01-15', '2026-02-14', 'monthly')).toEqual(TOO_SHORT);
    expect(until('2026-01-15', '2026-01-15', 'monthly')).toEqual(TOO_SHORT);
    expect(until('2026-01-15', '2025-12-31', 'weekly')).toEqual(TOO_SHORT);
  });

  it('counts with the end-of-month rule of the schedule', () => {
    // From 2026-02-28 the first date is March 31 with the rule, March 28 without.
    expect(until('2026-02-28', '2026-03-30', 'monthly', true)).toEqual(TOO_SHORT);
    expect(until('2026-02-28', '2026-03-30', 'monthly', false)).toEqual(ok(1));
    expect(until('2026-01-31', '2026-02-28', 'monthly', true)).toEqual(ok(1));
  });

  it('accepts exactly 1 200 payments and refuses 1 201', () => {
    expect(until('2026-01-01', '2126-01-01', 'monthly')).toEqual(ok(1200));
    expect(until('2026-01-01', '2126-01-31', 'monthly')).toEqual(ok(1200));
    expect(until('2026-01-01', '2126-02-01', 'monthly')).toEqual(RANGE);
    expect(until('2026-01-01', '9999-12-31', 'weekly')).toEqual(RANGE);
  });

  it('matches a direct count for random end dates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: -10, max: 3000 }),
        fc.constantFrom(...FREQUENCY_IDS),
        fc.boolean(),
        (anchorDay, offset, frequency, eom) => {
          const anchor: LocalDate = { y: 2026, m: 1, d: anchorDay };
          const end = addDays(anchor, offset);
          let count = 0;
          while (compareDates(scheduleDate(anchor, count + 1, frequency, eom), end) <= 0) {
            count += 1;
          }
          const result = resolvePayments({ kind: 'endDate', endDate: end }, anchor, frequency, eom);
          expect(result).toEqual(count < 1 ? TOO_SHORT : ok(count));
        },
      ),
    );
  });
});
