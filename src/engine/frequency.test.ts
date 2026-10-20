// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type LocalDate,
  addMonths,
  compareDates,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  isLastDayOfMonth,
  lastDayOfMonth,
  parseIsoDate,
} from './date';
import {
  FREQUENCY_IDS,
  frequencyInfo,
  isEndOfMonthSchedule,
  isFrequencyId,
  periodsPerYear,
  scheduleDate,
  scheduleDates,
} from './frequency';
import type { FrequencyId } from './types';

function day(text: string): LocalDate {
  const date = parseIsoDate(text);
  if (date === undefined) {
    throw new Error(`Bad test date ${text}`);
  }
  return date;
}

/** The first `count` payment dates as ISO strings. */
function dates(anchor: string, count: number, frequency: FrequencyId, eom: boolean): string[] {
  return scheduleDates(day(anchor), count, frequency, eom).map(formatIsoDate);
}

const MONTH_BASED: readonly FrequencyId[] = ['monthly', 'quarterly', 'semiannual', 'annual'];

const supportedAnchor = fc
  .record({
    y: fc.integer({ min: 1900, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }): LocalDate => ({ y, m, d: Math.min(d, daysInMonth(y, m)) }));

describe('frequency table (SPEC §2.2)', () => {
  it('lists the M1 ids in contract order', () => {
    expect(FREQUENCY_IDS).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'semiannual',
      'annual',
    ]);
    expect(Object.isFrozen(FREQUENCY_IDS)).toBe(true);
  });

  it('gives m and the period rule', () => {
    expect(FREQUENCY_IDS.map(periodsPerYear)).toEqual([52, 26, 12, 4, 2, 1]);
    expect(frequencyInfo('weekly')).toEqual({ perYear: 52, monthBased: false, step: 7 });
    expect(frequencyInfo('biweekly')).toEqual({ perYear: 26, monthBased: false, step: 14 });
    expect(frequencyInfo('monthly')).toEqual({ perYear: 12, monthBased: true, step: 1 });
    expect(frequencyInfo('quarterly')).toEqual({ perYear: 4, monthBased: true, step: 3 });
    expect(frequencyInfo('semiannual')).toEqual({ perYear: 2, monthBased: true, step: 6 });
    expect(frequencyInfo('annual')).toEqual({ perYear: 1, monthBased: true, step: 12 });
  });

  it('recognizes exactly the M1 ids', () => {
    for (const id of FREQUENCY_IDS) {
      expect(isFrequencyId(id)).toBe(true);
    }
    for (const value of [
      'semimonthly',
      'continuous',
      'Monthly',
      'MONTHLY',
      ' monthly',
      '',
      'toString',
      '__proto__',
      'constructor',
      12,
      null,
      undefined,
      {},
    ]) {
      expect(isFrequencyId(value)).toBe(false);
    }
  });
});

