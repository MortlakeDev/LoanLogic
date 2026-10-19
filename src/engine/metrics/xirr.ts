// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The XIRR family (SPEC §9.2, §9.3 e and f): `xirr`, `uaRealAnnual` and `international`
 * solve `Σ CF_k (1 + X)^−τ_k = 0` with `τ_k = days(D0, t_k) / 365`, also in leap years
 * (the Excel XIRR convention).
 */

import { daysBetween } from '../date';
import { rational } from '../rational';
import type { SolveResult } from '../solvers';
import type { CashFlow } from '../types';
import { type TimedFlow, solveTimedFlows } from './solve';

/** Days per year of the XIRR convention. */
const XIRR_YEAR_DAYS = 365n;

/**
 * Places each flow at `days(D0, date) / 365` years, `D0` being the first flow's date.
 *
 * @param flows Flows in non-decreasing date order (at least one).
 */
export function xirrTimes(flows: readonly CashFlow[]): TimedFlow[] {
  const start = flows[0]?.date;
  if (start === undefined) {
    return [];
  }
  return flows.map((flow) => ({
    time: rational(BigInt(daysBetween(start, flow.date)), XIRR_YEAR_DAYS),
    amount: flow.amount,
  }));
}

/**
 * Solves the XIRR `X` (annual, decimal fraction) of the flows (SPEC §9.2).
 *
 * @param flows Flows in non-decreasing date order, borrower view.
 */
export function solveXirr(flows: readonly CashFlow[]): SolveResult {
  return solveTimedFlows(xirrTimes(flows));
}
