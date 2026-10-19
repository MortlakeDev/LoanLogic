// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Times of the UK and EU APRC (SPEC §9.3 b and c): years from the first drawdown, with a
 * year of 12 equal months or 52 weeks. Regular schedules place payment `k` at
 * `k / m` years; irregular dates count equal periods and then days backwards from each
 * date (MCOB 10A.2.3 R(3); CCD2 Annex III (c)).
 */

import { type LocalDate, addDays, addMonths, compareDates, daysBetween } from '../date';
import { frequencyInfo, periodsPerYear } from '../frequency';
import { type Rational, ZERO, add, rational } from '../rational';
import type { SolveResult } from '../solvers';
import type { CashFlow, FrequencyId } from '../types';
import { type TimedFlow, solveTimedFlows } from './solve';

const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;
const DAYS_PER_WEEK = 7;

/**
 * The time in years from `start` to `date` by backward counting (SPEC §9.3 b): whole
 * equal periods are counted back from `date` — months for a month-based frequency, weeks
 * otherwise — as far as they stay on or after `start`; the remaining days up to the last
 * counted-back day `L` are divided by the length of the complete year counted back from
 * `L` to the same day of the previous year (365 or 366). Months are counted back with
 * `addMonths(date, −M)`, clamped, from `date` for every `M` (SPEC v0.2.1).
 *
 * From 2028-02-20: 2028-04-25 is 2/12 + 5/365, 2028-04-05 is 1/12 + 14/366. From
 * 2026-01-31: 2026-03-31 is 2/12, 2026-04-30 is 2/12 + 28/365.
 *
 * @param start The first drawdown `D0`.
 * @param date A flow date on or after `start`.
 * @param frequency Chooses months or weeks as the equal period.
 * @returns The exact time in years (0 for `date = start`).
 * @throws RangeError if `date` is before `start`.
 */
export function backwardCountedTime(
  start: LocalDate,
  date: LocalDate,
  frequency: FrequencyId,
): Rational {
  const order = compareDates(date, start);
  if (order < 0) {
    throw new RangeError('A flow date is before the first drawdown');
  }
  if (order === 0) {
    return ZERO;
  }
  let whole: Rational;
  let last: LocalDate;
  if (frequencyInfo(frequency).monthBased) {
    // date − M months lands in start's month for M = the calendar month difference; one
    // month fewer when the clamped day falls before start's day.
    let months = (date.y - start.y) * MONTHS_PER_YEAR + (date.m - start.m);
    while (months > 0 && compareDates(addMonths(date, -months), start) < 0) {
      months -= 1;
    }
    last = addMonths(date, -months);
    whole = rational(BigInt(months), BigInt(MONTHS_PER_YEAR));
  } else {
    const weeks = Math.floor(daysBetween(start, date) / DAYS_PER_WEEK);
    last = addDays(date, -DAYS_PER_WEEK * weeks);
    whole = rational(BigInt(weeks), BigInt(WEEKS_PER_YEAR));
  }
  const remainingDays = daysBetween(start, last);
  if (remainingDays === 0) {
    return whole;
  }
  const yearDays = daysBetween(addMonths(last, -MONTHS_PER_YEAR), last);
  return add(whole, rational(BigInt(remainingDays), BigInt(yearDays)));
}

/**
 * Places each flow on the APRC time axis in years: `period / m` when every flow has a
 * period (whole periods of a regular schedule), else by backward counting from the first
 * flow's date.
 *
 * @param flows Flows in non-decreasing date order.
 * @param frequency The payment frequency (`m`, or the equal period of backward counting).
 * @param hasPeriods Whether every flow has a period.
 * @throws RangeError if `hasPeriods` is true and a flow has no period, or a date is
 *   before the first flow's date.
 */
export function aprcTimes(
  flows: readonly CashFlow[],
  frequency: FrequencyId,
  hasPeriods: boolean,
): TimedFlow[] {
  const start = flows[0]?.date;
  if (start === undefined) {
    return [];
  }
  const m = BigInt(periodsPerYear(frequency));
  return flows.map((flow) => {
    if (!hasPeriods) {
      return { time: backwardCountedTime(start, flow.date, frequency), amount: flow.amount };
    }
    if (flow.period === undefined) {
      throw new RangeError('The APRC from periods needs a period on every flow');
    }
    return { time: rational(BigInt(flow.period), m), amount: flow.amount };
  });
}

/**
 * Solves the APRC `X` (annual, decimal fraction) of the flows (SPEC §9.3 b, c).
 *
 * @param flows Flows in non-decreasing date order, borrower view.
 * @param frequency The payment frequency.
 * @param hasPeriods Whether every flow has a period.
 */
export function solveAprc(
  flows: readonly CashFlow[],
  frequency: FrequencyId,
  hasPeriods: boolean,
): SolveResult {
  return solveTimedFlows(aprcTimes(flows, frequency, hasPeriods));
}
