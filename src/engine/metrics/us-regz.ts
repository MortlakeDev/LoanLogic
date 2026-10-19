// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The US APR of a single advance and a single payment (SPEC §9.3 a; Regulation Z,
 * Appendix J (b)(4)(ii), (b)(5)(v)–(vii)): the unit-period is the term, at most one year.
 */

import { type LocalDate, addMonths, compareDates, daysBetween, sameDate } from '../date';
import {
  type Rational,
  ONE,
  div,
  fromInteger,
  mul,
  neg,
  rational,
  sign,
  sub,
  toExplainString,
  toNumber,
} from '../rational';
import { solveSingleRoot } from '../solvers';
import type { CashFlow, RateFailure, RateMetric } from '../types';
import { METHOD_PRECISION, NO_CONVERGENCE, buildMetric, numberToExplainString } from './display';

const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = 365n;
const HUNDRED = fromInteger(100);

/**
 * The `M` in `from..to` with `addMonths(end, −(offset + M)) = start`, or `null`. Months
 * are counted back from the payment date with its own day of month, clamped, from the
 * payment date for every `M` (SPEC v0.2.1).
 */
function wholeMonthsBack(
  start: LocalDate,
  end: LocalDate,
  offset: number,
  from: number,
  to: number,
): number | null {
  for (let months = from; months <= to; months += 1) {
    if (sameDate(addMonths(end, -(offset + months)), start)) {
      return months;
    }
  }
  return null;
}

/** The largest `t ≥ 0` with `addMonths(end, −12t) ≥ start`. */
function fullYearsBack(start: LocalDate, end: LocalDate): number {
  let years = end.y - start.y;
  while (years > 0 && compareDates(addMonths(end, -MONTHS_PER_YEAR * years), start) < 0) {
    years -= 1;
  }
  return years;
}

/**
 * `usRegZApr` for exactly two flows, a single advance and a single payment (SPEC §9.3 a).
 * With `A_f` the first flow, `P` the negated second flow and `i = P / A_f − 1`:
 *
 * - term shorter than a year and `addMonths(T, −M) = D0` for some `M` in 1…11:
 *   `APR = i × 12 / M`;
 * - term shorter than a year otherwise: `APR = i × 365 / days` (31 January → 28 February
 *   is 28 days, not a month);
 * - a year or more: `t` full years counted back from `T`, `f = M / 12` when
 *   `addMonths(T, −(12t + M)) = D0` for some `M` in 0…11, else `f = days(D0, L) / 365`
 *   with `L = addMonths(T, −12t)`; `APR = i` solving `A_f (1 + f·i)(1 + i)^t = P`.
 *
 * Short terms are exact (one conversion to a double); the year-or-more equation is
 * solved in doubles to the bracket width of SPEC §10. Explanation
 * `rate.regz-single-payment` with `Af`, `P`, `days`, `months`, `unitPeriodsPerYear`, `i`
 * and, for a year or more, `t` and `f`. `days` and `months` describe the part that is
 * not whole years: the term (short terms) or the remainder from `D0` to `L`; `months` is
 * "0" when that part is not a whole number of months.
 *
 * @param flows Exactly two flows: the advance at `D0` and the payment at `T > D0`.
 * @returns The APR in percent (3 decimals), or `IRR_NO_CONVERGENCE` when the two
 *   amounts do not have opposite signs or the equation has no root in `[−0.99, 1e7]`.
 * @throws RangeError unless there are exactly two flows with the second one later.
 */
export function regZSinglePayment(flows: readonly CashFlow[]): RateMetric | RateFailure {
  const [advance, payment] = flows;
  if (flows.length !== 2 || advance === undefined || payment === undefined) {
    throw new RangeError('The single-payment rule needs exactly two flows');
  }
  const days = daysBetween(advance.date, payment.date);
  if (days <= 0) {
    throw new RangeError('The single payment must be later than the advance');
  }
  const amountFinanced = advance.amount;
  const paid = neg(payment.amount);
  if (sign(amountFinanced) * sign(paid) <= 0) {
    return NO_CONVERGENCE;
  }
  const ratio = div(paid, amountFinanced);
  const growth = sub(ratio, ONE);
  const precision = METHOD_PRECISION.usRegZApr;
  const amounts = { Af: toExplainString(amountFinanced), P: toExplainString(paid) };
  const years = fullYearsBack(advance.date, payment.date);

  if (years === 0) {
    const months = wholeMonthsBack(advance.date, payment.date, 0, 1, MONTHS_PER_YEAR - 1);
    const unitsPerYear =
      months === null
        ? rational(DAYS_PER_YEAR, BigInt(days))
        : rational(BigInt(MONTHS_PER_YEAR), BigInt(months));
    return buildMetric(toNumber(mul(mul(growth, unitsPerYear), HUNDRED)), precision, {
      formulaId: 'rate.regz-single-payment',
      values: {
        ...amounts,
        days: String(days),
        months: String(months ?? 0),
        unitPeriodsPerYear: toExplainString(unitsPerYear),
        i: toExplainString(growth),
      },
    });
  }

  const last = addMonths(payment.date, -MONTHS_PER_YEAR * years);
  const remainingDays = daysBetween(advance.date, last);
  const months = wholeMonthsBack(
    advance.date,
    payment.date,
    MONTHS_PER_YEAR * years,
    0,
    MONTHS_PER_YEAR - 1,
  );
  const fraction: Rational =
    months === null
      ? rational(BigInt(remainingDays), DAYS_PER_YEAR)
      : rational(BigInt(months), BigInt(MONTHS_PER_YEAR));
  const f = toNumber(fraction);
  const logRatio = Math.log(toNumber(ratio));
  // ln of both sides: increasing in i on (−1, ∞) because 0 ≤ f ≤ 1 (f = 365/365 when the
  // remainder is a 366-day year less one day), and free of the overflow of (1 + i)^t near
  // the top of the range.
  const root = solveSingleRoot((x) => Math.log1p(f * x) + years * Math.log1p(x) - logRatio);
  if (root === null) {
    return NO_CONVERGENCE;
  }
  return buildMetric(root * 100, precision, {
    formulaId: 'rate.regz-single-payment',
    values: {
      ...amounts,
      days: String(remainingDays),
      months: String(months ?? 0),
      unitPeriodsPerYear: '1',
      i: numberToExplainString(root),
      t: String(years),
      f: toExplainString(fraction),
    },
  });
}
