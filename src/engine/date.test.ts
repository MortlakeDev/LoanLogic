// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type LocalDate,
  MAX_DATE,
  MIN_DATE,
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  fromDayNumber,
  isLastDayOfMonth,
  isLeapYear,
  isSupportedDate,
  lastDayOfMonth,
  parseIsoDate,
  sameDate,
  toDayNumber,
} from './date';

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** `YYYY-MM-DD` → LocalDate, failing the test on a typo. */
function day(text: string): LocalDate {
  const date = parseIsoDate(text);
  if (date === undefined) {
    throw new Error(`Bad test date ${text}`);
  }
  return date;
}

/**
 * Independent reference: the proleptic Gregorian ordinal (0001-01-01 = 1) by counting whole
 * years and months, without the era algorithm under test.
 */
function ordinal({ y, m, d }: LocalDate): number {
  const before = y - 1;
  let days =
    365 * before + Math.floor(before / 4) - Math.floor(before / 100) + Math.floor(before / 400) + d;
  for (let month = 1; month < m; month += 1) {
    days += month === 2 && isLeapYear(y) ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  }
  return days;
}

const supportedDate = fc
  .record({
    y: fc.integer({ min: 1, max: 9999 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }): LocalDate => ({ y, m, d: Math.min(d, daysInMonth(y, m)) }));

describe('isLeapYear', () => {
  it('follows the Gregorian rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2400)).toBe(true);
    expect(isLeapYear(4)).toBe(true);
    expect(isLeapYear(1)).toBe(false);
    expect(isLeapYear(0)).toBe(true);
  });
});

describe('daysInMonth', () => {
  it('gives every month length in common and leap years', () => {
    expect(Array.from({ length: 12 }, (_, index) => daysInMonth(2026, index + 1))).toEqual(
      MONTH_LENGTHS,
    );
    expect(Array.from({ length: 12 }, (_, index) => daysInMonth(2028, index + 1))).toEqual([
      31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe('isLastDayOfMonth and lastDayOfMonth', () => {
  it('recognizes month ends, including leap February', () => {
    expect(isLastDayOfMonth(day('2026-02-28'))).toBe(true);
    expect(isLastDayOfMonth(day('2028-02-28'))).toBe(false);
    expect(isLastDayOfMonth(day('2028-02-29'))).toBe(true);
    expect(isLastDayOfMonth(day('2026-04-30'))).toBe(true);
    expect(isLastDayOfMonth(day('2026-01-30'))).toBe(false);
    expect(isLastDayOfMonth(day('2026-01-31'))).toBe(true);
    expect(lastDayOfMonth(day('2028-02-03'))).toEqual(day('2028-02-29'));
    expect(lastDayOfMonth(day('2026-02-03'))).toEqual(day('2026-02-28'));
    expect(lastDayOfMonth(day('2026-11-15'))).toEqual(day('2026-11-30'));
  });
});

describe('day numbers', () => {
  it('count days from 1970-01-01', () => {
    expect(toDayNumber(day('1970-01-01'))).toBe(0);
    expect(toDayNumber(day('2000-03-01'))).toBe(11017);
    expect(toDayNumber(day('2026-10-20'))).toBe(20746);
    expect(toDayNumber(day('2028-02-29'))).toBe(21243);
    expect(toDayNumber(day('1900-03-01'))).toBe(-25508);
    expect(toDayNumber(MIN_DATE)).toBe(-719162);
    expect(toDayNumber(MAX_DATE)).toBe(2932896);
  });

  it('agree with an independent ordinal count for every supported date', () => {
    const epoch = ordinal(day('1970-01-01'));
    fc.assert(
      fc.property(supportedDate, (date) => {
        expect(toDayNumber(date)).toBe(ordinal(date) - epoch);
      }),
    );
  });

  it('round-trip, also beyond the supported range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2_000_000, max: 5_000_000 }), (dayNumber) => {
        const date = fromDayNumber(dayNumber);
        expect(toDayNumber(date)).toBe(dayNumber);
        expect(date.m >= 1 && date.m <= 12).toBe(true);
        expect(date.d >= 1 && date.d <= daysInMonth(date.y, date.m)).toBe(true);
      }),
    );
  });

  it('give consecutive dates for consecutive numbers', () => {
    fc.assert(
      fc.property(fc.integer({ min: -800_000, max: 3_000_000 }), (dayNumber) => {
        const today = fromDayNumber(dayNumber);
        const tomorrow = fromDayNumber(dayNumber + 1);
        if (isLastDayOfMonth(today)) {
          expect(tomorrow.d).toBe(1);
          expect(tomorrow.m).toBe(today.m === 12 ? 1 : today.m + 1);
          expect(tomorrow.y).toBe(today.m === 12 ? today.y + 1 : today.y);
        } else {
          expect(tomorrow).toEqual({ y: today.y, m: today.m, d: today.d + 1 });
        }
      }),
    );
  });

  it('measure year lengths by the leap-year rule', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9998 }), (y) => {
        expect(daysBetween({ y, m: 1, d: 1 }, { y: y + 1, m: 1, d: 1 })).toBe(
          isLeapYear(y) ? 366 : 365,
        );
      }),
    );
  });
});

