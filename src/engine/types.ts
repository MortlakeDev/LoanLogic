// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Shared types of the engine: the input contract (SPEC §15), the result shapes (§8, §9.6,
 * §13) and the validated form of an input that the calculation modules work on.
 *
 * Units, unless a field says otherwise: money in the public shapes is a decimal string in
 * major units at the currency's minor units ("1234.50", never "-0.00"); money inside the
 * engine is a `bigint` count of minor units; rates in inputs are percent strings
 * ("6.5" = 6.5 %) and inside the engine exact decimal fractions per annum (0.065).
 */

import type { LocalDate } from './date';
import type { Rational } from './rational';

// ---------------------------------------------------------------------------------------
// Identifiers (SPEC §15)
// ---------------------------------------------------------------------------------------

/** Payment frequency id (SPEC §2.2, M1 set). */
export type FrequencyId = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

/** Compounding frequency of periodic accrual: a frequency id or continuous (SPEC §3.1). */
export type CompoundingId = FrequencyId | 'continuous';

/** Day-count convention id (SPEC §4). */
export type DayCountId =
  '30u-360' | '30-360-isda' | '30e-360' | 'act-360' | 'act-365f' | 'act-act-isda';

/** Rounding mode (SPEC §1.3). */
export type RoundingMode = 'half-up' | 'half-even' | 'ceil' | 'floor';

/** Payment rounding policy for the instalment `A` (SPEC §1.5). */
export type PaymentRounding = 'minor-half-up' | 'minor-ceil' | 'unit-half-up' | 'unit-ceil';

/** Repayment type (SPEC §5). */
export type RepaymentType = 'annuity' | 'equal-principal' | 'bullet' | 'balloon';

/** Day-count payment basis of an annuity (SPEC §5.2). */
export type PaymentBasis = 'nominal' | 'exact';

/** Where the equal-principal rounding remainder goes (SPEC §5.3). */
export type PrincipalRemainder = 'last' | 'first';

/** Rate metric id (SPEC §9.2–§9.3). */
export type RateMethodId =
  | 'nominal'
  | 'effective'
  | 'irrNominal'
  | 'irrEffective'
  | 'xirr'
  | 'usRegZApr'
  | 'ukAprc'
  | 'euAprc'
  | 'cnAnnualized'
  | 'uaRealAnnual'
  | 'international';

/** Every rate metric id, in the order of SPEC §15 (the default `rateMethods`). */
export const RATE_METHOD_IDS: readonly RateMethodId[] = Object.freeze([
  'nominal',
  'effective',
  'irrNominal',
  'irrEffective',
  'xirr',
  'usRegZApr',
  'ukAprc',
  'euAprc',
  'cnAnnualized',
  'uaRealAnnual',
  'international',
]);

// ---------------------------------------------------------------------------------------
// Errors and warnings (SPEC §13)
// ---------------------------------------------------------------------------------------

/** Error code of a rejected input (SPEC §13). */
export type ErrorCode =
  | 'INPUT_INVALID'
  | 'CURRENCY_INVALID'
  | 'AMOUNT_RANGE'
  | 'TOO_MANY_DECIMALS'
  | 'RATE_RANGE'
  | 'TERM_RANGE'
  | 'TERM_TOO_SHORT'
  | 'DATE_INVALID'
  | 'BALLOON_RANGE'
  | 'FEE_RANGE'
  | 'UNSUPPORTED'
  | 'AMOUNT_TOO_SMALL_FOR_TERM'
  | 'NEG_AMORTIZATION';

/** Warning code: never blocks a result (SPEC §13). */
export type WarningCode = 'RATE_NEGATIVE' | 'RATE_HIGH' | 'EARLY_CLOSE' | 'IRR_MULTIPLE';

/**
 * A structured, unlocalized error. `field` is the path of the offending input
 * (`amount`, `term.payments`, `fees[2].value`, `rateMethods[1]`, `flows[3].date`) or
 * `null` when no single input is at fault. `params` carries values the UI may show.
 */
