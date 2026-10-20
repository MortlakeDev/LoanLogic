// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Display precision and rounding of rate metrics (SPEC §9.4, §9.6), and the decimal
 * strings of their explanations.
 */

import { EngineDecimal } from '../decimal';
import type { Explain, RateFailure, RateMethodId, RateMetric } from '../types';

/**
 * Decimals of `display` per method (SPEC §9.2–§9.3): generic metrics 2, US APR 3, UK and
 * EU APRC 1. `nominal` is shown as entered and has no fixed precision.
 */
export const METHOD_PRECISION: Readonly<Record<Exclude<RateMethodId, 'nominal'>, number>> =
  Object.freeze({
    effective: 2,
    irrNominal: 2,
    irrEffective: 2,
    xirr: 2,
    usRegZApr: 3,
    ukAprc: 1,
    euAprc: 1,
    cnAnnualized: 2,
    uaRealAnnual: 2,
    international: 2,
  });

/**
 * Rounds a rate for display (SPEC §9.4): half-up (ties away from zero) to `precision`
 * decimals, starting from the double's shortest decimal representation, as a plain
 * string. A value that rounds to zero is shown without a sign ("0.00", never "-0.00").
 *
 * @param value Rate in percent (6.97421… for 6.974 %), finite.
 * @param precision Decimals to show (0 or more).
 */
export function formatRateDisplay(value: number, precision: number): string {
  const rounded = new EngineDecimal(value).toDecimalPlaces(precision, EngineDecimal.ROUND_HALF_UP);
  return (rounded.isZero() ? rounded.abs() : rounded).toFixed(precision);
}

/**
 * The `nominal` display (SPEC §9.2): the rate as entered with at least two decimals —
 * "12" → "12.00", "6.875" → "6.875", "6.50" → "6.50", "-0.5" → "-0.50", "-0" → "0.00".
 *
 * @param entered The entered percent as a plain decimal string (SPEC §15).
 * @returns The display string and its number of decimals.
 * @throws RangeError if `entered` is not a plain decimal string.
 */
export function formatNominalDisplay(entered: string): {
  readonly display: string;
  readonly precision: number;
} {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(entered);
  if (match === null) {
    throw new RangeError(`Not a plain decimal: "${entered}"`);
  }
  const [, minus = '', whole = '0', fraction = ''] = match;
  const decimals = fraction.padEnd(2, '0');
  const isZero = /^0+$/.test(whole + decimals);
  return {
    display: `${minus === '-' && !isZero ? '-' : ''}${whole}.${decimals}`,
    precision: decimals.length,
  };
}

/**
 * A double as a plain decimal string for explanations (SPEC §9.6): its shortest
 * round-trip digits, never in exponent notation ("0.000000000000001", not "1e-15").
 *
 * @param value A finite double.
 */
export function numberToExplainString(value: number): string {
  // −0 would print as "-0".
  return new EngineDecimal(value === 0 ? 0 : value).toFixed();
}

/**
 * Largest magnitude of a metric computed from a solved rate, in percent: ±1e7 as a
 * fraction, ±10⁹ % (SPEC §10 "Range of results").
 */
export const RESULT_LIMIT_PERCENT = 1e9;

/** Whether a metric value in percent lies within the result range of SPEC §10. */
export function withinResultRange(valuePercent: number): boolean {
  return Number.isFinite(valuePercent) && Math.abs(valuePercent) <= RESULT_LIMIT_PERCENT;
}

/** The failure of a metric that has no root or did not converge (SPEC §10). */
export const NO_CONVERGENCE: RateFailure = Object.freeze({
  ok: false,
  reason: 'IRR_NO_CONVERGENCE',
});

/**
 * Builds a metric from its unrounded value: the display per `precision`, the
 * `IRR_MULTIPLE` warning when the root was chosen among several, and the explanation.
 * A value that is not finite (a rate beyond the range of doubles) is a failure, never
 * a substituted number.
 *
 * @param value Rate in percent.
 * @param precision Decimals of the display.
 * @param explain The explanation payload.
 * @param multiple Whether the solver found two or more roots.
 */
export function buildMetric(
  value: number,
  precision: number,
  explain: Explain,
  multiple = false,
): RateMetric | RateFailure {
  if (!Number.isFinite(value)) {
    return NO_CONVERGENCE;
  }
  const base = { value, display: formatRateDisplay(value, precision), precision };
  return multiple ? { ...base, warnings: ['IRR_MULTIPLE'], explain } : { ...base, explain };
}
