// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/** The `effective` metric (SPEC §9.2): the contract rate compounded over a year, no fees. */

import { fromRational } from '../decimal';
import { periodsPerYear } from '../frequency';
import { compoundingPerYear } from '../rates';
import {
  type Rational,
  ONE,
  add,
  div,
  fromInteger,
  mul,
  pow,
  rational,
  sub,
  toExplainString,
  toNumber,
} from '../rational';
import type { RateFailure, RateMetric } from '../types';
import { METHOD_PRECISION, buildMetric } from './display';
import type { ContractRate } from './types';

const HUNDRED = fromInteger(100);

/** `k` of ACT/360: a 365-day year of ACT/360 interest (SPEC §9.2). */
const ACT_360_YEAR: Rational = rational(365n, 360n);

/** `(1 + x/n)^n − 1`, exact. */
function compoundOverYear(x: Rational, n: number): Rational {
  return sub(pow(add(ONE, div(x, fromInteger(n))), n), ONE);
}

/**
 * `effective` (SPEC §9.2), the contract rate without fees:
 *
 * - periodic accrual with `c` compounding periods per year: `(1 + j/c)^c − 1`;
 * - continuous compounding: `e^j − 1`;
 * - day-count accrual: `(1 + j·k/m)^m − 1` with `m` payments per year and `k = 365/360`
 *   for ACT/360 (else `k = 1`).
 *
 * Rational cases are evaluated exactly and converted to a double once; `e^j` uses the
 * engine's 50-digit decimals. `j = 0` gives 0 for every accrual. Explanation
 * `rate.effective` with `j` and `c` ("12", "continuous"), or `j`, `m` and `k` in
 * day-count mode.
 *
 * @param contract The loan's contract rate.
 * @returns The metric (percent, 2 decimals), or a failure if the value exceeds the range
 *   of doubles.
 */
export function effectiveMetric(contract: ContractRate): RateMetric | RateFailure {
  const j = contract.rate;
  const jText = toExplainString(j);
  const precision = METHOD_PRECISION.effective;
  const { accrual } = contract;
  if (accrual.mode === 'daycount') {
    const m = periodsPerYear(contract.frequency);
    const k = accrual.method === 'act-360' ? ACT_360_YEAR : ONE;
    const value = toNumber(mul(compoundOverYear(mul(j, k), m), HUNDRED));
    return buildMetric(value, precision, {
      formulaId: 'rate.effective',
      values: { j: jText, m: String(m), k: toExplainString(k) },
    });
  }
  const c = compoundingPerYear(accrual.compounding);
  if (c === null) {
    const value = fromRational(j).exp().minus(1).times(100).toNumber();
    return buildMetric(value, precision, {
      formulaId: 'rate.effective',
      values: { j: jText, c: 'continuous' },
    });
  }
  const value = toNumber(mul(compoundOverYear(j, c), HUNDRED));
  return buildMetric(value, precision, {
    formulaId: 'rate.effective',
    values: { j: jText, c: String(c) },
  });
}
