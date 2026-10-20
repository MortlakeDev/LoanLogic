// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The level instalment of an annuity (SPEC §5.2) and of a balloon loan (§5.5): the exact
 * value `A*` and the posted instalment `A = R_pay(A*)` (§1.5).
 *
 * `A*` is exact whenever the periodic rate is rational (§1.6): the quotient is built from
 * BigInt numerators and denominators and rounded once. The powers `(1 + i)^N` have
 * thousands of digits for long loans, so the fraction is never reduced (a gcd of such
 * numbers would dominate the run time); rounding and the explanation string work on the
 * unreduced quotient directly.
 */

import { decimalWithDigits, digitCount } from '../decimal';
import { type Rational, divRound, formatScaled } from '../rational';
import { type Real, approx, pow10, realToExplainString, roundPayment } from '../rounding';
import type { PaymentRounding } from '../types';

/** A posted instalment with the exact value it was rounded from. */
export interface Instalment {
  /** The posted instalment `A` in minor units. */
  readonly amount: bigint;
  /**
   * The exact instalment `A*` in major units as an explanation string (SPEC §9.6): exact
   * when it terminates ("1508.125"), otherwise 20 significant digits.
   */
  readonly exact: string;
}

/** Significant digits of a non-terminating explanation value (SPEC §9.6 asks for ≥ 12). */
const EXPLAIN_SIGNIFICANT_DIGITS = 20;

