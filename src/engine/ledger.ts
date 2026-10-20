// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The public ledger (SPEC §8): rows and summary as decimal strings at the currency's
 * minor units, the cash flows the rate metrics use (§9.1), and the invariant checker
 * I1–I9 (§8.3) that tests and the UI's development build run on a result.
 */

import { formatIsoDate } from './date';
import { amountFinancedForRates } from './fees';
import { formatMinor } from './money';
import { rational } from './rational';
import { pow10 } from './rounding';
import type { Schedule } from './schedule/build';
import type {
  CashFlow,
  FeeAmount,
  LedgerRow,
  LoanSummary,
  LoanTerms,
  RepaymentType,
} from './types';

/**
 * The ledger rows of a schedule (SPEC §8.1): money as decimal strings at the currency's
 * minor units ("1234.50", zero "0.00"), the rate as entered, dates as `YYYY-MM-DD`.
 * In M1 interest is paid as it accrues, and capitalized interest, extra principal and
 * penalties are zero.
 *
 * @param terms The validated terms the schedule was built from.
 * @param schedule The schedule of `terms`.
 */
export function ledgerRows(terms: LoanTerms, schedule: Schedule): LedgerRow[] {
  const money = (value: bigint): string => formatMinor(value, terms.minorUnits);
  const zero = money(0n);
  const rows: LedgerRow[] = [];
  let cumulativeInterest = 0n;
  let cumulativePrincipal = 0n;
  for (const row of schedule.rows) {
    cumulativeInterest += row.interest;
    cumulativePrincipal += row.principal;
    rows.push({
      index: row.index,
      date: formatIsoDate(row.date),
      days: row.days,
      annualRate: terms.annualRatePct,
      opening: money(row.opening),
      interestAccrued: money(row.interest),
      interestPaid: money(row.interest),
      interestCapitalized: zero,
      principal: money(row.principal),
      extraPrincipal: zero,
      fees: money(row.fees),
      insurance: money(row.insurance),
      penalty: zero,
      payment: money(row.payment),
      closing: money(row.closing),
      cumulativeInterest: money(cumulativeInterest),
      cumulativePrincipal: money(cumulativePrincipal),
      events: [],
    });
  }
  return rows;
}

/** The first and last row of a schedule, which always has at least one. */
function endRows(
  schedule: Schedule,
): readonly [Schedule['rows'][number], Schedule['rows'][number]] {
  const first = schedule.rows[0];
  const last = schedule.rows[schedule.rows.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError('A schedule without rows');
  }
  return [first, last];
}

/**
 * The loan summary (SPEC §8.2), money as decimal strings at the currency's minor units.
 *
 * `netProceeds = amount − upfront paid`; `totalPaid = Σ payments + upfront paid`;
 * `totalFees = Σ periodic fees + all upfront items` (paid and financed);
 * `costOfCredit = totalPaid − amount`.
 *
 * @param terms The validated terms the schedule was built from.
 * @param schedule The schedule of `terms`.
 * @throws RangeError if the schedule has no rows (`buildSchedule` never produces one).
 */
