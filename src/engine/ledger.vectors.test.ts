// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * The schedule, ledger and rate cash flows against every valid loan vector of
 * tests/vectors/core (SPEC §14): rows and summary are compared exactly as strings, the
 * EARLY_CLOSE warning with the schedule's early close, and the vector that expects
 * NEG_AMORTIZATION with the schedule error. Validation is another module's job, so the
 * vector inputs (all valid here) are turned into `LoanTerms` by a small builder that
 * applies the defaults of SPEC §15. Rates are checked by the public-API harness.
 */

import { describe, expect, it } from 'vitest';
import { minorUnits } from './currency';
import { parseIsoDate } from './date';
import { amountFinancedForRates } from './fees';
import { checkInvariants, ledgerRows, loanCashFlows, loanSummary } from './ledger';
import { toMinorUnits } from './money';
import { type Rational, div, fromInteger, parseDecimal, rational } from './rational';
import { pow10 } from './rounding';
import { buildSchedule } from './schedule/build';
import { resolvePayments, type TermSpec } from './term';
import type { BalloonSpec, Fee, LoanInput, LoanTerms } from './types';

interface Vector {
  readonly id: string;
  readonly kind: 'loan' | 'cashflows';
  readonly input: LoanInput;
  readonly expected: {
    readonly ok: boolean;
    readonly errors?: readonly { readonly code: string; readonly field: string | null }[];
    readonly warnings?: readonly { readonly code: string }[];
    readonly summary?: Readonly<Record<string, unknown>>;
    readonly rows?: readonly Readonly<Record<string, unknown>>[];
  };
}

const FILES = import.meta.glob<Vector>('../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Test input: ${what}`);
  }
  return value;
}

/** Valid vector input → validated terms, with the defaults of SPEC §15. */
function termsOf(input: LoanInput): LoanTerms {
  const mu = required(minorUnits(input.currency), 'currency');
  const minor = (text: string): bigint => required(toMinorUnits(text, mu), `minor units ${text}`);
  const anchor = required(parseIsoDate(input.disbursementDate), 'disbursementDate');
  const endOfMonth = input.endOfMonth ?? true;
  const term = input.term;
  const spec: TermSpec =
    'payments' in term
      ? { kind: 'payments', payments: term.payments }
      : 'years' in term
        ? { kind: 'years', years: term.years, months: term.months ?? 0 }
        : { kind: 'endDate', endDate: required(parseIsoDate(term.endDate), 'endDate') };
  const resolved = resolvePayments(spec, anchor, input.frequency, endOfMonth);
  if (!resolved.ok) {
    throw new Error('Test input: term');
  }
  const accrual = input.accrual;
  const fees: Fee[] = (input.fees ?? []).map((fee) => ({
    id: fee.id,
    kind: fee.kind,
    value:
      fee.calc === 'fixed'
        ? { calc: 'fixed', amount: minor(fee.value) }
        : { calc: fee.calc, pct: parseDecimal(fee.value) },
    financing: fee.kind === 'upfront' ? (fee.financing ?? 'paid') : 'paid',
    inApr: fee.inApr ?? true,
  }));
  const balloon: BalloonSpec | null =
    input.repayment !== 'balloon' || input.balloon === undefined
      ? null
      : input.balloon.kind === 'amount'
        ? { kind: 'amount', amount: minor(input.balloon.value) }
        : { kind: 'percent', pct: parseDecimal(input.balloon.value) };
  return {
    currency: input.currency,
    minorUnits: mu,
    amount: minor(input.amount),
    annualRatePct: input.annualRatePct,
    rate: div(parseDecimal(input.annualRatePct), fromInteger(100)),
    repayment: input.repayment,
    balloon,
    frequency: input.frequency,
    payments: resolved.payments,
    disbursementDate: anchor,
    endOfMonth,
    accrual:
      accrual === undefined || accrual.mode === 'periodic'
        ? { mode: 'periodic', compounding: accrual?.compounding ?? input.frequency }
        : {
            mode: 'daycount',
            method: accrual.method,
            paymentBasis: accrual.paymentBasis ?? 'nominal',
          },
    rounding: {
      interest: input.rounding?.interest ?? 'half-up',
      fees: input.rounding?.fees ?? 'half-up',
      payment: input.rounding?.payment ?? 'minor-half-up',
      principalRemainder: input.rounding?.principalRemainder ?? 'last',
    },
    fees,
    rateMethods: [],
  };
}

/** The fields of `actual` that `expected` lists (SPEC §14: absent fields are not compared). */
function pick(
  actual: object,
  expected: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const source = new Map(Object.entries(actual));
  return Object.fromEntries(Object.keys(expected).map((key) => [key, source.get(key)]));
}

const vectors = Object.values(FILES)
  .filter((vector) => vector.kind === 'loan')
  .filter(
    (vector) =>
      vector.expected.ok ||
      vector.expected.errors?.some((error) => error.code === 'NEG_AMORTIZATION'),
  );

describe('loan vectors: schedule and ledger', () => {
  it('finds the loan vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(60);
  });

  it.each(vectors.map((vector) => [vector.id, vector] as const))('%s', (_id, vector) => {
    const terms = termsOf(vector.input);
    const built = buildSchedule(terms);
    if (!vector.expected.ok) {
      expect(built).toMatchObject({ ok: false, error: { code: 'NEG_AMORTIZATION', field: null } });
      return;
    }
    if (!built.ok) {
      throw new Error(`Unexpected error ${built.error.code}`);
    }
    const { schedule } = built;
    const rows = ledgerRows(terms, schedule);
    const summary = loanSummary(terms, schedule);
    const expectedRows = vector.expected.rows ?? [];
    expect(rows).toHaveLength(expectedRows.length);
    rows.forEach((row, index) => {
      const expectedRow = required(expectedRows[index], 'row');
      expect(pick(row, expectedRow)).toEqual(expectedRow);
    });
    const expectedSummary = vector.expected.summary ?? {};
    expect(pick(summary, expectedSummary)).toEqual(expectedSummary);
    const earlyClose = (vector.expected.warnings ?? []).some((w) => w.code === 'EARLY_CLOSE');
    expect(schedule.earlyClose).toBe(earlyClose);
    expect(checkInvariants({ rows, summary }, terms)).toEqual([]);

    // §9.1: inflow at D0, then −(payment − fees and insurance excluded from the APR).
    const flows = loanCashFlows(terms, schedule);
    const scale = pow10(terms.minorUnits);
    const major = (minor: bigint): Rational => rational(minor, scale);
    expect(flows[0]).toEqual({
      date: terms.disbursementDate,
      period: 0,
      amount: major(amountFinancedForRates(terms.amount, schedule.upfront)),
    });
    schedule.rows.forEach((row, index) => {
      const excluded = terms.fees.reduce(
        (total, fee, item) =>
          fee.kind !== 'upfront' && !fee.inApr ? total + (row.itemAmounts[item] ?? 0n) : total,
        0n,
      );
      expect(flows[index + 1]).toEqual({
        date: row.date,
        period: row.index,
        amount: major(excluded - row.payment),
      });
    });
  });
});
