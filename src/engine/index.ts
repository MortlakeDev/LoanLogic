// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * LoanLogic financial engine — public API.
 *
 * Implements docs/SPEC-finance.md v0.2.2 §0–§6, §8–§10, §13 and the input contract of
 * §15. Pure and deterministic: no DOM, no UI imports, no global state, no I/O, no JS
 * `Date`, no `Intl`; its only dependency is decimal.js. Ledger money is exact (BigInt
 * rationals, posted at the currency's minor units); rate metrics are solved in double
 * precision (SPEC §0.2).
 */

import { computeCashFlowRates } from './cashflows';
import type { EngineWarning, CashFlowResult, LoanResult } from './types';
import { ledgerRows, loanCashFlows, loanSummary } from './ledger';
import { computeRates } from './metrics/index';
import { buildSchedule } from './schedule/build';
import { validateCashFlowInput, validateLoanInput } from './validate';

export type {
  Accrual,
  CashFlowInput,
  CashFlowResult,
  CompoundingId,
  DayCountId,
  DecimalString,
  EngineError,
  EngineWarning,
  ErrorCode,
  Explain,
  FeeInput,
  FrequencyId,
  LedgerRow,
  LoanInput,
  LoanResult,
  LoanSummary,
  PaymentBasis,
  PaymentRounding,
  PrincipalRemainder,
  RateFailure,
  RateMethodId,
  RateMetric,
  Rates,
  RepaymentType,
  RoundingMode,
  WarningCode,
} from './types';
export { RATE_METHOD_IDS } from './types';
export { CURRENCY_CODES, minorUnits } from './currency';
export { FREQUENCY_IDS } from './frequency';
export { DAY_COUNT_IDS } from './daycount';
export { type InvariantViolation, checkInvariants } from './ledger';

/**
 * Calculates a loan: validates the input as untrusted data (SPEC §13), builds the exact
 * schedule (§5–§8) and computes the requested rate metrics (§9–§10).
 *
 * @param input A `LoanInput` (SPEC §15), checked at run time; any value is accepted.
 * @returns On success the warnings, the summary and rows (money as decimal strings at the
 *   currency's minor units), the rates by method id (`value` in percent) and the
 *   instalment's explanation; otherwise every error of the first failing validation phase,
 *   each with its field path. `NEG_AMORTIZATION` (phase 3) is reported alone.
 */
export function calculateLoan(input: unknown): LoanResult {
  const validation = validateLoanInput(input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const { terms } = validation;
  const built = buildSchedule(terms);
  if (!built.ok) {
    return { ok: false, errors: [built.error] };
  }
  const { schedule } = built;
  const rows = ledgerRows(terms, schedule);
  const outcome = computeRates({
    flows: loanCashFlows(terms, schedule),
    frequency: terms.frequency,
    hasPeriods: true,
    methods: terms.rateMethods,
    contract: {
      annualRatePct: terms.annualRatePct,
      rate: terms.rate,
      frequency: terms.frequency,
      accrual: terms.accrual,
    },
  });
  const earlyClose: EngineWarning[] = schedule.earlyClose
    ? [
        {
          code: 'EARLY_CLOSE',
          params: { paymentsCount: String(rows.length), scheduled: String(terms.payments) },
        },
      ]
    : [];
  return {
    ok: true,
    warnings: [...validation.warnings, ...earlyClose, ...outcome.warnings],
    summary: loanSummary(terms, schedule),
    rows,
    rates: outcome.rates,
    explain: schedule.explain,
  };
}

/**
 * Computes the rate metrics of explicit cash flows (SPEC §9.7): always `xirr`,
 * `uaRealAnnual` and `international`; with a frequency and periods also the periodic
 * metrics, the US APR and the APRCs; with a frequency and no periods the APRCs by
 * backward counting.
 *
 * @param input A `CashFlowInput` (SPEC §15), checked at run time; borrower view
 *   (+ received, − paid), amounts in major units.
 * @returns The rates by method id, or every error of the first failing validation phase.
 */
export function computeRateMetrics(input: unknown): CashFlowResult {
  const validation = validateCashFlowInput(input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, rates: computeCashFlowRates(validation.terms) };
}
