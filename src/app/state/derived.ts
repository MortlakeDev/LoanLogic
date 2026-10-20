// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Figures the results display derives from an engine result: loan-year groups of the
 * schedule with exact subtotals (DESIGN §8.10), the cost structure (§8.9), the fees a
 * headline rate includes (§8.7), the payment hero's amounts (§8.6) and the payments the
 * rates count (SPEC §9.1). Pure functions over the engine's decimal strings; sums are
 * exact (BigInt minor units), so a subtotal always equals the sum of its rows. Components
 * call these instead of doing arithmetic on money.
 */

import type { FeeAmount, FrequencyId, LedgerRow, LoanSummary } from '../../engine';

const PERIODS_PER_YEAR: Readonly<Record<FrequencyId, number>> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/** Payments per year `m` of a frequency. */
export function periodsPerYear(frequency: FrequencyId): number {
  return PERIODS_PER_YEAR[frequency];
}

/** An engine money string as a count of minor units ("1234.50" with 2 digits → 123450n). */
export function toMinor(value: string, minorUnits: number): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole + fraction.padEnd(minorUnits, '0').slice(0, minorUnits));
  return negative ? -units : units;
}

/** Minor units as an engine money string (never "-0.00"). */
export function fromMinor(units: bigint, minorUnits: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(minorUnits + 1, '0');
  const whole = minorUnits === 0 ? digits : digits.slice(0, -minorUnits);
  const text = minorUnits === 0 ? whole : `${whole}.${digits.slice(-minorUnits)}`;
  return negative && units !== 0n ? `-${text}` : text;
}

/** The exact sum of engine money strings, as an engine money string. */
export function sumMoney(values: readonly string[], minorUnits: number): string {
  return fromMinor(
    values.reduce((total, value) => total + toMinor(value, minorUnits), 0n),
    minorUnits,
  );
}

/** One loan year of the schedule (DESIGN §8.10). */
export interface ScheduleYear {
  /** 1-based loan year: payments (year − 1)·m + 1 … year·m, by payment number. */
  readonly year: number;
  readonly rows: readonly LedgerRow[];
  /** Dates of the first and last payment of the year (YYYY-MM-DD). */
  readonly firstDate: string;
  readonly lastDate: string;
  /** Exact sums of the year's rows. */
  readonly payment: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  /** The balance after the year's last payment. */
  readonly closing: string;
}

/** The schedule's totals row (DESIGN §8.10). */
export interface ScheduleTotals {
  readonly count: number;
  readonly payment: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly closing: string;
}

/**
 * Groups the rows by loan year: year y holds payments (y − 1)·m + 1 … y·m, counted by
 * payment number, not by calendar year (for weekly loans the two differ).
 */
export function scheduleYears(
  rows: readonly LedgerRow[],
  frequency: FrequencyId,
  minorUnits: number,
): ScheduleYear[] {
  const m = periodsPerYear(frequency);
  const years: ScheduleYear[] = [];
  for (let start = 0; start < rows.length; start += m) {
    const slice = rows.slice(start, start + m);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (first === undefined || last === undefined) {
      break;
    }
    const sum = (pick: (row: LedgerRow) => string): string => sumMoney(slice.map(pick), minorUnits);
    years.push({
      year: start / m + 1,
      rows: slice,
      firstDate: first.date,
      lastDate: last.date,
      payment: sum((row) => row.payment),
      principal: sum((row) => row.principal),
      interest: sum((row) => row.interestPaid),
      fees: sum((row) => row.fees),
      insurance: sum((row) => row.insurance),
      closing: last.closing,
    });
  }
  return years;
}

/** The column totals of a schedule. */
export function scheduleTotals(rows: readonly LedgerRow[], minorUnits: number): ScheduleTotals {
  const sum = (pick: (row: LedgerRow) => string): string => sumMoney(rows.map(pick), minorUnits);
  return {
    count: rows.length,
    payment: sum((row) => row.payment),
    principal: sum((row) => row.principal),
    interest: sum((row) => row.interestPaid),
    fees: sum((row) => row.fees),
    insurance: sum((row) => row.insurance),
    closing: rows[rows.length - 1]?.closing ?? fromMinor(0n, minorUnits),
  };
}

/** One part of the cost structure. */
export interface CostPart {
  readonly key: 'principal' | 'interest' | 'fees';
  /** Engine money string; may be negative (negative interest). */
  readonly amount: string;
  /**
   * Share of the total as a decimal fraction rounded half-up to 0.1 % ("0.421"), for
   * `formatPercent(share, 1, locale)`.
   */
  readonly share: string;
  /** Share of the bar width, 0…1; negative parts get no width. */
  readonly width: number;
}

/** The cost structure of DESIGN §8.9. */
export interface CostStructure {
  readonly parts: readonly CostPart[];
  /** `totalPaid`: principal + interest + fees and insurance, exactly. */
  readonly total: string;
  /** `totalPaid ÷ amount`, half-up to 2 decimals ("2.37"), whatever the minor units. */
  readonly ratio: string;
}

/** Half-up division of non-negative-denominator integers. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

/**
 * The cost structure of a summary (DESIGN §8.9): principal = `amount`, interest =
 * `totalInterest`, fees = `totalFees + totalInsurance`, total = `totalPaid` (they add up
 * exactly; a financed fee is counted once), each part's share of the total and the bar
 * widths, and the ratio repaid per unit borrowed.
 */
