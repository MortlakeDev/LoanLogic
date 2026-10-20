// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Decimal strings and minor units: the syntax of SPEC §15's `DecimalString`, exact
 * parsing to minor units (§1.2) and formatting of ledger amounts.
 */

import { type Rational, formatScaled, parseDecimal } from './rational';

/**
 * A plain decimal string (SPEC §15): optional "-", digits without leading zeros, optional
 * ".digits". No "+", no exponent, no grouping, no spaces.
 */
export const DECIMAL_STRING = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Whether `value` is a string in the plain decimal syntax of SPEC §15. */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_STRING.test(value);
}

/** Exact value of a decimal string that passed `isDecimalString`. */
export function decimalValue(text: string): Rational {
  return parseDecimal(text);
}

/**
 * The amount as a whole number of minor units, or `undefined` if it has more decimals
 * than the currency allows ("100.100" USD is 10010; "100.005" USD is `undefined`).
 */
export function toMinorUnits(text: string, minorUnits: number): bigint | undefined {
  const value = parseDecimal(text);
  const scaled = value.n * 10n ** BigInt(minorUnits);
  return scaled % value.d === 0n ? scaled / value.d : undefined;
}

/**
 * Formats minor units as a decimal string at the currency's minor units: 123450 with 2
 * digits is "1234.50", with 0 digits "123450"; zero is "0.00", never "-0.00".
 */
export function formatMinor(minor: bigint, minorUnits: number): string {
  return formatScaled(minor, minorUnits);
}
