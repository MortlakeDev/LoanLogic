// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The interest-rate model (SPEC §3): the periodic rate `i` and the interest of a period.
 * `i` is exact whenever it is rational — always for `j = 0`, for `c = m` and when `c/m` is
 * a positive integer — and a 50-digit decimal otherwise (§1.6).
 */

import { type EngineDecimalValue, decimalWithDigits, fromRational } from './decimal';
import { periodsPerYear } from './frequency';
import {
  type Rational,
  ONE,
  ZERO,
  add,
  div,
  divRound,
  fromInteger,
  pow,
  sign,
  sub,
} from './rational';
import { type Real, approx, exact, roundToMinor } from './rounding';
import type { CompoundingId, FrequencyId, RoundingMode } from './types';

/** Compounding periods per year, or `null` for continuous compounding. */
export function compoundingPerYear(compounding: CompoundingId): number | null {
  return compounding === 'continuous' ? null : periodsPerYear(compounding);
}

/**
 * The periodic rate `i` of periodic accrual (SPEC §3.2):
 *
 * - `j = 0` → 0 exactly, whatever the compounding;
 * - `c = m` → `j / m`;
 * - `c ≠ m` → `(1 + j/c)^(c/m) − 1`, exact when `c/m` is a positive integer;
 * - continuous → `e^(j/m) − 1`.
 *
 * An irrational `i` is evaluated with one extra digit per leading zero of `j/m` (the
 * subtraction of 1 cancels them) and `amountDigits` more, so `B × i` stays exact to far
 * below the minor unit for balances of that size (SPEC §1.6).
 *
 * @param rate Nominal annual rate `j` as a decimal fraction (0.065).
 * @param amountDigits Decimal digits of the largest balance in minor units (that of the
 *   principal financed); 0 when unknown.
 */
export function periodicRate(
  rate: Rational,
  frequency: FrequencyId,
  compounding: CompoundingId,
  amountDigits = 0,
): Real {
  const m = periodsPerYear(frequency);
  if (sign(rate) === 0) {
    return exact(ZERO);
  }
  const c = compoundingPerYear(compounding);
  // i ≈ j/m in every irrational case; its leading zeros are the digits that cancel.
  const Wide = decimalWithDigits(-fromRational(rate).div(m).e, amountDigits);
  const exactly = (value: Rational): EngineDecimalValue =>
    new Wide(value.n.toString()).div(value.d.toString());
  if (c === null) {
    return approx(exactly(rate).div(m).exp().minus(1));
  }
  if (c === m) {
    return exact(div(rate, fromInteger(m)));
  }
  const perPeriod = add(ONE, div(rate, fromInteger(c)));
  if (c % m === 0) {
    return exact(sub(pow(perPeriod, c / m), ONE));
  }
  // (1 + j/c)^(c/m) − 1 = exp((c/m) · ln(1 + j/c)) − 1, irrational.
  return approx(exactly(perPeriod).ln().times(new Wide(c).div(m)).exp().minus(1));
}

/**
 * Interest of a periodic period, `R_int(B × i)` (SPEC §3.2, §5.1), in minor units. The
 * product is formed exactly before the single rounding: 2 700.00 × 0.065 / 12 = 14.625.
 *
 * @param balance Opening balance `B` in minor units.
 */
export function periodicInterest(balance: bigint, rate: Real, mode: RoundingMode): bigint {
  // B is in minor units, so B × i is already in minor units.
  if (rate.kind === 'exact') {
    return divRound(balance * rate.value.n, rate.value.d, mode);
  }
  return roundToMinor(approx(rate.value.times(balance.toString())), 0, mode);
}

/**
 * Interest of a day-count period, `R_int(B × j × YF)` (SPEC §3.3), in minor units,
 * evaluated exactly.
 *
 * @param balance Opening balance `B` in minor units.
 * @param rate Nominal annual rate `j` as a decimal fraction.
 * @param yearFraction Exact year fraction of the period (§4).
 */
export function dayCountInterest(
  balance: bigint,
  rate: Rational,
  yearFraction: Rational,
  mode: RoundingMode,
): bigint {
  return divRound(balance * rate.n * yearFraction.n, rate.d * yearFraction.d, mode);
}