/** Drops trailing fraction zeros and a bare point: "4454.6250" → "4454.625", "12.0" → "12". */
function trimFraction(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Number of bits of a positive integer. */
function bitLength(value: bigint): number {
  return value.toString(2).length;
}

/**
 * Splits a positive integer into `5^fives × rest` with `rest` not divisible by 5.
 *
 * A long schedule's denominator can hold hundreds of factors 5 (`b^N` for a rate with
 * many decimals), and one BigInt division per factor costs about a millisecond on numbers
 * of millions of bits. Dividing by `5^(2^s)`, largest first, needs a few dozen divisions.
 */
function splitFives(value: bigint): { readonly rest: bigint; readonly fives: number } {
  const powers: bigint[] = [5n];
  for (let top = 5n; value % (top * top) === 0n; top *= top) {
    powers.push(top * top);
  }
  // value is not divisible by 5^(2^powers.length), so the count of factors has at most
  // powers.length binary digits: one division per level at most.
  let rest = value;
  let fives = 0;
  for (const [level, power] of [...powers.entries()].reverse()) {
    if (rest % power === 0n) {
      rest /= power;
      fives += 2 ** level;
    }
  }
  return { rest, fives };
}

/**
 * An explanation string for the exact quotient `num / den` (SPEC §9.6), which need not be
 * in lowest terms: the exact decimal when the value terminates, otherwise rounded half-up
 * to 20 significant digits; trailing zeros dropped, never "-0".
 *
 * The value terminates exactly when the part of `den` that is coprime to 10 divides `num`
 * (it then divides the gcd), which avoids reducing huge fractions.
 *
 * @throws RangeError if `den` is zero.
 */
export function quotientToExplainString(num: bigint, den: bigint): string {
  if (den === 0n) {
    throw new RangeError('Division by zero');
  }
  const n = den < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  if (n === 0n) {
    return '0';
  }
  // d & −d isolates the lowest set bit: one pass instead of one shift per factor 2.
  const twos = bitLength(d & -d) - 1;
  const { rest, fives } = splitFives(d >> BigInt(twos));
  if (n % rest === 0n) {
    // d = 2^twos · 5^fives · rest and rest | n, so n · 10^max(twos, fives) / d is whole.
    const places = Math.max(twos, fives);
    return trimFraction(formatScaled((n * pow10(places)) / d, places));
  }
  // e = floor(log10(|n| / d)): estimate from the bit lengths, then correct exactly.
  const magnitude = n < 0n ? -n : n;
  let e = Math.floor((bitLength(magnitude) - bitLength(d)) * Math.log10(2));
  const atLeastPow10 = (k: number): boolean =>
    k >= 0 ? magnitude >= d * pow10(k) : magnitude * pow10(-k) >= d;
  while (!atLeastPow10(e)) {
    e -= 1;
  }
  while (atLeastPow10(e + 1)) {
    e += 1;
  }
  const places = Math.max(0, EXPLAIN_SIGNIFICANT_DIGITS - 1 - e);
  return trimFraction(formatScaled(divRound(n * pow10(places), d, 'half-up'), places));
}

/**
 * Rounds the exact quotient `num / den` (in minor units) with a payment rounding policy
 * (SPEC §1.5): `minor-*` to the minor unit, `unit-*` to whole currency units; `*-ceil`
 * rounds up, `*-half-up` to the nearest with ties away from zero. Same result as
 * `roundPayment` on the value in major units, without building a reduced rational.
 *
 * @returns `A` in minor units.
 */
export function roundInstalmentQuotient(
  num: bigint,
  den: bigint,
  minorUnits: number,
  policy: PaymentRounding,
): bigint {
  const mode = policy === 'minor-ceil' || policy === 'unit-ceil' ? 'ceil' : 'half-up';
  const unit = policy === 'unit-half-up' || policy === 'unit-ceil' ? pow10(minorUnits) : 1n;
  return divRound(num, den * unit, mode) * unit;
}

/** An instalment from its exact quotient `num / den` in minor units. */
function fromQuotient(
  num: bigint,
  den: bigint,
  minorUnits: number,
  policy: PaymentRounding,
): Instalment {
  return {
    amount: roundInstalmentQuotient(num, den, minorUnits, policy),
    exact: quotientToExplainString(num, den * pow10(minorUnits)),
  };
}

/**
 * The level instalment that repays `principal` over `payments` periods at the periodic
 * rate `i` and leaves `residual` outstanding after the last of them (SPEC §5.2, §5.5):
 *
 * - `A* = (P − Bal·(1 + i)^−N) · i / (1 − (1 + i)^−N)` for `i ≠ 0`,
 * - `A* = (P − Bal) / N` for `i = 0`,
 * - `A = R_pay(A*)`.
 *
 * A rational `i` is evaluated exactly as `(P·(1 + i)^N − Bal) · i / ((1 + i)^N − 1)`; an
 * irrational `i` in decimal arithmetic with 60 significant digits plus one per leading zero
 * of `i` (the cancellation in `1 − (1 + i)^−N` consumes them) plus the digits of `P` in
 * minor units (so `A*` stays exact to the minor unit for large amounts).
 *
 * @param principal Principal financed `P` in minor units.
 * @param rate Periodic rate `i` per payment period, as a fraction (0.065 / 12).
 * @param payments Number of payments `N` (≥ 1).
 * @param minorUnits Digits of the currency's minor unit.
 * @param policy Payment rounding policy for `A`.
 * @param residual Balloon `Bal` in minor units; 0 for an annuity.
 */
export function levelInstalment(
  principal: bigint,
  rate: Real,
  payments: number,
  minorUnits: number,
  policy: PaymentRounding,
  residual = 0n,
): Instalment {
  if (rate.kind === 'exact') {
    return exactLevelInstalment(principal, rate.value, payments, minorUnits, policy, residual);
  }
  if (rate.value.isZero()) {
    return fromQuotient(principal - residual, BigInt(payments), minorUnits, policy);
  }
  // 1 − (1 + i)^−N is about N·|i| for a small rate. At a fixed 50 digits its leading digits
  // cancel and 1 + i drops the last digits of i, so A* of a tiny rate (i ≈ 1e−29) would
  // land on P / N and miss the rounding boundary next to it, far outside SPEC §1.6. One
  // extra digit per leading zero of i keeps 1 + i exact and A* at 50 significant digits.
  // The digits of P (in minor units) keep A* exact to the minor unit for large amounts.
  const Wide = decimalWithDigits(-rate.value.e, digitCount(principal));
  const i = new Wide(rate.value);
  const scale = new Wide(10).pow(minorUnits);
  const p = new Wide(principal.toString()).div(scale);
  const bal = new Wide(residual.toString()).div(scale);
  const discount = i.plus(1).pow(-payments);
  const astar = p.minus(bal.times(discount)).times(i).div(new Wide(1).minus(discount));
  const value = approx(astar);
  return { amount: roundPayment(value, minorUnits, policy), exact: realToExplainString(value) };
}

/** `levelInstalment` for a rational `i = a / b`, exactly. */
function exactLevelInstalment(
  principal: bigint,
  rate: Rational,
  payments: number,
  minorUnits: number,
  policy: PaymentRounding,
  residual: bigint,
): Instalment {
  if (rate.n === 0n) {
    return fromQuotient(principal - residual, BigInt(payments), minorUnits, policy);
  }
  // With i = a/b and u = a + b: (1 + i)^N = u^N / b^N, so
  // A* = (P·u^N − Bal·b^N) · a / (b · (u^N − b^N)). i > −1 keeps u positive, and i ≠ 0
  // keeps u^N ≠ b^N.
  const a = rate.n;
  const b = rate.d;
  const exponent = BigInt(payments);
  const uN = (a + b) ** exponent;
  const bN = b ** exponent;
  return fromQuotient((principal * uN - residual * bN) * a, b * (uN - bN), minorUnits, policy);
}

/**
 * The annuity instalment of the day-count `exact` payment basis (SPEC §5.2), which solves
 * the recurrence with a different rate in every period, `r_k = j × YF_k`:
 *
 * `A* = P × Π_{k=1..N}(1 + r_k) / Σ_{s=1..N} Π_{k=s+1..N}(1 + r_k)`, `A = R_pay(A*)`.
 *
 * Evaluated exactly. The denominator is accumulated by Horner's rule
 * (`H = 1; for k = 2..N: H = 1 + (1 + r_k)·H`) with unreduced numerators and
 * denominators; the denominator of `H` is `Π_{k≥2} d_k`, which cancels against the
 * product, so `A* = P × Π_k (d_k + n_k) / (d_1 × num(H))` for `r_k = n_k / d_k`.
 *
 * @param principal Principal financed `P` in minor units.
 * @param periodRates `r_1 … r_N`, each `j × YF_k` as an exact fraction (each > −1).
 * @param minorUnits Digits of the currency's minor unit.
 * @param policy Payment rounding policy for `A`.
 * @throws RangeError if `periodRates` is empty.
 */
export function exactBasisInstalment(
  principal: bigint,
  periodRates: readonly Rational[],
  minorUnits: number,
  policy: PaymentRounding,
): Instalment {
  const [first, ...later] = periodRates;
  if (first === undefined) {
    throw new RangeError('An instalment needs at least one period');
  }
  let product = first.d + first.n;
  let hNum = 1n;
  let hDen = 1n;
  for (const r of later) {
    const growth = r.d + r.n;
    product *= growth;
    hNum = hDen * r.d + growth * hNum;
    hDen *= r.d;
  }
  return fromQuotient(principal * product, first.d * hNum, minorUnits, policy);
}