export function loanSummary(terms: LoanTerms, schedule: Schedule): LoanSummary {
  const money = (value: bigint): string => formatMinor(value, terms.minorUnits);
  const optional = (value: bigint | null): string | null => (value === null ? null : money(value));
  const [first, last] = endRows(schedule);
  const { upfront } = schedule;
  let totalPayments = 0n;
  let totalInterest = 0n;
  let totalPrincipal = 0n;
  let periodicFees = 0n;
  let totalInsurance = 0n;
  let maxPayment = first.payment;
  for (const row of schedule.rows) {
    totalPayments += row.payment;
    totalInterest += row.interest;
    totalPrincipal += row.principal;
    periodicFees += row.fees;
    totalInsurance += row.insurance;
    if (row.payment > maxPayment) {
      maxPayment = row.payment;
    }
  }
  const totalPaid = totalPayments + upfront.paid;
  return {
    amount: money(terms.amount),
    principalFinanced: money(schedule.principalFinanced),
    netProceeds: money(terms.amount - upfront.paid),
    upfrontFeesPaid: money(upfront.paid),
    upfrontFeesFinanced: money(upfront.financed),
    amountFinancedForRates: money(amountFinancedForRates(terms.amount, upfront)),
    regularInstalment: optional(schedule.regularInstalment),
    principalPerPeriod: optional(schedule.principalPerPeriod),
    firstPayment: money(first.payment),
    lastPayment: money(last.payment),
    maxPayment: money(maxPayment),
    paymentsCount: schedule.rows.length,
    firstPaymentDate: formatIsoDate(first.date),
    payoffDate: formatIsoDate(last.date),
    totalPayments: money(totalPayments),
    totalPaid: money(totalPaid),
    totalInterest: money(totalInterest),
    totalPrincipal: money(totalPrincipal),
    totalFees: money(periodicFees + upfront.paid + upfront.financed),
    totalInsurance: money(totalInsurance),
    totalPenalties: money(0n),
    costOfCredit: money(totalPaid - terms.amount),
    balloon: optional(schedule.balloon),
  };
}

/**
 * The borrower's cash flows that the rate metrics use (SPEC §9.1), in date order:
 *
 * - at `D0` (period 0) the inflow `amount + financed items not in the APR − paid items in
 *   the APR` (Regulation Z's amount financed);
 * - at each payment date (period k) the outflow `−(interest + principal + Σ periodic fee
 *   and insurance items with inApr)`.
 *
 * Amounts are exact rationals in major units (+ received, − paid). Voluntary events and
 * penalties do not exist in M1.
 *
 * @param terms The validated terms the schedule was built from.
 * @param schedule The schedule of `terms`.
 */
/**
 * The amounts of every fee and insurance item, in input order (SPEC §8.1): an upfront
 * item's amount, or a periodic item's first-period amount and its total over the
 * schedule actually paid (after an early close).
 */
export function feeAmounts(terms: LoanTerms, schedule: Schedule): FeeAmount[] {
  const money = (value: bigint): string => formatMinor(value, terms.minorUnits);
  return terms.fees.map((fee, index) => {
    if (fee.kind === 'upfront') {
      const item = schedule.upfront.items.find((upfront) => upfront.fee === fee);
      const amount = money(item?.amount ?? 0n);
      return { id: fee.id, kind: fee.kind, amount, total: amount };
    }
    const amounts = schedule.rows.map((row) => row.itemAmounts[index] ?? 0n);
    return {
      id: fee.id,
      kind: fee.kind,
      amount: money(amounts[0] ?? 0n),
      total: money(amounts.reduce((total, amount) => total + amount, 0n)),
    };
  });
}

export function loanCashFlows(terms: LoanTerms, schedule: Schedule): CashFlow[] {
  const scale = pow10(terms.minorUnits);
  const counted = terms.fees.map((fee) => fee.kind !== 'upfront' && fee.inApr);
  const flows: CashFlow[] = [
    {
      date: terms.disbursementDate,
      period: 0,
      amount: rational(amountFinancedForRates(terms.amount, schedule.upfront), scale),
    },
  ];
  for (const row of schedule.rows) {
    const charges = row.itemAmounts.reduce(
      (total, amount, index) => (counted[index] === true ? total + amount : total),
      0n,
    );
    flows.push({
      date: row.date,
      period: row.index,
      amount: rational(-(row.interest + row.principal + charges), scale),
    });
  }
  return flows;
}

/** A ledger invariant that does not hold (SPEC §8.3). */
export interface InvariantViolation {
  readonly invariant: 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9';
  /** The row index, or `null` for a check on the whole ledger. */
  readonly index: number | null;
  /** Developer text in English; never shown to users. */
  readonly message: string;
}

