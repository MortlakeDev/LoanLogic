// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Rate metrics of explicit cash flows (SPEC §9.7): which metrics a validated cash-flow
 * list supports, and their computation without a schedule or contract rate.
 */

import { computeRates } from './metrics';
import { type CashFlowTerms, type RateMethodId, type Rates, RATE_METHOD_IDS } from './types';

/** Computed for every cash-flow list (days / 365 from the first flow). */
const ALWAYS: readonly RateMethodId[] = ['xirr', 'uaRealAnnual', 'international'];

/** Added with a frequency and a period on every flow. */
const WITH_PERIODS: readonly RateMethodId[] = [
  'irrNominal',
  'irrEffective',
  'usRegZApr',
  'ukAprc',
  'euAprc',
  'cnAnnualized',
];

/** Added with a frequency and no periods (backward counting, SPEC §9.3 b). */
const WITH_FREQUENCY_ONLY: readonly RateMethodId[] = ['ukAprc', 'euAprc'];

/**
 * The metrics SPEC §9.7 computes for these flows, in `RATE_METHOD_IDS` order: always
 * `xirr`, `uaRealAnnual` and `international`; with a frequency and periods also
 * `irrNominal`, `irrEffective`, `usRegZApr`, `ukAprc`, `euAprc` and `cnAnnualized`; with
 * a frequency and no periods also `ukAprc` and `euAprc`. Never `nominal` or `effective`,
 * which need a contract rate.
 *
 * @param terms Validated explicit cash flows.
 */
export function cashFlowMethods(terms: CashFlowTerms): RateMethodId[] {
  const chosen = new Set<RateMethodId>(ALWAYS);
  if (terms.frequency !== null) {
    for (const method of terms.hasPeriods ? WITH_PERIODS : WITH_FREQUENCY_ONLY) {
      chosen.add(method);
    }
  }
  return RATE_METHOD_IDS.filter((method) => chosen.has(method));
}

/**
 * The rate metrics of validated explicit cash flows (SPEC §9.7): `cashFlowMethods(terms)`
 * computed by `computeRates` without a contract rate. A metric without a root is
 * `{ ok: false, reason: 'IRR_NO_CONVERGENCE' }`; a metric whose root was chosen among
 * several carries `warnings: ['IRR_MULTIPLE']`.
 *
 * @param terms Validated explicit cash flows (borrower view, major units).
 * @returns One entry per supported method, in `RATE_METHOD_IDS` order.
 */
export function computeCashFlowRates(terms: CashFlowTerms): Rates {
  return computeRates({
    flows: terms.flows,
    frequency: terms.frequency,
    hasPeriods: terms.hasPeriods,
    methods: cashFlowMethods(terms),
    contract: null,
  }).rates;
}
