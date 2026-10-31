// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Schedule construction (SPEC §5): payment dates (§2.3), interest (§3), principal by
 * repayment type (§5.2–§5.5), periodic fees and insurance (§6.2–§6.3), early close and
 * negative amortization (§5.1). Works on validated terms; every amount is a posted value
 * in minor units, obtained by one rounding at a posting point (§1.4) or by exact addition
 * and subtraction of posted values.
 */

import { type LocalDate, daysBetween } from '../date';
import { yearFraction } from '../daycount';
import { digitCount } from '../decimal';
import { type UpfrontTotals, periodicFeeAmount, principalFinanced, upfrontTotals } from '../fees';
import { isEndOfMonthSchedule, periodsPerYear, scheduleDates } from '../frequency';
import { formatMinor } from '../money';
import { type Rational, div, fromInteger, mul, toExplainString } from '../rational';
import { dayCountInterest, periodicInterest, periodicRate } from '../rates';
import { type Real, exact, realToExplainString } from '../rounding';
import type { EngineError, Explain, LoanTerms } from '../types';
import { type Instalment, exactBasisInstalment, levelInstalment } from './annuity';
import { balloonInstalment, balloonPart, balloonResidual } from './balloon';
import { bulletPrincipal } from './bullet';
import { equalPrincipalAmount, remainderFirstPrincipal } from './equal-principal';

/** One period of a schedule; money in minor units. */
export interface ScheduleRow {
  /** Payment number `k`, 1-based. */
  readonly index: number;
  /** Payment date `date_k`. */
  readonly date: LocalDate;
  /** Days since the previous schedule date (`D0` for the first row). */
  readonly days: number;
  /** Opening balance `B_{k−1}`. */
  readonly opening: bigint;
  /** Interest of the period, posted; accrued and paid alike in M1. */
  readonly interest: bigint;
  /** Principal `p_k`. */
  readonly principal: bigint;
  /** Amount of every item of `terms.fees` in this period, in the same order; 0 for upfront items. */
  readonly itemAmounts: readonly bigint[];
  /** Sum of the periodic fee items. */
  readonly fees: bigint;
  /** Sum of the insurance items. */
  readonly insurance: bigint;
  /** `interest + principal + fees + insurance`. */
  readonly payment: bigint;
  /** Closing balance `B_k = B_{k−1} − p_k`. */
  readonly closing: bigint;
}

/** A computed schedule; money in minor units. */
export interface Schedule {
  /** The periods actually produced (fewer than `N` after an early close). */
  readonly rows: readonly ScheduleRow[];
  /** Upfront items and their totals (SPEC §6.1). */
  readonly upfront: UpfrontTotals;
  /** `P` = amount + financed upfront items. */
  readonly principalFinanced: bigint;
  /** The regular instalment `A` for annuity and balloon loans, else `null`. */
  readonly regularInstalment: bigint | null;
  /** The equal-principal amount `q`, else `null`. */
  readonly principalPerPeriod: bigint | null;
  /**
   * Balloon loans: the balloon part of the last payment, `p_N − (A − I_N)`, or 0 after an
   * early close; `null` for the other repayment types.
   */
  readonly balloon: bigint | null;
  /** Whether the balance reached zero before the scheduled `N` (SPEC §5.1). */
  readonly earlyClose: boolean;
  /**
   * The instalment's explanation, formula ids `instalment.*` (SPEC §9.6); money at the
   * currency's minor units, rates and year fractions exact when terminating, else with 20
   * significant digits. Annuity and balloon: `P`, `N`, the rate, `Astar`, `A` (and `Bal`).
   * Equal principal: `P`, `N`, the rate behind `I1`, `q`, and the first row's `p1`, `I1`
   * and `first` = `p1 + I1`. Bullet: `P`, `N`, the rate behind `I1`, `I1` and `first`, the
   * first row's principal + interest (`I1`, or `P + I1` when `N = 1`). The rate behind
   * `I1` is `j`, `m` (and `i` when `c ≠ m`) in periodic mode, or `j`, `dayCount` and `yf1`
   * (the first period's year fraction) in day-count mode, never both.
   */
  readonly explain: Explain;
}

/** A schedule, or the error that prevents one. */
export type ScheduleResult =
  | { readonly ok: true; readonly schedule: Schedule }
  | { readonly ok: false; readonly error: EngineError };

/** A planned period's dates: `date_{k−1}` (D0 for the first) to `date_k`. */
interface Span {
  readonly index: number;
  readonly start: LocalDate;
  readonly date: LocalDate;
}

/** A planned period: its date, its length and how its interest is posted. */
interface Period {
  readonly index: number;
  readonly date: LocalDate;
  readonly days: number;
  /** Posted interest of the period on the opening balance (minor units in and out). */
  readonly interest: (balance: bigint) => bigint;
}