const ROW_MONEY_FIELDS = [
  'opening',
  'interestAccrued',
  'interestPaid',
  'interestCapitalized',
  'principal',
  'extraPrincipal',
  'fees',
  'insurance',
  'penalty',
  'payment',
  'closing',
  'cumulativeInterest',
  'cumulativePrincipal',
] as const satisfies readonly (keyof LedgerRow)[];

const SUMMARY_MONEY_FIELDS = [
  'amount',
  'principalFinanced',
  'netProceeds',
  'upfrontFeesPaid',
  'upfrontFeesFinanced',
  'amountFinancedForRates',
  'regularInstalment',
  'principalPerPeriod',
  'firstPayment',
  'lastPayment',
  'maxPayment',
  'totalPayments',
  'totalPaid',
  'totalInterest',
  'totalPrincipal',
  'totalFees',
  'totalInsurance',
  'totalPenalties',
  'costOfCredit',
  'balloon',
] as const satisfies readonly (keyof LoanSummary)[];

type RowMoney = Readonly<Record<(typeof ROW_MONEY_FIELDS)[number], bigint>>;

const NULLABLE_SUMMARY_FIELDS: ReadonlySet<string> = new Set([
  'regularInstalment',
  'principalPerPeriod',
  'balloon',
]);

/**
 * Minor units of a money string, or `null` unless it is exactly how the ledger formats
 * that amount: optional "-", no leading zeros, exactly `minorUnits` decimals (none for
 * 0), never "-0.00" (I7).
 */
function parseMoney(text: unknown, minorUnits: number): bigint | null {
  if (typeof text !== 'string') {
    return null;
  }
  const match = /^-?\d+(?:\.(\d+))?$/.exec(text);
  if (match === null || (match[1]?.length ?? 0) !== minorUnits) {
    return null;
  }
  // The round trip rejects leading zeros and "-0.00".
  const value = BigInt(text.replace('.', ''));
  return formatMinor(value, minorUnits) === text ? value : null;
}

/** The amounts of a row, or `null` (after reporting I7) when one is malformed. */
function parseRow(
  row: LedgerRow,
  minorUnits: number,
  report: (message: string) => void,
): RowMoney | null {
  const parsed = new Map<string, bigint>();
  for (const field of ROW_MONEY_FIELDS) {
    // Typed as strings, but the checker also runs on untrusted results.
    const text: unknown = row[field];
    const value = parseMoney(text, minorUnits);
    if (value === null) {
      report(`${field} "${String(text)}" is not an amount at ${String(minorUnits)} decimals`);
    } else {
      parsed.set(field, value);
    }
  }
  if (parsed.size !== ROW_MONEY_FIELDS.length) {
    return null;
  }
  // Every field was parsed, so the map holds a value for each key.
  return Object.fromEntries(parsed) as RowMoney;
}

/**
 * Checks the ledger invariants I1–I9 of SPEC §8.3 exactly, on the public strings:
 *
 * - I1 `closing = opening + interestCapitalized − principal − extraPrincipal`;
 * - I2 `payment = interestPaid + principal + extraPrincipal + fees + insurance + penalty`;
 * - I3 `interestAccrued = interestPaid + interestCapitalized`;
 * - I4 `opening_1 = principalFinanced`, `opening_{k+1} = closing_k`;
 * - I5 the final closing balance is 0;
 * - I6 `Σ(principal + extraPrincipal) = principalFinanced + Σ interestCapitalized`;
 * - I7 every amount of the rows and the summary is a canonical decimal string with
 *   exactly `minorUnits` decimals (`null` only where the summary allows it);
 * - I8 annuity and balloon: `principal + interestPaid = regularInstalment` on every row
 *   but the last;
 * - I9 no opening or closing balance is negative.
 *
 * A check that needs an amount failing I7 is skipped; I7 reports it.
 *
 * @param ledger The rows and summary of a calculated loan.
 * @param options Digits of the currency's minor unit and the repayment type.
 * @returns Every violation found, `[]` when all invariants hold.
 */
