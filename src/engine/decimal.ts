// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * decimal.js for irrational values (SPEC §1.1, §1.6): periodic rates with a fractional
 * compounding power or continuous compounding, and the instalment built from them.
 * Rational values never come here; they are exact in `rational.ts`.
 *
 * The engine uses its own clone, so the global decimal.js configuration (which other code
 * may change) never affects a result.
 */

import { Decimal } from 'decimal.js';
import type { Rational } from './rational';
import type { RoundingMode } from './types';

/**
 * Base significant digits of every irrational intermediate (the SPEC requires at least
 * 40). Computations that cancel leading digits or carry large amounts widen it with
 * `decimalWithDigits`.
 */
export const DECIMAL_PRECISION = 50;

/** Digits added on top of every widening, so the 40 required digits survive rounding. */
export const GUARD_DIGITS = 10;

/** The engine's decimal.js constructor: 50 significant digits, plain-notation strings. */
export const EngineDecimal = Decimal.clone({
  // Without `defaults`, clone copies every option not listed here (minE, maxE, modulo)
  // from the global constructor as it is when this module loads.
  defaults: true,
  precision: DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** A value of the engine's decimal.js clone. */
export type EngineDecimalValue = InstanceType<typeof EngineDecimal>;

/**
 * A decimal.js constructor with `DECIMAL_PRECISION + GUARD_DIGITS` significant digits
 * plus the given extra digits (negative counts are ignored). Used where a fixed 50 digits
 * is not enough: `e^x − 1` and `1 − (1 + i)^−N` lose one digit per leading zero of a
 * small rate, and an amount with `n` digits needs `n` more digits to stay exact to the
 * minor unit (SPEC §1.6). Values keep the precision of the constructor that made them,
 * so later arithmetic on them is just as wide.
 */
export function decimalWithDigits(...extraDigits: readonly number[]): typeof EngineDecimal {
  const extra = extraDigits.reduce((total, digits) => total + Math.max(0, digits), 0);
  return EngineDecimal.clone({ precision: DECIMAL_PRECISION + GUARD_DIGITS + extra });
}

/** Decimal digits of a bigint's magnitude (1 for 0). */
export function digitCount(value: bigint): number {
  return (value < 0n ? -value : value).toString().length;
}

const ROUNDING: Readonly<Record<RoundingMode, Decimal.Rounding>> = {
  'half-up': Decimal.ROUND_HALF_UP,
  'half-even': Decimal.ROUND_HALF_EVEN,
  ceil: Decimal.ROUND_CEIL,
  floor: Decimal.ROUND_FLOOR,
};

/** The decimal.js rounding constant of a SPEC rounding mode (§1.3 table). */
export function decimalRounding(mode: RoundingMode): Decimal.Rounding {
  return ROUNDING[mode];
}

/** An exact rational as a 50-digit decimal (exact when it fits). */
export function fromRational(value: Rational): EngineDecimalValue {
  return new EngineDecimal(value.n.toString()).div(value.d.toString());
}

/** Rounds a decimal to an integer with the given mode and returns it as a `bigint`. */
export function roundDecimalToInteger(value: EngineDecimalValue, mode: RoundingMode): bigint {
  return BigInt(value.toDecimalPlaces(0, ROUNDING[mode]).toFixed(0));
}

/**
 * A decimal string for explanations (SPEC §9.6): 20 significant digits, trailing zeros
 * dropped, never in exponent notation.
 */
export function decimalToExplainString(value: EngineDecimalValue): string {
  const text = value.toSignificantDigits(20, Decimal.ROUND_HALF_UP).toFixed();
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
