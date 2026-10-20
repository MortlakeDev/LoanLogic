// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Posting-point rounding (SPEC §1.3–§1.5). A posted amount is the exact value rounded
 * once (§1.6); values are either exact rationals or, when irrational, 50-digit decimals.
 */

import {
  type EngineDecimalValue,
  EngineDecimal,
  decimalRounding,
  decimalToExplainString,
  fromRational,
} from './decimal';
import { type Rational, divRound, toExplainString, toNumber } from './rational';
import type { PaymentRounding, RoundingMode } from './types';

/**
 * A real value before posting: exact when it is rational (SPEC §1.6), otherwise a
 * decimal with at least 40 significant digits.
 */
export type Real =
  | { readonly kind: 'exact'; readonly value: Rational }
  | { readonly kind: 'decimal'; readonly value: EngineDecimalValue };

/** Wraps an exact rational. */
export function exact(value: Rational): Real {
  return { kind: 'exact', value };
}

/** Wraps an irrational value held as a decimal. */
export function approx(value: EngineDecimalValue): Real {
  return { kind: 'decimal', value };
}

/** The value as a decimal (exact rationals are converted at 50 digits). */
export function toDecimal(value: Real): EngineDecimalValue {
  return value.kind === 'exact' ? fromRational(value.value) : value.value;
}

/** A double approximation for analytics only. */
export function realToNumber(value: Real): number {
  return value.kind === 'exact' ? toNumber(value.value) : value.value.toNumber();
}

/** Explanation string (SPEC §9.6): exact when terminating, else 20 significant digits. */
export function realToExplainString(value: Real): string {
  return value.kind === 'exact'
    ? toExplainString(value.value)
    : decimalToExplainString(value.value);
}

/** `10^k` as a bigint. */
export function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

/**
 * Rounds an exact value in major units to minor units with the given mode, returning the
 * count of minor units: 14.625 USD half-up → 1463n, half-even → 1462n.
 */
export function roundRationalToMinor(
  value: Rational,
  minorUnits: number,
  mode: RoundingMode,
): bigint {
  return divRound(value.n * pow10(minorUnits), value.d, mode);
}

/** Rounds a value in major units to minor units with the given mode. */
export function roundToMinor(value: Real, minorUnits: number, mode: RoundingMode): bigint {
  if (value.kind === 'exact') {
    return roundRationalToMinor(value.value, minorUnits, mode);
  }
  return BigInt(
    value.value
      .times(new EngineDecimal(10).pow(minorUnits))
      .toDecimalPlaces(0, decimalRounding(mode))
      .toFixed(0),
  );
}

/**
 * Rounds the exact instalment `A*` (major units) with a payment rounding policy (SPEC
 * §1.5) and returns minor units: `minor-*` to the minor unit, `unit-*` to whole currency
 * units.
 */
export function roundPayment(value: Real, minorUnits: number, policy: PaymentRounding): bigint {
  const mode: RoundingMode = policy.endsWith('ceil') ? 'ceil' : 'half-up';
  if (policy.startsWith('minor')) {
    return roundToMinor(value, minorUnits, mode);
  }
  return roundToMinor(value, 0, mode) * pow10(minorUnits);
}