export function checkInvariants(
  ledger: { readonly rows: readonly LedgerRow[]; readonly summary: LoanSummary },
  options: { readonly minorUnits: number; readonly repayment: RepaymentType },
): InvariantViolation[] {
  const { minorUnits, repayment } = options;
  const violations: InvariantViolation[] = [];
  const report = (
    invariant: InvariantViolation['invariant'],
    index: number | null,
    message: string,
  ): void => {
    violations.push({ invariant, index, message });
  };

  for (const field of SUMMARY_MONEY_FIELDS) {
    const text: unknown = ledger.summary[field];
    if (
      !(text === null && NULLABLE_SUMMARY_FIELDS.has(field)) &&
      parseMoney(text, minorUnits) === null
    ) {
      report(
        'I7',
        null,
        `summary.${field} "${String(text)}" is not an amount at ${String(minorUnits)} decimals`,
      );
    }
  }
  const principalFinanced = parseMoney(ledger.summary.principalFinanced, minorUnits);
  const level = repayment === 'annuity' || repayment === 'balloon';
  const instalmentText = ledger.summary.regularInstalment;
  if (level && instalmentText === null) {
    report('I8', null, `regularInstalment is null for a ${repayment} loan`);
  }
  const instalment = level ? parseMoney(instalmentText, minorUnits) : null;

  let repaid = 0n;
  let capitalized = 0n;
  let previousClosing: bigint | null = null;
  let finalClosing: bigint | null = null;
  let complete = true;
  for (const [position, entry] of ledger.rows.entries()) {
    const index = entry.index;
    const row = parseRow(entry, minorUnits, (message) => {
      report('I7', index, message);
    });
    if (row === null) {
      complete = false;
      previousClosing = null;
      finalClosing = null;
      continue;
    }
    if (
      row.closing !==
      row.opening + row.interestCapitalized - row.principal - row.extraPrincipal
    ) {
      report('I1', index, 'closing ≠ opening + interestCapitalized − principal − extraPrincipal');
    }
    const parts =
      row.interestPaid +
      row.principal +
      row.extraPrincipal +
      row.fees +
      row.insurance +
      row.penalty;
    if (row.payment !== parts) {
      report(
        'I2',
        index,
        'payment ≠ interestPaid + principal + extraPrincipal + fees + insurance + penalty',
      );
    }
    if (row.interestAccrued !== row.interestPaid + row.interestCapitalized) {
      report('I3', index, 'interestAccrued ≠ interestPaid + interestCapitalized');
    }
    const expectedOpening = position === 0 ? principalFinanced : previousClosing;
    if (expectedOpening !== null && row.opening !== expectedOpening) {
      report(
        'I4',
        index,
        position === 0
          ? 'opening of the first row ≠ principalFinanced'
          : 'opening ≠ previous closing',
      );
    }
    if (
      instalment !== null &&
      position < ledger.rows.length - 1 &&
      row.principal + row.interestPaid !== instalment
    ) {
      report('I8', index, 'principal + interestPaid ≠ regularInstalment');
    }
    if (row.opening < 0n || row.closing < 0n) {
      report('I9', index, 'negative balance');
    }
    repaid += row.principal + row.extraPrincipal;
    capitalized += row.interestCapitalized;
    previousClosing = row.closing;
    finalClosing = row.closing;
  }

  if (ledger.rows.length === 0) {
    report('I5', null, 'the ledger has no rows');
  } else if (finalClosing !== null && finalClosing !== 0n) {
    report('I5', null, 'the final closing balance is not 0');
  }
  if (complete && principalFinanced !== null && repaid !== principalFinanced + capitalized) {
    report('I6', null, 'Σ(principal + extraPrincipal) ≠ principalFinanced + Σ interestCapitalized');
  }
  return violations;
}
