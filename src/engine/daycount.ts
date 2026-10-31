// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Day-count conventions (SPEC §4): the year fraction `YF(d1, d2)` as an exact rational.
 */

import { type LocalDate, compareDates, daysBetween, isLastDayOfMonth, isLeapYear } from './date';
import { type Rational, ZERO, add, rational } from './rational';
import type { DayCountId } from './types';

/** Every day-count method id, in the order of SPEC §4. */
export const DAY_COUNT_IDS: readonly DayCountId[] = Object.freeze([
  '30u-360',
  '30-360-isda',
  '30e-360',
  'act-360',
  'act-365f',
  'act-act-isda',
]);

/** Whether `value` is a day-count method id. */
export function isDayCountId(value: unknown): value is DayCountId {
  return typeof value === 'string' && (DAY_COUNT_IDS as readonly string[]).includes(value);
}

function isLastDayOfFebruary(date: LocalDate): boolean {
  return date.m === 2 && isLastDayOfMonth(date);
}

/**
 * One part of a year fraction: a day count `D` over a year length `B` (SPEC §9.6
 * `yf1Parts`). The 30/360 methods count `360(Y2−Y1) + 30(M2−M1) + (D2−D1)` after their day
 * adjustments over 360; the actual methods count actual days.
 */
export interface DayCountPart {
  readonly days: number;
  readonly base: 360 | 365 | 366;
}

/** `360(Y2−Y1) + 30(M2−M1) + (D2−D1)` over 360, with the adjusted days. */
function thirty360(d1: LocalDate, d2: LocalDate, day1: number, day2: number): DayCountPart[] {
  return [{ days: 360 * (d2.y - d1.y) + 30 * (d2.m - d1.m) + (day2 - day1), base: 360 }];
}

/**
 * The day counts behind the year fraction from `d1` to `d2` (SPEC §4, §9.6): one part
 * for every method but ACT/ACT ISDA, which has one part per calendar year with days in the
 * period (1 Nov 2003 → 1 May 2004: 61/365 and 121/366). Their sum is `yearFraction`, so an
 * explanation written from the parts can never disagree with the rate the schedule used.
 *
 * @param endOfMonthSchedule Whether the schedule is end-of-month (§2.1); only 30/360 US
 *   uses it, for its last-day-of-February rules.
 * @throws RangeError if `d1` is after `d2` (a programming error).
 */
export function dayCountParts(
  method: DayCountId,
  d1: LocalDate,
  d2: LocalDate,
  endOfMonthSchedule: boolean,
): DayCountPart[] {
  if (compareDates(d1, d2) > 0) {
    throw new RangeError('Day count with the start after the end');
  }
  switch (method) {
    case '30u-360': {
      // SPEC §4: apply in order, each step seeing the previous ones.
      let day1 = d1.d;
      let day2 = d2.d;
      if (endOfMonthSchedule && isLastDayOfFebruary(d1) && isLastDayOfFebruary(d2)) {
        day2 = 30;
      }
      if (endOfMonthSchedule && isLastDayOfFebruary(d1)) {
        day1 = 30;
      }
      if (day2 === 31 && day1 >= 30) {
        day2 = 30;
      }
      if (day1 === 31) {
        day1 = 30;
      }
      return thirty360(d1, d2, day1, day2);
    }
    case '30-360-isda': {
      const day1 = d1.d === 31 ? 30 : d1.d;
      const day2 = d2.d === 31 && day1 === 30 ? 30 : d2.d;
      return thirty360(d1, d2, day1, day2);
    }
    case '30e-360':
      return thirty360(d1, d2, d1.d === 31 ? 30 : d1.d, d2.d === 31 ? 30 : d2.d);
    case 'act-360':
      return [{ days: daysBetween(d1, d2), base: 360 }];
    case 'act-365f':
      return [{ days: daysBetween(d1, d2), base: 365 }];
    case 'act-act-isda': {
      const parts: DayCountPart[] = [];
      for (let y = d1.y; y <= d2.y; y += 1) {
        const start = y === d1.y ? d1 : { y, m: 1, d: 1 };
        const end = y === d2.y ? d2 : { y: y + 1, m: 1, d: 1 };
        const days = daysBetween(start, end);
        // A period ending on 1 January has no days in that year.
        if (days > 0) {
          parts.push({ days, base: isLeapYear(y) ? 366 : 365 });
        }
      }
      return parts;
    }
  }
}

/**
 * The exact year fraction from `d1` to `d2` under a day-count method (SPEC §4): the sum of
 * its `dayCountParts`.
 *
 * @param endOfMonthSchedule Whether the schedule is end-of-month (§2.1); only 30/360 US
 *   uses it, for its last-day-of-February rules.
 * @returns 0 when `d1 = d2`. ACT/ACT ISDA, 1 Nov 2003 → 1 May 2004: 61/365 + 121/366.
 * @throws RangeError if `d1` is after `d2` (a programming error).
 */
export function yearFraction(
  method: DayCountId,
  d1: LocalDate,
  d2: LocalDate,
  endOfMonthSchedule: boolean,
): Rational {
  return dayCountParts(method, d1, d2, endOfMonthSchedule).reduce(
    (total, part) => add(total, rational(BigInt(part.days), BigInt(part.base))),
    ZERO,
  );
}

/** Day-count parts written as in SPEC §9.6 `yf1Parts`: "30/360", "61/365+121/366". */
export function formatDayCountParts(parts: readonly DayCountPart[]): string {
  return parts.map((part) => `${String(part.days)}/${String(part.base)}`).join('+');
}
