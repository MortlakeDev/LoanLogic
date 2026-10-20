// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LocalDate, addDays, daysBetween, daysInMonth, parseIsoDate } from './date';
import { DAY_COUNT_IDS, isDayCountId, yearFraction } from './daycount';
import { toMinorUnits } from './money';
import {
  type Rational,
  add,
  compare,
  div,
  fromInteger,
  parseDecimal,
  rational,
  toExplainString,
} from './rational';
import { dayCountInterest } from './rates';
import type { DayCountId } from './types';

function day(text: string): LocalDate {
  const date = parseIsoDate(text);
  if (date === undefined) {
    throw new Error(`Bad test date ${text}`);
  }
  return date;
}

function yf(method: DayCountId, from: string, to: string, eom = false): Rational {
  return yearFraction(method, day(from), day(to), eom);
}

const over360 = (days: number): Rational => rational(BigInt(days), 360n);

const anyDate = fc
  .record({
    y: fc.integer({ min: 1, max: 9998 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }): LocalDate => ({ y, m, d: Math.min(d, daysInMonth(y, m)) }));

describe('day-count ids (SPEC §4)', () => {
  it('lists the six methods', () => {
    expect(DAY_COUNT_IDS).toEqual([
      '30u-360',
      '30-360-isda',
      '30e-360',
      'act-360',
      'act-365f',
      'act-act-isda',
    ]);
    expect(Object.isFrozen(DAY_COUNT_IDS)).toBe(true);
  });

  it('recognizes exactly those ids', () => {
    for (const id of DAY_COUNT_IDS) {
      expect(isDayCountId(id)).toBe(true);
    }
    for (const value of ['act-365', 'ACT-360', '30/360', '', 'toString', 360, null, undefined]) {
      expect(isDayCountId(value)).toBe(false);
    }
  });
});

describe('yearFraction', () => {
  it('is zero for equal dates under every method and schedule kind', () => {
    for (const method of DAY_COUNT_IDS) {
      for (const text of ['2026-01-15', '2026-01-31', '2026-02-28', '2028-02-29', '2026-03-30']) {
        for (const eom of [true, false]) {
          expect(yf(method, text, text, eom)).toEqual(rational(0n));
        }
      }
    }
  });

  it('throws when the start is after the end (a programming error)', () => {
    for (const method of DAY_COUNT_IDS) {
      expect(() => yf(method, '2026-02-02', '2026-02-01')).toThrow(RangeError);
    }
  });

  describe('ACT/360 and ACT/365F', () => {
    it('divide actual days by 360 or 365', () => {
      expect(yf('act-360', '2026-01-15', '2026-02-15')).toEqual(rational(31n, 360n));
      expect(yf('act-365f', '2026-01-15', '2026-02-15')).toEqual(rational(31n, 365n));
      expect(yf('act-360', '2028-02-01', '2028-03-01')).toEqual(rational(29n, 360n));
      expect(yf('act-365f', '2028-02-01', '2028-03-01')).toEqual(rational(29n, 365n));
      expect(yf('act-365f', '2028-01-01', '2029-01-01')).toEqual(rational(366n, 365n));
      expect(yf('act-360', '2026-01-01', '2027-01-01')).toEqual(rational(365n, 360n));
    });
  });

  describe('ACT/ACT ISDA', () => {
    it('reproduces the ISDA example: 1 Nov 2003 → 1 May 2004 = 61/365 + 121/366', () => {
      const value = yf('act-act-isda', '2003-11-01', '2004-05-01');
      expect(value).toEqual(add(rational(61n, 365n), rational(121n, 366n)));
      expect(toExplainString(value, 12)).toBe('0.497724380567');
    });

    it('splits at year boundaries', () => {
      expect(yf('act-act-isda', '2026-01-01', '2027-01-01')).toEqual(rational(1n));
      expect(yf('act-act-isda', '2028-01-01', '2029-01-01')).toEqual(rational(1n));
      expect(yf('act-act-isda', '2027-12-31', '2028-01-31')).toEqual(
        add(rational(1n, 365n), rational(30n, 366n)),
      );
      expect(yf('act-act-isda', '2028-02-01', '2028-03-01')).toEqual(rational(29n, 366n));
      expect(yf('act-act-isda', '2027-06-30', '2030-06-30')).toEqual(
        add(add(rational(185n, 365n), rational(1n)), add(rational(1n), rational(180n, 365n))),
      );
      expect(yf('act-act-isda', '2027-07-01', '2028-01-01')).toEqual(rational(184n, 365n));
    });

    it('stays between days/366 and days/365 and adds up over sub-periods', () => {
      fc.assert(
        fc.property(
          anyDate,
          fc.integer({ min: 0, max: 2000 }),
          fc.integer({ min: 0, max: 2000 }),
          (start, first, second) => {
            const middle = addDays(start, first);
            const end = addDays(middle, second);
            const whole = yearFraction('act-act-isda', start, end, false);
            const days = BigInt(first + second);
            expect(compare(rational(days, 366n), whole)).toBeLessThanOrEqual(0);
            expect(compare(whole, rational(days, 365n))).toBeLessThanOrEqual(0);
            expect(whole).toEqual(
              add(
                yearFraction('act-act-isda', start, middle, false),
                yearFraction('act-act-isda', middle, end, false),
              ),
            );
          },
        ),
      );
    });
  });

  describe('30/360 US (SPEC §4 rules 1–4, applied in order)', () => {
    it('applies rules 1 and 2 only on an end-of-month schedule', () => {
      // February end → February end: D2 = 30 (1) and D1 = 30 (2).
      expect(yf('30u-360', '2027-02-28', '2028-02-29', true)).toEqual(over360(360));
      expect(yf('30u-360', '2027-02-28', '2028-02-29', false)).toEqual(over360(361));
      // February end → March 31: D1 = 30 (2), then D2 = 30 (3, seeing rule 2).
      expect(yf('30u-360', '2026-02-28', '2026-03-31', true)).toEqual(over360(30));
      expect(yf('30u-360', '2026-02-28', '2026-03-31', false)).toEqual(over360(33));
      expect(yf('30u-360', '2028-02-29', '2028-03-31', true)).toEqual(over360(30));
      expect(yf('30u-360', '2028-02-29', '2028-03-31', false)).toEqual(over360(32));
      expect(yf('30u-360', '2026-02-28', '2026-08-31', true)).toEqual(over360(180));
      expect(yf('30u-360', '2026-02-28', '2026-03-28', true)).toEqual(over360(28));
      // February 28 of a leap year is not the last day of February.
      expect(yf('30u-360', '2028-02-28', '2028-03-31', true)).toEqual(over360(33));
    });

    it('applies rules 3 and 4 to the 31st', () => {
      expect(yf('30u-360', '2026-01-31', '2026-02-28', true)).toEqual(over360(28));
      expect(yf('30u-360', '2028-01-31', '2028-02-29', true)).toEqual(over360(29));
      expect(yf('30u-360', '2026-01-31', '2026-03-31')).toEqual(over360(60));
      expect(yf('30u-360', '2026-03-30', '2026-05-31')).toEqual(over360(60));
      expect(yf('30u-360', '2026-03-29', '2026-05-31')).toEqual(over360(62));
      expect(yf('30u-360', '2026-03-31', '2026-04-30')).toEqual(over360(30));
      expect(yf('30u-360', '2026-01-15', '2027-03-15')).toEqual(over360(420));
    });
  });

  describe('30/360 ISDA', () => {
    it('adjusts the 31st only, with D2 depending on the adjusted D1', () => {
      expect(yf('30-360-isda', '2026-02-28', '2026-03-31')).toEqual(over360(33));
      expect(yf('30-360-isda', '2026-02-28', '2026-03-31', true)).toEqual(over360(33));
      expect(yf('30-360-isda', '2026-01-31', '2026-02-28')).toEqual(over360(28));
      expect(yf('30-360-isda', '2026-03-30', '2026-05-31')).toEqual(over360(60));
      expect(yf('30-360-isda', '2026-03-31', '2026-05-31')).toEqual(over360(60));
      expect(yf('30-360-isda', '2026-03-29', '2026-05-31')).toEqual(over360(62));
      expect(yf('30-360-isda', '2026-02-28', '2026-08-31')).toEqual(over360(183));
    });
  });

  describe('30E/360', () => {
    it('moves every 31st to the 30th', () => {
      expect(yf('30e-360', '2026-03-29', '2026-05-31')).toEqual(over360(61));
      expect(yf('30e-360', '2027-02-28', '2027-03-31')).toEqual(over360(32));
      expect(yf('30e-360', '2027-01-31', '2027-02-28')).toEqual(over360(28));
      expect(yf('30e-360', '2026-03-31', '2026-04-30')).toEqual(over360(30));
      expect(yf('30e-360', '2026-08-31', '2026-09-30')).toEqual(over360(30));
    });
  });

  it('agrees for every 30/360 method away from the 31st and February', () => {
    fc.assert(
      fc.property(anyDate, anyDate, fc.boolean(), (a, b, eom) => {
        // Day 28 can be the last day of February, which 30/360 US adjusts.
        fc.pre(a.d <= 27 && b.d <= 27 && daysBetween(a, b) >= 0);
        const expected = over360(360 * (b.y - a.y) + 30 * (b.m - a.m) + (b.d - a.d));
        for (const method of ['30u-360', '30-360-isda', '30e-360'] as const) {
          expect(yearFraction(method, a, b, eom)).toEqual(expected);
        }
      }),
    );
  });

  it('is never negative', () => {
    fc.assert(
      fc.property(
        anyDate,
        fc.integer({ min: 0, max: 1000 }),
        fc.constantFrom(...DAY_COUNT_IDS),
        fc.boolean(),
        (start, days, method, eom) => {
          const value = yearFraction(method, start, addDays(start, days), eom);
          expect(value.n >= 0n).toBe(true);
        },
      ),
    );
  });
});

describe('golden vector rows (day-count interest = R(B × j × YF), half-up)', () => {
  /** Interest of one row of a vector, in minor units. */
  function interest(
    method: DayCountId,
    from: string,
    to: string,
    eom: boolean,
    opening: string,
    ratePct: string,
  ): bigint {
    const balance = toMinorUnits(opening, 2) ?? 0n;
    const j = div(parseDecimal(ratePct), fromInteger(100));
    return dayCountInterest(balance, j, yf(method, from, to, eom), 'half-up');
  }

  it('daycount-30u360-eom-february', () => {
    expect(interest('30u-360', '2026-01-31', '2026-02-28', true, '60000.00', '6.15')).toBe(28700n);
    expect(interest('30u-360', '2026-02-28', '2026-03-31', true, '57816.24', '6.15')).toBe(29631n);
    expect(interest('30u-360', '2027-01-31', '2027-02-28', true, '33274.81', '6.15')).toBe(15916n);
    expect(interest('30u-360', '2027-02-28', '2027-03-31', true, '30963.21', '6.15')).toBe(15869n);
  });

  it('daycount-30u360-day-31-anchor-eom-off', () => {
    expect(interest('30u-360', '2026-01-31', '2026-02-28', true, '25000.00', '7.2')).toBe(14000n);
    expect(interest('30u-360', '2027-01-31', '2027-02-28', true, '1982.20', '7.2')).toBe(1110n);
  });

  it('daycount-30360-isda-february-end', () => {
    expect(interest('30-360-isda', '2026-02-28', '2026-03-31', true, '60000.00', '6.15')).toBe(
      33825n,
    );
    expect(interest('30-360-isda', '2027-01-31', '2027-02-28', true, '35617.26', '6.15')).toBe(
      17037n,
    );
  });

  it('daycount-30e360-month-ends', () => {
    expect(interest('30e-360', '2027-01-31', '2027-02-28', true, '37861.62', '6.15')).toBe(18110n);
    expect(interest('30e-360', '2027-02-28', '2027-03-31', true, '35571.96', '6.15')).toBe(19446n);
  });

  it('daycount-act360-commercial and daycount-act365f-*', () => {
    expect(interest('act-360', '2026-01-15', '2026-02-15', false, '1000000.00', '7.25')).toBe(
      624306n,
    );
    expect(interest('act-360', '2026-02-15', '2026-03-15', false, '986323.70', '7.25')).toBe(
      556177n,
    );
    expect(interest('act-365f', '2026-03-25', '2026-04-25', false, '200000.00', '5.49')).toBe(
      93255n,
    );
    expect(interest('act-365f', '2027-02-25', '2027-03-25', false, '185943.64', '5.49')).toBe(
      78310n,
    );
  });

  it('daycount-actact-isda-leap-years', () => {
    expect(interest('act-act-isda', '2027-11-30', '2027-12-31', true, '65173.24', '4.4')).toBe(
      24355n,
    );
    expect(interest('act-act-isda', '2027-12-31', '2028-01-31', true, '63189.12', '4.4')).toBe(
      23551n,
    );
    expect(interest('act-act-isda', '2028-01-31', '2028-02-29', true, '61196.96', '4.4')).toBe(
      21335n,
    );
  });

  it('daycount-bullet-act360-quarterly', () => {
    expect(interest('act-360', '2026-03-31', '2026-06-30', true, '5000000.00', '6.1')).toBe(
      7709722n,
    );
    expect(interest('act-360', '2026-12-31', '2027-03-31', true, '5000000.00', '6.1')).toBe(
      7625000n,
    );
  });
});