describe('addDays and daysBetween', () => {
  it('cross month, year and leap-day boundaries', () => {
    expect(addDays(day('2026-01-31'), 1)).toEqual(day('2026-02-01'));
    expect(addDays(day('2028-02-28'), 1)).toEqual(day('2028-02-29'));
    expect(addDays(day('2026-02-28'), 1)).toEqual(day('2026-03-01'));
    expect(addDays(day('2026-12-31'), 1)).toEqual(day('2027-01-01'));
    expect(addDays(day('2026-03-01'), -1)).toEqual(day('2026-02-28'));
    expect(addDays(day('2026-01-02'), 14)).toEqual(day('2026-01-16'));
    expect(addDays(day('2026-01-15'), 0)).toEqual(day('2026-01-15'));
    expect(daysBetween(day('2026-03-02'), day('2026-03-16'))).toBe(14);
    expect(daysBetween(day('2028-02-01'), day('2028-03-01'))).toBe(29);
    expect(daysBetween(day('2026-03-16'), day('2026-03-02'))).toBe(-14);
    expect(daysBetween(day('2026-01-01'), day('2026-01-01'))).toBe(0);
  });

  it('are inverse to each other', () => {
    fc.assert(
      fc.property(supportedDate, fc.integer({ min: -100_000, max: 100_000 }), (date, n) => {
        expect(daysBetween(date, addDays(date, n))).toBe(n);
      }),
    );
  });
});

describe('addMonths (SPEC §2.1, v0.2.1 counting months back)', () => {
  it('keeps the day of month and clamps to the month length', () => {
    expect(addMonths(day('2026-01-31'), 1)).toEqual(day('2026-02-28'));
    expect(addMonths(day('2028-01-31'), 1)).toEqual(day('2028-02-29'));
    expect(addMonths(day('2026-01-31'), 3)).toEqual(day('2026-04-30'));
    expect(addMonths(day('2026-01-15'), 12)).toEqual(day('2027-01-15'));
    expect(addMonths(day('2026-11-30'), 3)).toEqual(day('2027-02-28'));
    expect(addMonths(day('2026-01-15'), 1200)).toEqual(day('2126-01-15'));
    expect(addMonths(day('2026-05-10'), 0)).toEqual(day('2026-05-10'));
  });

  it('counts months back from the date itself, never step by step', () => {
    expect(addMonths(day('2026-03-31'), -1)).toEqual(day('2026-02-28'));
    expect(addMonths(day('2026-03-31'), -2)).toEqual(day('2026-01-31'));
    expect(addMonths(day('2026-02-28'), -1)).toEqual(day('2026-01-28'));
    // 30 April − 3 months = 30 January (UK/EU backward counting example).
    expect(addMonths(day('2026-04-30'), -3)).toEqual(day('2026-01-30'));
    expect(addMonths(day('2026-04-30'), -2)).toEqual(day('2026-02-28'));
    expect(addMonths(day('2026-01-15'), -1)).toEqual(day('2025-12-15'));
    expect(addMonths(day('2026-01-15'), -13)).toEqual(day('2024-12-15'));
    expect(addMonths(day('2028-02-29'), -12)).toEqual(day('2027-02-28'));
    expect(addMonths(day('2028-03-05'), -12)).toEqual(day('2027-03-05'));
  });

  it('clamps exactly and moves by whole months', () => {
    fc.assert(
      fc.property(supportedDate, fc.integer({ min: -1200, max: 1200 }), (date, n) => {
        const result = addMonths(date, n);
        const monthIndex = date.y * 12 + date.m - 1 + n;
        expect(result.y * 12 + result.m - 1).toBe(monthIndex);
        expect(result.d).toBe(Math.min(date.d, daysInMonth(result.y, result.m)));
      }),
    );
  });

  it('is reversible for days that exist in every month', () => {
    fc.assert(
      fc.property(supportedDate, fc.integer({ min: -1200, max: 1200 }), (date, n) => {
        fc.pre(date.d <= 28);
        expect(addMonths(addMonths(date, n), -n)).toEqual(date);
      }),
    );
  });
});