/** How the loan's interest accrues, prepared once per schedule. */
interface RateModel {
  /** The `N` planned periods. */
  readonly periods: readonly Period[];
  /** Periodic rate of the level instalment: `i` (periodic) or `j / m` (day-count). */
  readonly instalmentRate: Real;
  /** Day-count with the exact payment basis only: `r_k = j × YF_k` for k = 1..N. */
  readonly exactBasisRates: readonly Rational[] | null;
  /** `i` for the explanation when it differs from `j / m` (`c ≠ m`), else `null`. */
  readonly explainedRate: string | null;
  /**
   * The rate behind the first period's interest `I_1` for the equal-principal and bullet
   * explanations (SPEC §9.6): `j`, `m` and, when `c ≠ m`, `i` in periodic mode; `j`,
   * `dayCount` (the method id) and `yf1` (`YF_1`) in day-count mode.
   */
  readonly firstInterestRate: Readonly<Record<string, string>>;
}

/** The first row as posted: what the equal-principal and bullet explanations show. */
interface FirstPayment {
  /** `p_1`, minor units. */
  readonly principal: bigint;
  /** `I_1`, minor units. */
  readonly interest: bigint;
}

/** How principal is scheduled for one repayment type. */
interface RepaymentPlan {
  /** Scheduled principal `p_k` of a period `k < N`, before the early-close cap. */
  readonly scheduledPrincipal: (period: number, interest: bigint) => bigint;
  /** Annuity and balloon: a negative scheduled principal is negative amortization. */
  readonly forbidsNegativePrincipal: boolean;
  readonly regularInstalment: bigint | null;
  readonly principalPerPeriod: bigint | null;
  /** The summary's balloon from the last row (SPEC §8.2). */
  readonly balloon: (
    lastPrincipal: bigint,
    lastInterest: bigint,
    earlyClose: boolean,
  ) => bigint | null;
  /** The instalment explanation (SPEC §9.6) from the first row as posted. */
  readonly explain: (first: FirstPayment) => Explain;
}

/** The planned periods (SPEC §2.3) with the interest rule of the accrual mode (§3). */
function rateModel(terms: LoanTerms, principal: bigint): RateModel {
  const { accrual, rate, frequency, disbursementDate } = terms;
  const mode = terms.rounding.interest;
  const dates = scheduleDates(disbursementDate, terms.payments, frequency, terms.endOfMonth);
  const spans = dates.map((date, index) => ({
    index: index + 1,
    start: dates[index - 1] ?? disbursementDate,
    date,
  }));
  const period = (span: Span, interest: (balance: bigint) => bigint): Period => ({
    index: span.index,
    date: span.date,
    days: daysBetween(span.start, span.date),
    interest,
  });
  const j = toExplainString(rate);
  if (accrual.mode === 'periodic') {
    // Balances never exceed P, so its digits size the precision of an irrational i.
    const i = periodicRate(rate, frequency, accrual.compounding, digitCount(principal));
    const explainedRate = accrual.compounding === frequency ? null : realToExplainString(i);
    return {
      periods: spans.map((span) => period(span, (balance) => periodicInterest(balance, i, mode))),
      instalmentRate: i,
      exactBasisRates: null,
      explainedRate,
      firstInterestRate: {
        j,
        m: String(periodsPerYear(frequency)),
        ...(explainedRate === null ? {} : { i: explainedRate }),
      },
    };
  }
  // The 30/360 US February rules depend on the planned dates (SPEC §2.1), whether or not
  // every payment is made.
  const endOfMonth = isEndOfMonthSchedule(disbursementDate, dates, frequency);
  const accruing = spans.map((span) => ({
    span,
    fraction: yearFraction(accrual.method, span.start, span.date, endOfMonth),
  }));
  const firstFraction = accruing[0]?.fraction;
  if (firstFraction === undefined) {
    throw new RangeError('A schedule needs at least one payment');
  }
  return {
    periods: accruing.map(({ span, fraction }) =>
      period(span, (balance) => dayCountInterest(balance, rate, fraction, mode)),
    ),
    // The nominal basis: A from i = j / m; compounding is not used in day-count mode.
    instalmentRate: exact(div(rate, fromInteger(periodsPerYear(frequency)))),
    exactBasisRates:
      accrual.paymentBasis === 'exact' ? accruing.map(({ fraction }) => mul(rate, fraction)) : null,
    // Day-count mode never shows i: the nominal basis implies j / m, and the exact basis has
    // a rate per period, r_k = j × YF_k (its own formula id, SPEC §9.6).
    explainedRate: null,
    // I_1 accrues as j × YF_1 whatever the payment basis, so neither m nor i belongs here.
    firstInterestRate: { j, dayCount: accrual.method, yf1: toExplainString(firstFraction) },
  };
}

