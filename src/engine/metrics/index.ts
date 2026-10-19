// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Rate metrics (SPEC §9.2–§9.4, §9.6): computes the requested methods from borrower-view
 * cash flows and, for `nominal` and `effective`, the contract rate. Methods that share an
 * equation share one solve: the periodic IRR (`irrNominal`, `irrEffective`,
 * `cnAnnualized`, `usRegZApr` with more than two flows), the XIRR (`xirr`,
 * `uaRealAnnual`, `international`) and the APRC (`ukAprc`, `euAprc`).
 */

import { periodsPerYear } from '../frequency';
import type { SolveResult } from '../solvers';
import type {
  EngineWarning,
  FrequencyId,
  RateFailure,
  RateMethodId,
  RateMetric,
  Rates,
} from '../types';
import { solveAprc } from './aprc';
import { METHOD_PRECISION } from './display';
import { effectiveMetric } from './effective';
import { nominalMetric } from './nominal';
import { periodicIrrMetric, solvePeriodicIrr } from './periodic-irr';
import { annualRateMetric } from './solve';
import type { ContractRate, RateOutcome, RateRequest } from './types';
import { regZSinglePayment } from './us-regz';
import { solveXirr } from './xirr';

export { type ContractRate, type RateOutcome, type RateRequest } from './types';

/** The solves of one request, each computed at most once. */
interface Solves {
  periodic(): SolveResult;
  xirr(): SolveResult;
  aprc(frequency: FrequencyId): SolveResult;
}

function createSolves(request: RateRequest): Solves {
  let periodic: SolveResult | undefined;
  let xirr: SolveResult | undefined;
  let aprc: SolveResult | undefined;
  return {
    periodic: () => (periodic ??= solvePeriodicIrr(request.flows)),
    xirr: () => (xirr ??= solveXirr(request.flows)),
    aprc: (frequency) => (aprc ??= solveAprc(request.flows, frequency, request.hasPeriods)),
  };
}

function requireContract(request: RateRequest, method: RateMethodId): ContractRate {
  if (request.contract === null) {
    throw new RangeError(`${method} needs a contract rate`);
  }
  return request.contract;
}

function requireFrequency(request: RateRequest, method: RateMethodId): FrequencyId {
  if (request.frequency === null) {
    throw new RangeError(`${method} needs a payment frequency`);
  }
  return request.frequency;
}

/** Frequency and periods: the periodic metrics are defined on whole periods only. */
function requirePeriods(request: RateRequest, method: RateMethodId): number {
  const frequency = requireFrequency(request, method);
  if (!request.hasPeriods) {
    throw new RangeError(`${method} needs a period on every flow`);
  }
  return periodsPerYear(frequency);
}

function computeMethod(
  method: RateMethodId,
  request: RateRequest,
  solves: Solves,
): RateMetric | RateFailure {
  switch (method) {
    case 'nominal':
      return nominalMetric(requireContract(request, method));
    case 'effective':
      return effectiveMetric(requireContract(request, method));
    case 'irrNominal':
    case 'irrEffective':
    case 'cnAnnualized': {
      const m = requirePeriods(request, method);
      return periodicIrrMetric(method, solves.periodic(), m);
    }
    case 'usRegZApr': {
      const m = requirePeriods(request, method);
      // A single advance and a single payment: the term is the unit-period (§9.3 a).
      return request.flows.length === 2
        ? regZSinglePayment(request.flows)
        : periodicIrrMetric(method, solves.periodic(), m);
    }
    case 'ukAprc':
    case 'euAprc':
      return annualRateMetric(
        solves.aprc(requireFrequency(request, method)),
        METHOD_PRECISION[method],
        request.hasPeriods ? 'periods' : 'counted-back',
      );
    case 'xirr':
    case 'uaRealAnnual':
    case 'international':
      return annualRateMetric(solves.xirr(), METHOD_PRECISION[method], 'days-365');
  }
}

/**
 * Computes the requested rate metrics (SPEC §9.2–§9.3) with display (§9.4) and
 * explanation (§9.6). A metric whose equation has no root or does not converge is
 * `{ ok: false, reason: 'IRR_NO_CONVERGENCE' }` on its own; the other metrics are
 * unaffected. A metric whose root was chosen among several carries
 * `warnings: ['IRR_MULTIPLE']`, and the outcome then has one `IRR_MULTIPLE` warning
 * listing those methods (`params.methods`, comma-separated in request order).
 *
 * @param request Flows, frequency, the methods in output order and the contract rate.
 * @returns One entry per requested method (duplicates computed once), in request order.
 * @throws RangeError when a method's preconditions are not met (programming errors
 *   that validation prevents): `nominal`/`effective` without a contract rate;
 *   `irrNominal`, `irrEffective`, `cnAnnualized` or `usRegZApr` without a frequency or
 *   with a flow that has no period; `ukAprc`/`euAprc` without a frequency.
 */
export function computeRates(request: RateRequest): RateOutcome {
  const solves = createSolves(request);
  const rates: Rates = {};
  const withMultiple: RateMethodId[] = [];
  for (const method of request.methods) {
    if (Object.hasOwn(rates, method)) {
      continue;
    }
    const metric = computeMethod(method, request, solves);
    rates[method] = metric;
    if (!('ok' in metric) && (metric.warnings ?? []).includes('IRR_MULTIPLE')) {
      withMultiple.push(method);
    }
  }
  const warnings: EngineWarning[] =
    withMultiple.length > 0
      ? [{ code: 'IRR_MULTIPLE', params: { methods: withMultiple.join(',') } }]
      : [];
  return { rates, warnings };
}