export function costStructure(summary: LoanSummary, minorUnits: number): CostStructure {
  const principal = toMinor(summary.amount, minorUnits);
  const interest = toMinor(summary.totalInterest, minorUnits);
  const fees = toMinor(summary.totalFees, minorUnits) + toMinor(summary.totalInsurance, minorUnits);
  const total = toMinor(summary.totalPaid, minorUnits);
  const positive = [principal, interest, fees].reduce(
    (sum, value) => sum + (value > 0n ? value : 0n),
    0n,
  );
  const part = (key: CostPart['key'], value: bigint): CostPart => ({
    key,
    amount: fromMinor(value, minorUnits),
    share: total === 0n ? '0.000' : fromMinor(divideHalfUp(value * 1000n, total), 3),
    width: positive === 0n || value <= 0n ? 0 : Number((value * 10000n) / positive) / 10000,
  });
  return {
    parts: [part('principal', principal), part('interest', interest), part('fees', fees)],
    total: fromMinor(total, minorUnits),
    ratio: principal === 0n ? '0.00' : fromMinor(divideHalfUp(total * 100n, principal), 2),
  };
}

/** Fee items a headline rate includes (DESIGN §8.7 "Includes …"). */
export interface IncludedFees {
  /** The included items with their totals, in input order. */
  readonly items: readonly FeeAmount[];
  /** Their exact sum. */
  readonly total: string;
}

/**
 * The fees and insurance included in the cost-of-credit rates (`inApr`), with their
 * totals over the loan.
 *
 * @param amounts The engine's fee amounts (`result.fees`).
 * @param inApr Whether each fee id is included.
 */
export function includedFees(
  amounts: readonly FeeAmount[],
  inApr: (id: string) => boolean,
  minorUnits: number,
): IncludedFees {
  const items = amounts.filter((fee) => inApr(fee.id));
  return {
    items,
    total: sumMoney(
      items.map((fee) => fee.total),
      minorUnits,
    ),
  };
}

/**
 * The payments as the cost-of-credit rates count them (SPEC §9.1): principal and interest
 * plus only the periodic fees and insurance included in the rates. `totalPayments` also
 * holds the per-payment items left out of the rates, which the rates were not solved on.
 *
 * @param totalPayments `summary.totalPayments`, in major units.
 * @param amounts The engine's fee amounts (`result.fees`).
 * @param inApr Whether each fee id is included.
 */
export function paymentsInRates(
  totalPayments: string,
  amounts: readonly FeeAmount[],
  inApr: (id: string) => boolean,
  minorUnits: number,
): string {
  return fromMinor(
    amounts
      .filter((fee) => fee.kind !== 'upfront' && !inApr(fee.id))
      .reduce(
        (total, fee) => total - toMinor(fee.total, minorUnits),
        toMinor(totalPayments, minorUnits),
      ),
    minorUnits,
  );
}

/** A payment's instalment: principal + interest, without its fees and insurance. */
export function instalmentOf(row: LedgerRow, minorUnits: number): string {
  return sumMoney([row.principal, row.interestPaid], minorUnits);
}

/**
 * The payment hero's amounts (DESIGN §8.6), all on the instalment basis (principal +
 * interest). `regularInstalment` is `A` without fees while the summary's first and last
 * payments include periodic fees and insurance (SPEC §8.2), so mixing them would compare
 * unlike amounts ("payment $8,560.75 · final payment $8,570.73" for one loan).
 */
export interface HeroAmounts {
  /** `A` for annuity and balloon, else the first payment's principal + interest. */
  readonly payment: string;
  /** The last payment's principal + interest. */
  readonly last: string;
  /**
   * The first payment as paid, with its periodic fees and insurance, or `null` when no
   * payment carries any (it then equals the instalment).
   */
  readonly firstPaid: string | null;
}

/**
 * The hero's amounts of a computed loan.
 *
 * @throws RangeError without rows: a computed loan always has at least one payment.
 */
export function heroAmounts(
  summary: LoanSummary,
  rows: readonly LedgerRow[],
  minorUnits: number,
): HeroAmounts {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError('A computed loan has at least one payment');
  }
  const charged = rows.some(
    (row) => toMinor(row.fees, minorUnits) !== 0n || toMinor(row.insurance, minorUnits) !== 0n,
  );
  return {
    payment: summary.regularInstalment ?? instalmentOf(first, minorUnits),
    last: instalmentOf(last, minorUnits),
    firstPaid: charged ? first.payment : null,
  };
}

/** Which per-payment items a loan charges: periodic fees, insurance (non-zero totals). */
export interface ChargedKinds {
  readonly periodic: boolean;
  readonly insurance: boolean;
}

/** The per-payment item kinds with a non-zero total, from the engine's fee amounts. */
export function chargedKinds(fees: readonly FeeAmount[], minorUnits: number): ChargedKinds {
  const charged = (kind: 'periodic' | 'insurance'): boolean =>
    fees.some((fee) => fee.kind === kind && toMinor(fee.total, minorUnits) !== 0n);
  return { periodic: charged('periodic'), insurance: charged('insurance') };
}

/** A term in whole years and months, or `null` when payments do not fill whole months. */
export function durationOf(
  payments: number,
  frequency: FrequencyId,
): { readonly years: number; readonly months: number } | null {
  const m = periodsPerYear(frequency);
  const monthsPerPayment = 12 / m;
  if (!Number.isInteger(monthsPerPayment)) {
    return Number.isInteger(payments / m) ? { years: payments / m, months: 0 } : null;
  }
  const months = payments * monthsPerPayment;
  return { years: Math.floor(months / 12), months: months % 12 };
}