/**
 * The `instalment.annuity` / `instalment.balloon` explanation (SPEC §9.6), or
 * `instalment.annuity-exact-basis` for the day-count exact payment basis, which has no
 * single periodic rate: `P`, `N`, `j`, `dayCount` (the method id), `Astar`, `A`.
 */
function levelExplain(
  terms: LoanTerms,
  principal: bigint,
  rates: RateModel,
  instalment: Instalment,
  residual: bigint | null,
): Explain {
  const money = (value: bigint): string => formatMinor(value, terms.minorUnits);
  if (rates.exactBasisRates !== null && terms.accrual.mode === 'daycount') {
    return {
      formulaId: 'instalment.annuity-exact-basis',
      values: {
        P: money(principal),
        N: String(terms.payments),
        j: toExplainString(terms.rate),
        dayCount: terms.accrual.method,
        Astar: instalment.exact,
        A: money(instalment.amount),
      },
    };
  }
  return {
    formulaId: residual === null ? 'instalment.annuity' : 'instalment.balloon',
    values: {
      P: money(principal),
      N: String(terms.payments),
      j: toExplainString(terms.rate),
      m: String(periodsPerYear(terms.frequency)),
      ...(rates.explainedRate === null ? {} : { i: rates.explainedRate }),
      Astar: instalment.exact,
      A: money(instalment.amount),
      ...(residual === null ? {} : { Bal: money(residual) }),
    },
  };
}

/** The principal rule of the repayment type, or the phase-2 error that forbids it. */
function repaymentPlan(
  terms: LoanTerms,
  principal: bigint,
  rates: RateModel,
): RepaymentPlan | EngineError {
  const n = terms.payments;
  const mu = terms.minorUnits;
  const policy = terms.rounding.payment;
  const money = (value: bigint): string => formatMinor(value, mu);
  const noBalloon = (): null => null;
  switch (terms.repayment) {
    case 'annuity': {
      const instalment =
        rates.exactBasisRates === null
          ? levelInstalment(principal, rates.instalmentRate, n, mu, policy)
          : exactBasisInstalment(principal, rates.exactBasisRates, mu, policy);
      return {
        scheduledPrincipal: (_period, interest) => instalment.amount - interest,
        // The exact basis is exempt (SPEC §5.1): its A* amortizes the actual-day interest,
        // so a longer-than-average period may add its shortfall to the balance.
        forbidsNegativePrincipal: rates.exactBasisRates === null,
        regularInstalment: instalment.amount,
        principalPerPeriod: null,
        balloon: noBalloon,
        explain: () => levelExplain(terms, principal, rates, instalment, null),
      };
    }
    case 'balloon': {
      if (terms.balloon === null) {
        throw new RangeError('Balloon terms without a balloon specification');
      }
      // Validation (phase 2) rejects both; they are checked again so that no other
      // schedule is ever computed instead (SPEC §0.5).
      if (rates.exactBasisRates !== null) {
        return { code: 'UNSUPPORTED', field: 'accrual.paymentBasis' };
      }
      const residual = balloonResidual(terms.balloon, principal);
      if (residual <= 0n || residual >= principal) {
        return { code: 'BALLOON_RANGE', field: 'balloon.value' };
      }
      const instalment = balloonInstalment(
        principal,
        residual,
        rates.instalmentRate,
        n,
        mu,
        policy,
      );
      return {
        scheduledPrincipal: (_period, interest) => instalment.amount - interest,
        forbidsNegativePrincipal: true,
        regularInstalment: instalment.amount,
        principalPerPeriod: null,
        balloon: (lastPrincipal, lastInterest, earlyClose) =>
          earlyClose ? 0n : balloonPart(lastPrincipal, instalment.amount, lastInterest),
        explain: () => levelExplain(terms, principal, rates, instalment, residual),
      };
    }
    case 'equal-principal': {
      const q = equalPrincipalAmount(principal, n);
      const first =
        terms.rounding.principalRemainder === 'first' ? remainderFirstPrincipal(principal, n) : q;
      if (first < 0n) {
        return { code: 'AMOUNT_TOO_SMALL_FOR_TERM', field: 'amount' };
      }
      return {
        scheduledPrincipal: (period) => (period === 1 ? first : q),
        forbidsNegativePrincipal: false,
        regularInstalment: null,
        principalPerPeriod: q,
        balloon: noBalloon,
        explain: (paid) => ({
          formulaId: 'instalment.equal-principal',
          values: {
            P: money(principal),
            N: String(n),
            ...rates.firstInterestRate,
            q: money(q),
            p1: money(paid.principal),
            I1: money(paid.interest),
            first: money(paid.principal + paid.interest),
          },
        }),
      };
    }
    case 'bullet':
      return {
        scheduledPrincipal: (period) => bulletPrincipal(period, n, principal),
        forbidsNegativePrincipal: false,
        regularInstalment: null,
        principalPerPeriod: null,
        balloon: noBalloon,
        // With N = 1 the first row repays P as well, so `first` is P + I_1.
        explain: (paid) => ({
          formulaId: 'instalment.bullet',
          values: {
            P: money(principal),
            N: String(n),
            ...rates.firstInterestRate,
            I1: money(paid.interest),
            first: money(paid.principal + paid.interest),
          },
        }),
      };
  }
}