describe('compareDates and sameDate', () => {
  it('order by year, month and day', () => {
    expect(compareDates(day('2026-01-31'), day('2026-02-01'))).toBe(-1);
    expect(compareDates(day('2027-01-01'), day('2026-12-31'))).toBe(1);
    expect(compareDates(day('2026-05-10'), day('2026-05-09'))).toBe(1);
    expect(compareDates(day('2026-05-10'), day('2026-05-10'))).toBe(0);
    expect(sameDate(day('2026-05-10'), { y: 2026, m: 5, d: 10 })).toBe(true);
    expect(sameDate(day('2026-05-10'), day('2026-05-11'))).toBe(false);
    expect(sameDate(day('2026-05-10'), day('2026-06-10'))).toBe(false);
    expect(sameDate(day('2026-05-10'), day('2027-05-10'))).toBe(false);
  });

  it('agree with day numbers', () => {
    fc.assert(
      fc.property(supportedDate, supportedDate, (a, b) => {
        expect(compareDates(a, b)).toBe(Math.sign(daysBetween(b, a)));
        expect(sameDate(a, b)).toBe(daysBetween(a, b) === 0);
      }),
    );
  });
});

describe('isSupportedDate (SPEC §2.1)', () => {
  it('accepts 0001-01-01 … 9999-12-31 only', () => {
    expect(isSupportedDate(MIN_DATE)).toBe(true);
    expect(isSupportedDate(MAX_DATE)).toBe(true);
    expect(isSupportedDate({ y: 0, m: 12, d: 31 })).toBe(false);
    expect(isSupportedDate({ y: 10000, m: 1, d: 1 })).toBe(false);
    // A 30-year monthly schedule from 9990-06-15 ends in 10020 (vector error-date-beyond-9999).
    expect(isSupportedDate(addMonths(day('9990-06-15'), 360))).toBe(false);
    expect(Object.isFrozen(MIN_DATE)).toBe(true);
    expect(Object.isFrozen(MAX_DATE)).toBe(true);
  });
});

describe('parseIsoDate and formatIsoDate', () => {
  it('parse existing YYYY-MM-DD dates', () => {
    expect(parseIsoDate('2026-01-15')).toEqual({ y: 2026, m: 1, d: 15 });
    expect(parseIsoDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseIsoDate('2000-02-29')).toEqual({ y: 2000, m: 2, d: 29 });
    expect(parseIsoDate('0001-01-01')).toEqual(MIN_DATE);
    expect(parseIsoDate('9999-12-31')).toEqual(MAX_DATE);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-32',
    '0000-01-01',
    '2026-2-3',
    '26-01-15',
    '12026-01-15',
    '+2026-01-15',
    '-2026-01-15',
    '2026/01/15',
    '20260115',
    '2026-01-15T00:00',
    ' 2026-01-15',
    '2026-01-15 ',
    '2026-01-15\n',
    '２０２６-01-15',
    '',
  ])('rejects %j', (text) => {
    expect(parseIsoDate(text)).toBeUndefined();
  });

  it('format with four-digit years and two-digit months and days', () => {
    expect(formatIsoDate({ y: 2026, m: 3, d: 5 })).toBe('2026-03-05');
    expect(formatIsoDate(MIN_DATE)).toBe('0001-01-01');
    expect(formatIsoDate({ y: 987, m: 11, d: 30 })).toBe('0987-11-30');
  });

  it('round-trip every supported date', () => {
    fc.assert(
      fc.property(supportedDate, (date) => {
        const text = formatIsoDate(date);
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(parseIsoDate(text)).toEqual(date);
      }),
    );
  });
});