export interface EngineError {
  readonly code: ErrorCode;
  readonly field: string | null;
  readonly params?: Readonly<Record<string, string>>;
}

/** A structured warning; `params` carries values the UI may show. */
export interface EngineWarning {
  readonly code: WarningCode;
  readonly params?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------------------
// Input contract (SPEC §15): what callers pass in. The engine still validates it at run
// time as untrusted data.
// ---------------------------------------------------------------------------------------

/**
 * Plain decimal string: optional "-", digits without leading zeros, optional ".digits".
 * No "+", no exponent, no grouping: "6.5", "-0.5", "100000.00".
 */
export type DecimalString = string;

/** A fee or insurance item (SPEC §6, §15). */
export type FeeInput =
  | {
      readonly id: string;
      readonly kind: 'upfront';
      readonly calc: 'fixed' | 'percent';
      /**
       * `fixed`: the fee in major units, a whole number of minor units, used as entered.
       * `percent`: a percentage of the requested amount (1.5 = 1.5 %). Never negative.
       */
      readonly value: DecimalString;
      readonly financing?: 'paid' | 'financed';
      readonly inApr?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'periodic' | 'insurance';
      readonly calc: 'fixed' | 'pct-original' | 'pct-balance';
      /**
       * Charged every period. `fixed`: the amount per period in major units, a whole number
       * of minor units. `pct-original` / `pct-balance`: a percentage **per payment period**
       * (a 1.5 % monthly commission is 1.5 with monthly payments) of the requested amount
       * or of the period's opening balance (SPEC §6.2). Never negative.
       */
      readonly value: DecimalString;
      readonly inApr?: boolean;
    };

/** Loan scenario accepted by `calculateLoan` (SPEC §15). */
export interface LoanInput {
  /** ISO 4217 code (SPEC §1.2). */
  readonly currency: string;
  /** Requested amount in major units, whole minor units. */
  readonly amount: DecimalString;
  /** Nominal annual rate in percent: "6.5" = 6.5 %. */
  readonly annualRatePct: DecimalString;
  readonly repayment: RepaymentType;
  /**
   * The residual (SPEC §5.5); required for `balloon`, ignored otherwise. `amount`: in major
   * units, a whole number of minor units; `percent`: a percentage of the principal
   * financed (amount + financed upfront fees). `0 < Bal < P` after rounding.
   */
  readonly balloon?: { readonly kind: 'amount' | 'percent'; readonly value: DecimalString };
  readonly frequency: FrequencyId;
  readonly term:
    | { readonly payments: number }
    | { readonly years: number; readonly months?: number }
    | { readonly endDate: string };
  /** YYYY-MM-DD. */
  readonly disbursementDate: string;
  /** Default `true` (SPEC §2.1). */
  readonly endOfMonth?: boolean;
  /** Default `{ mode: 'periodic' }`. */
  readonly accrual?:
    | { readonly mode: 'periodic'; readonly compounding?: CompoundingId }
    | {
        readonly mode: 'daycount';
        readonly method: DayCountId;
        readonly paymentBasis?: PaymentBasis;
      };
  readonly rounding?: {
    readonly interest?: RoundingMode;
    readonly fees?: RoundingMode;
    readonly payment?: PaymentRounding;
    readonly principalRemainder?: PrincipalRemainder;
  };
  readonly fees?: readonly FeeInput[];
  /** Default: all. */
  readonly rateMethods?: readonly RateMethodId[];
}

/**
 * Explicit cash flows for `computeRateMetrics` (SPEC §9.7). Borrower view: + received,
 * − paid. At least two flows in non-decreasing date order; `period` on every flow or on
 * none.
 */
export interface CashFlowInput {
  /** Required when periods are given. */
  readonly frequency?: FrequencyId;
  readonly flows: readonly {
    /** YYYY-MM-DD. */
    readonly date: string;
    /** In major units (no currency, so any number of decimals); |amount| ≤ 1e15. */
    readonly amount: DecimalString;
    /** Whole payment periods from the first flow (0 for it); the date must be its schedule date. */
    readonly period?: number;
  }[];
}

// ---------------------------------------------------------------------------------------
// Validated inputs (internal): produced by validate.ts, consumed by the calculation.
// ---------------------------------------------------------------------------------------

/** How a fee amount is computed, with its value already parsed. */
export type FeeValue =
  /** A fixed amount in minor units, used as entered. */
  | { readonly calc: 'fixed'; readonly amount: bigint }
  /**
   * A percentage (`pct` is the number entered: 1.5 means 1.5 %). Upfront `percent` and
   * periodic `pct-original` apply to the requested amount; `pct-balance` to the opening
   * balance of the period.
   */
  | { readonly calc: 'percent' | 'pct-original' | 'pct-balance'; readonly pct: Rational };

/** A validated fee or insurance item. */
export interface Fee {
  readonly id: string;
  readonly kind: 'upfront' | 'periodic' | 'insurance';
  readonly value: FeeValue;
  /** Upfront items only; periodic and insurance items are always `paid`. */
  readonly financing: 'paid' | 'financed';
  readonly inApr: boolean;
}

/** Accrual settings with defaults applied. */
export type Accrual =
  | { readonly mode: 'periodic'; readonly compounding: CompoundingId }
  | { readonly mode: 'daycount'; readonly method: DayCountId; readonly paymentBasis: PaymentBasis };

/** Rounding settings with defaults applied. */
export interface RoundingOptions {
  readonly interest: RoundingMode;
  readonly fees: RoundingMode;
  readonly payment: PaymentRounding;
  readonly principalRemainder: PrincipalRemainder;
}

/** Balloon residual as entered (validated). */
export type BalloonSpec =
  | { readonly kind: 'amount'; readonly amount: bigint }
  | { readonly kind: 'percent'; readonly pct: Rational };

/** A loan input that passed validation phases 1 and 2 (SPEC §13), with defaults applied. */
export interface LoanTerms {
  readonly currency: string;
  /** Digits of the minor unit (USD 2, JPY 0, KWD 3, CLF 4). */
  readonly minorUnits: number;
  /** Requested amount in minor units. */
  readonly amount: bigint;
  /** The rate exactly as entered ("6.5", "3.10"); shown as `annualRate` on ledger rows. */
  readonly annualRatePct: string;
  /** Nominal annual rate `j` as an exact decimal fraction per annum (6.5 % → 0.065). */
  readonly rate: Rational;
  readonly repayment: RepaymentType;
  /** Present only for `balloon`. */
  readonly balloon: BalloonSpec | null;
  readonly frequency: FrequencyId;
  /** Number of scheduled payments `N` (SPEC §2.4), 1 … 1200. */
  readonly payments: number;
  readonly disbursementDate: LocalDate;
  readonly endOfMonth: boolean;
  readonly accrual: Accrual;
  readonly rounding: RoundingOptions;
  readonly fees: readonly Fee[];
  /** Requested metrics, duplicates removed, in input order. */
  readonly rateMethods: readonly RateMethodId[];
}

/** One validated explicit cash flow (SPEC §9.7). */
export interface CashFlow {
  readonly date: LocalDate;
  /** Borrower view in major units: + received, − paid (exact). */
  readonly amount: Rational;
  /** Period index from the first flow, when periods are given. */
  readonly period?: number;
}

/** A validated `CashFlowInput`. */
export interface CashFlowTerms {
  readonly frequency: FrequencyId | null;
  /** Whether every flow carries a period (then each date is a schedule date). */
  readonly hasPeriods: boolean;
  readonly flows: readonly CashFlow[];
}

// ---------------------------------------------------------------------------------------
// Results (SPEC §8, §9.6)
// ---------------------------------------------------------------------------------------

/** An explanation payload: formula id and decimal-string values (SPEC §0.4, §9.6). */
export interface Explain {
  readonly formulaId: string;
  readonly values: Readonly<Record<string, string>>;
}

/** One schedule row (SPEC §8.1); money as decimal strings at minor units. */
export interface LedgerRow {
  /** 1-based payment number. */
  readonly index: number;
  /** Payment date, YYYY-MM-DD. */
  readonly date: string;
  /** Actual days since the previous schedule date (the disbursement date for row 1). */
  readonly days: number;
  /** Nominal annual rate in effect, in percent as entered ("6.5"). */
  readonly annualRate: string;
  readonly opening: string;
  readonly interestAccrued: string;
  readonly interestPaid: string;
  /** Zero in M1. */
  readonly interestCapitalized: string;
  readonly principal: string;
  /** Zero in M1. */
  readonly extraPrincipal: string;
  /** Sum of the periodic fee items of the period. */
  readonly fees: string;
  /** Sum of the insurance items of the period. */
  readonly insurance: string;
  /** Zero in M1. */
  readonly penalty: string;
  readonly payment: string;
  readonly closing: string;
  readonly cumulativeInterest: string;
  /** Includes extra principal. */
  readonly cumulativePrincipal: string;
  /** Event markers; empty in M1. */
  readonly events: readonly string[];
}

/** Loan summary (SPEC §8.2); money as decimal strings at minor units. */
export interface LoanSummary {
  readonly amount: string;
  readonly principalFinanced: string;
  readonly netProceeds: string;
  readonly upfrontFeesPaid: string;
  readonly upfrontFeesFinanced: string;
  readonly amountFinancedForRates: string;
  /** `A` for annuity and balloon; `null` otherwise. */
  readonly regularInstalment: string | null;
  /** `q` for equal principal; `null` otherwise. */
  readonly principalPerPeriod: string | null;
  readonly firstPayment: string;
  readonly lastPayment: string;
  readonly maxPayment: string;
  /** Actual number of payments (after an early close). */
  readonly paymentsCount: number;
  readonly firstPaymentDate: string;
  readonly payoffDate: string;
  readonly totalPayments: string;
  readonly totalPaid: string;
  readonly totalInterest: string;
  readonly totalPrincipal: string;
  readonly totalFees: string;
  readonly totalInsurance: string;
  readonly totalPenalties: string;
  readonly costOfCredit: string;
  /** Balloon part of the last payment; `0` after an early close; `null` if not a balloon. */
  readonly balloon: string | null;
}

/** A computed rate (SPEC §9.6). */
export interface RateMetric {
  /** Percent, unrounded: 6.97421… for 6.974 %. */
  readonly value: number;
  /** Rounded half-up to `precision` decimals: "6.974"; zero is "0.000", never "-0.000". */
  readonly display: string;
  /** Decimals of `display`. */
  readonly precision: number;
  /** Metric-level warning codes, e.g. `['IRR_MULTIPLE']`; absent when there are none. */
  readonly warnings?: readonly WarningCode[];
  readonly explain: Explain;
}

/** A rate that could not be computed; the UI shows "n/a" with the reason (SPEC §10). */
export interface RateFailure {
  readonly ok: false;
  readonly reason: 'IRR_NO_CONVERGENCE';
}

/** Requested rate metrics by id. */
export type Rates = Partial<Record<RateMethodId, RateMetric | RateFailure>>;

/** Result of `calculateLoan`. */
export type LoanResult =
  | {
      readonly ok: true;
      readonly warnings: readonly EngineWarning[];
      readonly summary: LoanSummary;
      readonly rows: readonly LedgerRow[];
      readonly rates: Rates;
      /** The instalment's explanation (formula ids `instalment.*`). */
      readonly explain: Explain;
    }
  | { readonly ok: false; readonly errors: readonly EngineError[] };

/** Result of `computeRateMetrics`. */
export type CashFlowResult =
  | { readonly ok: true; readonly rates: Rates }
  | { readonly ok: false; readonly errors: readonly EngineError[] };