function isPlan(value: RepaymentPlan | EngineError): value is RepaymentPlan {
  return 'scheduledPrincipal' in value;
}

/**
 * Builds the schedule of validated loan terms (validation phases 1 and 2 passed).
 *
 * For each period `k = 1..N` (SPEC §5.1): interest on the opening balance (periodic
 * `R_int(B × i)` or day-count `R_int(B × j × YF_k)`), principal by repayment type
 * (annuity and balloon `A − I_k`, equal principal `q`, bullet 0; the last period repays
 * the remaining balance), periodic fees and insurance on the opening balance, and the
 * closing balance. A scheduled principal that reaches the balance before period `N`
 * repays it and ends the schedule (early close).
 *
 * @param terms Validated terms; money in minor units, rates as exact fractions.
 * @returns The schedule (amounts in minor units), or `NEG_AMORTIZATION` (field `null`,
 *   param `period`) when an annuity or balloon instalment does not cover the interest of
 *   a period before the last. Phase-2 conditions that validation already rejects
 *   (`UNSUPPORTED`, `BALLOON_RANGE`, `AMOUNT_TOO_SMALL_FOR_TERM`) are reported the same
 *   way should they ever reach this function.
 * @throws RangeError for terms validation cannot produce (`N < 1`, a balloon loan without
 *   a balloon).
 */
export function buildSchedule(terms: LoanTerms): ScheduleResult {
  const n = terms.payments;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`A schedule needs at least one payment, got ${String(n)}`);
  }
  const upfront = upfrontTotals(terms.fees, terms.amount, terms.rounding.fees);
  const principal = principalFinanced(terms.amount, upfront);
  const rates = rateModel(terms, principal);
  const plan = repaymentPlan(terms, principal, rates);
  if (!isPlan(plan)) {
    return { ok: false, error: plan };
  }

  const rows: ScheduleRow[] = [];
  let balance = principal;
  let earlyClose = false;
  let firstInterest = 0n;
  let firstPrincipal = 0n;
  let lastInterest = 0n;
  let lastPrincipal = 0n;
  for (const period of rates.periods) {
    const interest = period.interest(balance);
    let principalPaid = balance;
    let last = period.index === n;
    if (!last) {
      const scheduled = plan.scheduledPrincipal(period.index, interest);
      if (plan.forbidsNegativePrincipal && scheduled < 0n) {
        return {
          ok: false,
          error: {
            code: 'NEG_AMORTIZATION',
            field: null,
            params: { period: String(period.index) },
          },
        };
      }
      if (scheduled >= balance) {
        last = true;
        earlyClose = true;
      } else {
        principalPaid = scheduled;
      }
    }
    let fees = 0n;
    let insurance = 0n;
    const itemAmounts: bigint[] = [];
    for (const fee of terms.fees) {
      const amount =
        fee.kind === 'upfront'
          ? 0n
          : periodicFeeAmount(fee, terms.amount, balance, terms.rounding.fees);
      if (fee.kind === 'periodic') {
        fees += amount;
      } else if (fee.kind === 'insurance') {
        insurance += amount;
      }
      itemAmounts.push(amount);
    }
    rows.push({
      index: period.index,
      date: period.date,
      days: period.days,
      opening: balance,
      interest,
      principal: principalPaid,
      itemAmounts,
      fees,
      insurance,
      payment: interest + principalPaid + fees + insurance,
      closing: balance - principalPaid,
    });
    balance -= principalPaid;
    if (period.index === 1) {
      firstInterest = interest;
      firstPrincipal = principalPaid;
    }
    lastInterest = interest;
    lastPrincipal = principalPaid;
    if (last) {
      break;
    }
  }

  return {
    ok: true,
    schedule: {
      rows,
      upfront,
      principalFinanced: principal,
      regularInstalment: plan.regularInstalment,
      principalPerPeriod: plan.principalPerPeriod,
      balloon: plan.balloon(lastPrincipal, lastInterest, earlyClose),
      earlyClose,
      explain: plan.explain({ principal: firstPrincipal, interest: firstInterest }),
    },
  };
}
