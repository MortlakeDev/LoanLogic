// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Metrics of the periodic IRR `r` (SPEC §9.2, §9.3 a and d): `irrNominal = r·m`,
 * `irrEffective = (1 + r)^m − 1`, `cnAnnualized = r·m` and the US APR `r·m` of a regular
 * schedule with two or more payments.
 */

import { fromInteger } from '../rational';
import type { SolveResult } from '../solvers';
import type { CashFlow, RateFailure, RateMetric } from '../types';
import { METHOD_PRECISION, NO_CONVERGENCE, buildMetric, numberToExplainString } from './display';
import { type TimedFlow, solveTimedFlows } from './solve';

/** The metrics built from the periodic IRR. */
export type PeriodicIrrMethod = 'irrNominal' | 'irrEffective' | 'cnAnnualized' | 'usRegZApr';

/**
 * Places each flow at its period index (SPEC §10: `Σ CF_k (1 + r)^−k = 0`).
 *
 * @throws RangeError if a flow has no period.
 */
export function periodTimes(flows: readonly CashFlow[]): TimedFlow[] {
  return flows.map((flow) => {
    if (flow.period === undefined) {
      throw new RangeError('The periodic IRR needs a period on every flow');
    }
    return { time: fromInteger(flow.period), amount: flow.amount };
  });
}

/**
 * Solves the periodic IRR `r` per payment period (SPEC §9.2).
 *
 * @param flows Flows with periods, borrower view.
 * @throws RangeError if a flow has no period.
 */
export function solvePeriodicIrr(flows: readonly CashFlow[]): SolveResult {
  return solveTimedFlows(periodTimes(flows));
}

/**
 * One metric of the periodic IRR (SPEC §9.2, §9.3): `r·m` for `irrNominal`,
 * `cnAnnualized` and `usRegZApr`, `(1 + r)^m − 1` for `irrEffective`; in percent.
 * Explanation `rate.periodic-irr` with `r` and `m`. A failed solve fails the metric.
 *
 * @param method Which metric.
 * @param result The periodic solve.
 * @param m Payment periods per year.
 */
export function periodicIrrMetric(
  method: PeriodicIrrMethod,
  result: SolveResult,
  m: number,
): RateMetric | RateFailure {
  if (!result.ok) {
    return NO_CONVERGENCE;
  }
  const r = result.root;
  // expm1/log1p keep the digits of a small r; (1 + r)^m − 1 would cancel them.
  const value = method === 'irrEffective' ? Math.expm1(m * Math.log1p(r)) * 100 : r * m * 100;
  return buildMetric(
    value,
    METHOD_PRECISION[method],
    { formulaId: 'rate.periodic-irr', values: { r: numberToExplainString(r), m: String(m) } },
    result.multiple,
  );
}
