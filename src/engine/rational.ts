// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Exact rational numbers on BigInt (SPEC §1.6). Every value a posted amount is rounded
 * from is built from the inputs with + − × ÷ and integer powers, so it is held as an
 * exact fraction and rounded once, at the posting point.
 *
 * Values are immutable and normalized: the denominator is positive and the fraction is
 * in lowest terms. Large intermediates (a power with 1 200 periods has thousands of
 * digits) avoid the gcd where it is provably unnecessary.
 */

import type { RoundingMode } from './types';

/** An exact fraction `n / d` with `d > 0` and `gcd(|n|, d) = 1`. */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

const ZERO_BIGINT = 0n;
const ONE_BIGINT = 1n;

function abs(value: bigint): bigint {
  return value < ZERO_BIGINT ? -value : value;
}

/** Greatest common divisor of two non-negative integers (Euclid). */
export function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== ZERO_BIGINT) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

/**
 * Builds `n / d` in lowest terms.
 *
 * @throws RangeError if `d` is zero.
 */
export function rational(n: bigint, d: bigint = ONE_BIGINT): Rational {
  if (d === ZERO_BIGINT) {
    throw new RangeError('Rational with a zero denominator');
  }
  if (n === ZERO_BIGINT) {
    return ZERO;
  }
  const sign = d < ZERO_BIGINT ? -ONE_BIGINT : ONE_BIGINT;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** 0. */
export const ZERO: Rational = Object.freeze({ n: 0n, d: 1n });
/** 1. */
export const ONE: Rational = Object.freeze({ n: 1n, d: 1n });

/** The integer `value` as a rational. */
export function fromInteger(value: bigint | number): Rational {
  return { n: BigInt(value), d: ONE_BIGINT };
}

/** `a + b`. */
export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

/** `a − b`. */
export function sub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

/** `a × b`. */
export function mul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

/**
 * `a ÷ b`.
 *
 * @throws RangeError if `b` is zero.
 */
export function div(a: Rational, b: Rational): Rational {
  if (b.n === ZERO_BIGINT) {
    throw new RangeError('Division by zero');
  }
  return rational(a.n * b.d, a.d * b.n);
}

/** `−a`. */
export function neg(a: Rational): Rational {
  return a.n === ZERO_BIGINT ? ZERO : { n: -a.n, d: a.d };
}

/**
 * `a^k` for an integer `k` (negative powers invert).
 *
 * The powers of a fraction in lowest terms are in lowest terms too, so no gcd is taken:
 * `(1 + i)^1200` stays cheap although it has thousands of digits.
 *
 * @throws RangeError for `0^k` with `k < 0`.
 */
export function pow(a: Rational, k: number): Rational {
  if (!Number.isInteger(k)) {
    throw new RangeError(`Rational power needs an integer exponent, got ${String(k)}`);
  }
  if (k === 0) {
    return ONE;
  }
  if (a.n === ZERO_BIGINT) {
    if (k < 0) {
      throw new RangeError('Zero to a negative power');
    }
    return ZERO;
  }
  const e = BigInt(Math.abs(k));
  const n = a.n ** e;
  const d = a.d ** e;
  return k > 0 ? { n, d } : n < ZERO_BIGINT ? { n: -d, d: -n } : { n: d, d: n };
}

/** −1, 0 or 1. */
export function sign(a: Rational): -1 | 0 | 1 {
  return a.n === ZERO_BIGINT ? 0 : a.n < ZERO_BIGINT ? -1 : 1;
}

/** −1, 0 or 1 as `a` is less than, equal to or greater than `b`. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const diff = a.n * b.d - b.n * a.d;
  return diff === ZERO_BIGINT ? 0 : diff < ZERO_BIGINT ? -1 : 1;
}

/** Whether `a = b`. */
export function equals(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

/** Whether `a` is a whole number. */
export function isInteger(a: Rational): boolean {
  return a.d === ONE_BIGINT;
}

/**
 * Rounds the exact quotient `num / den` to an integer with the given mode (SPEC §1.3).
 * `half-up` sends ties away from zero, `half-even` to the even neighbour.
 *
 * @throws RangeError if `den` is zero.
 */
export function divRound(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den === ZERO_BIGINT) {
    throw new RangeError('Division by zero');
  }
  let n = num;
  let d = den;
  if (d < ZERO_BIGINT) {
    n = -n;
    d = -d;
  }
  const negative = n < ZERO_BIGINT;
  const magnitude = negative ? -n : n;
  const q = magnitude / d;
  const r = magnitude % d;
  if (r === ZERO_BIGINT) {
    return negative ? -q : q;
  }
  let up: boolean;
  switch (mode) {
    case 'ceil':
      up = !negative;
      break;
    case 'floor':
      up = negative;
      break;
    case 'half-up':
      up = 2n * r >= d;
      break;
    case 'half-even': {
      const twice = 2n * r;
      up = twice > d || (twice === d && q % 2n === ONE_BIGINT);
      break;
    }
  }
  const rounded = up ? q + ONE_BIGINT : q;
  return negative ? -rounded : rounded;
}

/** Rounds `a` to an integer with the given mode. */
export function roundToInteger(a: Rational, mode: RoundingMode): bigint {
  return divRound(a.n, a.d, mode);
}

/** `floor(a)`. */
export function floor(a: Rational): bigint {
  return divRound(a.n, a.d, 'floor');
}

/**
 * Parses a plain decimal string ("-12.5", "0.065", "100000.00") exactly. The caller
 * validates the syntax first (see `DECIMAL_STRING` in `money.ts`).
 *
 * @throws RangeError if the text is not a plain decimal.
 */
export function parseDecimal(text: string): Rational {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    throw new RangeError(`Not a plain decimal: "${text}"`);
  }
  const [, minus = '', whole = '0', fraction = ''] = match;
  const digits = BigInt(whole + fraction);
  return rational(minus === '-' ? -digits : digits, 10n ** BigInt(fraction.length));
}

