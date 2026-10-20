// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Cash flows with exact times, their conversion to solver input, and the metric of an
 * annual rate `X` (SPEC §9.2–§9.3, §10).
 */

import { type Rational, add, toNumber } from '../rational';
import { type SolveResult, type SolverFlow, solveRate } from '../solvers';
import type { RateFailure, RateMetric } from '../types';
import { NO_CONVERGENCE, buildMetric, numberToExplainString } from './display';

/** A flow placed on a time axis: exact time (periods or years) and exact amount. */
export interface TimedFlow {
  /** Time from the first flow, `≥ 0`, in the unit of the equation (periods or years). */
  readonly time: Rational;
  /** Amount in major units (borrower view). */
  readonly amount: Rational;
}

/** `⌊log2 |value|⌋` within one, for a non-zero rational. */
function binaryMagnitude(value: Rational): number {
  const n = value.n < 0n ? -value.n : value.n;
  return n.toString(2).length - value.d.toString(2).length;
}

/** `value × 2^−shift`, exactly (the fraction is left unreduced; only `toNumber` reads it). */
function scaleByPowerOfTwo(value: Rational, shift: number): Rational {
  return shift >= 0
    ? { n: value.n, d: value.d << BigInt(shift) }
    : { n: value.n << BigInt(-shift), d: value.d };
}

/**
 * Sums the flows of equal times exactly, then converts times and sums to doubles
 * (SPEC §0.2, §10). Summing before the conversion keeps a sum that is exactly zero at
 * zero, so it cannot create a spurious sign change.
 *
 * Every sum is first scaled by one common power of two that brings the largest to about
 * 1. The equation `Σ a_k (1 + x)^−t_k = 0` is homogeneous in the amounts, so the roots do
 * not change, while amounts beyond the double range (fee values have no upper bound) can
 * no longer overflow to ±Infinity or underflow to 0. In the normal double range a power
 * of two changes no bit of any result.
 */
export function toSolverFlows(flows: readonly TimedFlow[]): SolverFlow[] {
  const groups = new Map<string, { time: Rational; amount: Rational }>();
  for (const flow of flows) {
    const key = `${flow.time.n.toString()}/${flow.time.d.toString()}`;
    const group = groups.get(key);
    groups.set(
      key,
      group === undefined
        ? { time: flow.time, amount: flow.amount }
        : { time: group.time, amount: add(group.amount, flow.amount) },
    );
  }
  const sums = [...groups.values()];
  const magnitudes = sums
    .filter((group) => group.amount.n !== 0n)
    .map((group) => binaryMagnitude(group.amount));
  const shift = magnitudes.length === 0 ? 0 : Math.max(...magnitudes);
  return sums.map((group) => ({
    t: toNumber(group.time),
    amount: toNumber(scaleByPowerOfTwo(group.amount, shift)),
  }));
}

/** Solves `Σ CF_k (1 + x)^−t_k = 0` for flows on an exact time axis (SPEC §10). */
export function solveTimedFlows(flows: readonly TimedFlow[]): SolveResult {
  return solveRate(toSolverFlows(flows));
}

/** How the times of an annual-rate equation were measured (SPEC §9.6). */
export type TimeBasis = 'periods' | 'counted-back' | 'days-365';

/**
 * The metric of an annual rate `X` solved directly (APRC and the XIRR family): value
 * `X × 100`, explanation `rate.annual-irr` with `X` and the time basis.
 *
 * @param result The solve of the annual equation.
 * @param precision Decimals of the display.
 * @param timeBasis How the times were measured.
 */
export function annualRateMetric(
  result: SolveResult,
  precision: number,
  timeBasis: TimeBasis,
): RateMetric | RateFailure {
  if (!result.ok) {
    return NO_CONVERGENCE;
  }
  return buildMetric(
    result.root * 100,
    precision,
    {
      formulaId: 'rate.annual-irr',
      values: { X: numberToExplainString(result.root), timeBasis },
    },
    result.multiple,
  );
}
