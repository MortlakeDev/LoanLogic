// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Request and outcome shapes of the rate metrics (SPEC §9), shared by the metric modules
 * and re-exported from `metrics/index.ts`.
 */

import type { Rational } from '../rational';
import type { Accrual, CashFlow, EngineWarning, FrequencyId, RateMethodId, Rates } from '../types';

/** The loan's contract rate, which `nominal` and `effective` describe (SPEC §9.2). */
export interface ContractRate {
  /** The nominal annual rate in percent as entered ("6.5", "6.50", "-0.5"). */
  readonly annualRatePct: string;
  /** `j` as an exact decimal fraction per annum (6.5 % → 13/200). */
  readonly rate: Rational;
  /** Payment frequency; `m` = its periods per year. */
  readonly frequency: FrequencyId;
  /** Accrual with defaults applied (compounding, or the day-count method). */
  readonly accrual: Accrual;
}

/** What `computeRates` computes, and from which flows. */
export interface RateRequest {
  /**
   * Borrower-view flows (SPEC §9.1, §9.7) in major units, in non-decreasing date order;
   * the first flow's date is `D0`, time 0.
   */
  readonly flows: readonly CashFlow[];
  /** Payment frequency, or `null` for explicit flows without one. */
  readonly frequency: FrequencyId | null;
  /** Whether every flow has a `period` (always for a loan). */
  readonly hasPeriods: boolean;
  /** The metrics to compute, exactly these and in this order. */
  readonly methods: readonly RateMethodId[];
  /** The contract rate; `null` for explicit cash flows. */
  readonly contract: ContractRate | null;
}

/** Computed metrics with the result-level warnings. */
export interface RateOutcome {
  /** One entry per requested method, in request order. */
  readonly rates: Rates;
  /**
   * `[{ code: 'IRR_MULTIPLE', params: { methods: 'xirr,ukAprc' } }]` once when any
   * metric chose its root among several, else `[]`.
   */
  readonly warnings: readonly EngineWarning[];
}