describe('scheduleDate (SPEC §2.3)', () => {
  it('returns the anchor for k = 0', () => {
    for (const frequency of FREQUENCY_IDS) {
      for (const eom of [true, false]) {
        expect(scheduleDate(day('2026-01-31'), 0, frequency, eom)).toEqual(day('2026-01-31'));
        expect(scheduleDate(day('2026-03-15'), 0, frequency, eom)).toEqual(day('2026-03-15'));
      }
    }
  });

  it('adds whole weeks for weekly and bi-weekly payments, ignoring the month-end rule', () => {
    expect(dates('2026-01-02', 3, 'weekly', true)).toEqual([
      '2026-01-09',
      '2026-01-16',
      '2026-01-23',
    ]);
    expect(dates('2026-01-31', 2, 'weekly', true)).toEqual(['2026-02-07', '2026-02-14']);
    expect(dates('2026-03-02', 1, 'biweekly', true)).toEqual(['2026-03-16']);
    expect(dates('2026-12-24', 2, 'biweekly', false)).toEqual(['2027-01-07', '2027-01-21']);
  });

  it('follows month ends from a month-end anchor: Jan 31 → Feb 29 → Mar 31 → Apr 30', () => {
    expect(dates('2028-01-31', 3, 'monthly', true)).toEqual([
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
    ]);
  });

  it('reaches every month end from a 31st anchor with either setting', () => {
    for (const eom of [true, false]) {
      expect(dates('2028-01-31', 3, 'monthly', eom)).toEqual([
        '2028-02-29',
        '2028-03-31',
        '2028-04-30',
      ]);
      // Vector day-31-anchor-clamps: quarterly from 2026-01-31.
      expect(dates('2026-01-31', 4, 'quarterly', eom)).toEqual([
        '2026-04-30',
        '2026-07-31',
        '2026-10-31',
        '2027-01-31',
      ]);
    }
  });

  it('moves a February 28 anchor to month ends only with the end-of-month rule', () => {
    expect(dates('2026-02-28', 3, 'monthly', true)).toEqual([
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // Vector eom-rule-off-february-28.
    expect(dates('2026-02-28', 3, 'monthly', false)).toEqual([
      '2026-03-28',
      '2026-04-28',
      '2026-05-28',
    ]);
    expect(dates('2026-02-28', 12, 'monthly', false).at(-1)).toBe('2027-02-28');
  });

  it('handles a leap-day anchor (vector eom-anchor-leap-february)', () => {
    expect(dates('2028-02-29', 12, 'monthly', true)).toEqual([
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
      '2028-07-31',
      '2028-08-31',
      '2028-09-30',
      '2028-10-31',
      '2028-11-30',
      '2028-12-31',
      '2029-01-31',
      '2029-02-28',
    ]);
    expect(dates('2028-02-29', 3, 'monthly', false)).toEqual([
      '2028-03-29',
      '2028-04-29',
      '2028-05-29',
    ]);
    expect(dates('2028-02-29', 4, 'annual', true)).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
    expect(dates('2028-02-29', 4, 'annual', false)).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('computes every date from the anchor, so a clamped date does not drift', () => {
    expect(dates('2026-01-30', 3, 'monthly', true)).toEqual([
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
    ]);
    expect(dates('2026-08-31', 3, 'semiannual', true)).toEqual([
      '2027-02-28',
      '2027-08-31',
      '2028-02-29',
    ]);
    expect(dates('2026-04-30', 2, 'monthly', true)).toEqual(['2026-05-31', '2026-06-30']);
    expect(dates('2026-04-30', 2, 'monthly', false)).toEqual(['2026-05-30', '2026-06-30']);
  });

  it('may run past 9999-12-31 for the caller to reject', () => {
    expect(scheduleDate(day('9990-06-15'), 360, 'monthly', true)).toEqual({
      y: 10020,
      m: 6,
      d: 15,
    });
  });

  it('places month-based dates by whole months from the anchor', () => {
    fc.assert(
      fc.property(
        supportedAnchor,
        fc.integer({ min: 0, max: 1200 }),
        fc.constantFrom(...MONTH_BASED),
        fc.boolean(),
        (anchor, k, frequency, eom) => {
          const date = scheduleDate(anchor, k, frequency, eom);
          const clamped = addMonths(anchor, k * frequencyInfo(frequency).step);
          const expected = eom && isLastDayOfMonth(anchor) ? lastDayOfMonth(clamped) : clamped;
          expect(date).toEqual(expected);
        },
      ),
    );
  });

  it('produces strictly increasing dates', () => {
    fc.assert(
      fc.property(
        supportedAnchor,
        fc.integer({ min: 1, max: 120 }),
        fc.constantFrom(...FREQUENCY_IDS),
        fc.boolean(),
        (anchor, count, frequency, eom) => {
          const list = scheduleDates(anchor, count, frequency, eom);
          expect(list).toHaveLength(count);
          let previous = anchor;
          for (const date of list) {
            expect(compareDates(previous, date)).toBe(-1);
            previous = date;
          }
          if (!frequencyInfo(frequency).monthBased) {
            const step = frequencyInfo(frequency).step;
            list.forEach((date, index) => {
              expect(daysBetween(anchor, date)).toBe(step * (index + 1));
            });
          }
        },
      ),
    );
  });
});

describe('scheduleDates', () => {
  it('lists date_1 … date_N and nothing for N = 0', () => {
    expect(scheduleDates(day('2026-01-15'), 0, 'monthly', true)).toEqual([]);
    const list = scheduleDates(day('2026-01-15'), 4, 'quarterly', true);
    expect(list).toEqual(
      [1, 2, 3, 4].map((k) => scheduleDate(day('2026-01-15'), k, 'quarterly', true)),
    );
  });
});

describe('isEndOfMonthSchedule (SPEC §2.1)', () => {
  const check = (anchor: string, count: number, frequency: FrequencyId, eom: boolean): boolean =>
    isEndOfMonthSchedule(day(anchor), scheduleDates(day(anchor), count, frequency, eom), frequency);

  it('depends on the dates, not on the flag', () => {
    expect(check('2026-01-31', 13, 'monthly', true)).toBe(true);
    expect(check('2026-01-31', 13, 'monthly', false)).toBe(true);
    expect(check('2026-02-28', 12, 'monthly', true)).toBe(true);
    expect(check('2026-02-28', 12, 'monthly', false)).toBe(false);
    expect(check('2027-06-30', 36, 'monthly', true)).toBe(true);
    expect(check('2027-06-30', 36, 'monthly', false)).toBe(false);
    expect(check('2026-01-31', 8, 'quarterly', false)).toBe(true);
  });

  it('needs a month-end anchor and a month-based frequency', () => {
    // Anchor on the 30th: February is a month end, March 30 is not.
    expect(check('2026-01-30', 3, 'monthly', true)).toBe(false);
    // Only one date, which is a month end, but the anchor is not.
    expect(check('2026-01-30', 1, 'monthly', true)).toBe(false);
    expect(check('2026-01-31', 4, 'weekly', true)).toBe(false);
    expect(check('2026-01-31', 4, 'biweekly', true)).toBe(false);
  });
});