/** Whether the denominator has no prime factors other than 2 and 5. */
function isTerminating(d: bigint): boolean {
  let rest = d;
  while (rest % 2n === ZERO_BIGINT) {
    rest /= 2n;
  }
  while (rest % 5n === ZERO_BIGINT) {
    rest /= 5n;
  }
  return rest === ONE_BIGINT;
}

/** Digits of `10^k` needed to make a terminating denominator `d` divide it. */
function decimalPlacesOf(d: bigint): number {
  let places = 0;
  let scale = ONE_BIGINT;
  while (scale % d !== ZERO_BIGINT) {
    scale *= 10n;
    places += 1;
  }
  return places;
}

/** Formats the integer `scaled / 10^places` as a plain decimal string. */
export function formatScaled(scaled: bigint, places: number): string {
  const negative = scaled < ZERO_BIGINT;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, '0');
  const whole = places === 0 ? digits : digits.slice(0, digits.length - places);
  const fraction = places === 0 ? '' : `.${digits.slice(digits.length - places)}`;
  const text = `${whole}${fraction}`;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/**
 * A decimal string for explanations (SPEC §9.6): exact when the value terminates
 * ("0.065", "1508.125"), otherwise rounded half-up to `significant` significant digits
 * (default 20, at least the 12 the SPEC requires), trailing zeros dropped. An integer part
 * longer than that is kept whole (rounded to units), never written in exponent notation.
 */
export function toExplainString(a: Rational, significant = 20): string {
  if (isTerminating(a.d)) {
    return formatScaled((a.n * 10n ** BigInt(decimalPlacesOf(a.d))) / a.d, decimalPlacesOf(a.d));
  }
  // Position of the first significant digit: 10^e ≤ |a| < 10^(e+1).
  const magnitude = abs(a.n);
  let e = magnitude.toString().length - a.d.toString().length;
  const pow10 = (k: number): Rational =>
    k >= 0 ? fromInteger(10n ** BigInt(k)) : rational(ONE_BIGINT, 10n ** BigInt(-k));
  const absolute: Rational = { n: magnitude, d: a.d };
  if (compare(absolute, pow10(e)) < 0) {
    e -= 1;
  }
  const places = Math.max(0, significant - 1 - e);
  const scaled = divRound(a.n * 10n ** BigInt(places), a.d, 'half-up');
  return formatScaled(scaled, places)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/** Number of binary digits of a positive integer. */
function bitLength(value: bigint): number {
  return value.toString(2).length;
}

/**
 * A double approximation of `a` for analytics (SPEC §0.2); never used for ledger money.
 * Correctly rounded for every result in the normal double range, however many digits the
 * numerator and denominator have (`(1 + i)^1200`); beyond that range it is ±Infinity or a
 * (possibly zero) subnormal.
 */
export function toNumber(a: Rational): number {
  if (a.n === ZERO_BIGINT) {
    return 0;
  }
  const magnitude = abs(a.n);
  // Scale the integer quotient to 64–65 significant bits so that it is rounded to a double
  // once. The sticky bit keeps that rounding correct when the division is inexact: a
  // truncated quotient could otherwise look like an exact tie.
  const shift = bitLength(a.d) - bitLength(magnitude) + 64;
  const numerator = shift >= 0 ? magnitude << BigInt(shift) : magnitude;
  const denominator = shift >= 0 ? a.d : a.d << BigInt(-shift);
  let quotient = numerator / denominator;
  if (numerator % denominator !== ZERO_BIGINT) {
    quotient |= ONE_BIGINT;
  }
  // 2^−shift alone can leave the double range when the result does not: scale in two steps.
  const half = Math.trunc(shift / 2);
  const value = Number(quotient) * 2 ** -half * 2 ** -(shift - half);
  return a.n < ZERO_BIGINT ? -value : value;
}
