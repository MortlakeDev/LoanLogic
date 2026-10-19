// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import {
  type InvariantViolation,
  checkInvariants,
  ledgerRows,
  loanCashFlows,
  loanSummary,
} from './ledger';
import { rational } from './rational';
import { type Schedule, buildSchedule } from './schedule/build';
import type { Fee, LedgerRow, LoanSummary, LoanTerms } from './types';

function terms(overrides: Partial<LoanTerms> = {}): LoanTerms {
  return {
    currency: 'USD',
    minorUnits: 2,
    amount: 2_500_000n,
    annualRatePct: '8.49',
    rate: rational(849n, 10_000n),
    repayment: 'annuity',
    balloon: null,
    frequency: 'monthly',
    payments: 60,
    disbursementDate: { y: 2026, m: 3, d: 10 },
    endOfMonth: true,
    accrual: { mode: 'periodic', compounding: 'monthly' },
    rounding: {
      interest: 'half-up',
      fees: 'half-up',
      payment: 'minor-half-up',
      principalRemainder: 'last',
    },
    fees: [],
    rateMethods: [],
    ...overrides,
  };
}

function schedule(input: LoanTerms): Schedule {
  const result = buildSchedule(input);
  if (!result.ok) {
    throw new Error(`Unexpected error ${result.error.code}`);
  }
  return result.schedule;
}

// Vector us-loan-mixed-fees-apr-inclusion.
const MIXED_FEES: Fee[] = [
  {
    id: 'origination',
    kind: 'upfront',
    value: { calc: 'fixed', amount: 49_500n },
    financing: 'paid',
    inApr: true,
  },
  {
    id: 'gap-cover',
    kind: 'upfront',
    value: { calc: 'fixed', amount: 75_000n },
    financing: 'financed',
    inApr: false,
  },
  {
    id: 'service',
    kind: 'periodic',
    value: { calc: 'fixed', amount: 995n },
    financing: 'paid',
    inApr: true,
  },
  {
    id: 'credit-life',
    kind: 'insurance',
    value: { calc: 'pct-balance', pct: rational(1n, 20n) },
    financing: 'paid',
    inApr: false,
  },
];

describe('ledgerRows (SPEC §8.1)', () => {
  it('formats every amount at the minor units and accumulates interest and principal', () => {
    const input = terms({ fees: MIXED_FEES });
    const rows = ledgerRows(input, schedule(input));
    expect(rows).toHaveLength(60);
    expect(rows[0]).toEqual({
      index: 1,
      date: '2026-04-10',
      days: 31,
      annualRate: '8.49',
      opening: '25750.00',
      interestAccrued: '182.18',
      interestPaid: '182.18',
      interestCapitalized: '0.00',
      principal: '346.00',
      extraPrincipal: '0.00',
      fees: '9.95',
      insurance: '12.88',
      penalty: '0.00',
      payment: '551.01',
      closing: '25404.00',
      cumulativeInterest: '182.18',
      cumulativePrincipal: '346.00',
      events: [],
    });
    expect(rows[1]).toMatchObject({ cumulativeInterest: '361.91', cumulativePrincipal: '694.45' });
    expect(rows[59]).toMatchObject({ closing: '0.00', cumulativePrincipal: '25750.00' });
  });

  it('writes zero without a sign and uses the currency digits', () => {
    const jpy = terms({
      currency: 'JPY',
      minorUnits: 0,
      amount: 1_000_000n,
      rate: rational(-1n, 200n),
      annualRatePct: '-0.5',
      payments: 2,
    });
    const rows = ledgerRows(jpy, schedule(jpy));
    expect(rows[0]).toMatchObject({
      opening: '1000000',
      interestCapitalized: '0',
      penalty: '0',
      fees: '0',
    });
    expect(rows[0]?.interestAccrued).toBe('-417');
    const kwd = terms({
      currency: 'KWD',
      minorUnits: 3,
      amount: 1_000n,
      rate: rational(0n),
      annualRatePct: '0',
      payments: 2,
    });
    expect(ledgerRows(kwd, schedule(kwd))[0]).toMatchObject({
      interestAccrued: '0.000',
      principal: '0.500',
    });
  });
});

describe('loanSummary (SPEC §8.2)', () => {
  it('reproduces the summary of vector us-loan-mixed-fees-apr-inclusion', () => {
    const input = terms({ fees: MIXED_FEES });
    expect(loanSummary(input, schedule(input))).toEqual({
      amount: '25000.00',
      principalFinanced: '25750.00',
      netProceeds: '24505.00',
      upfrontFeesPaid: '495.00',
      upfrontFeesFinanced: '750.00',
      amountFinancedForRates: '25255.00',
      regularInstalment: '528.18',
      principalPerPeriod: null,
      firstPayment: '551.01',
      lastPayment: '538.16',
      maxPayment: '551.01',
      paymentsCount: 60,
      firstPaymentDate: '2026-04-10',
      payoffDate: '2031-03-10',
      totalPayments: '32707.45',
      totalPaid: '33202.45',
      totalInterest: '5940.57',
      totalPrincipal: '25750.00',
      totalFees: '1842.00',
      totalInsurance: '419.88',
      totalPenalties: '0.00',
      costOfCredit: '8202.45',
      balloon: null,
    });
  });

  it('reports q, the balloon and the actual number of payments by repayment type', () => {
    const ep = terms({ repayment: 'equal-principal', payments: 7 });
    expect(loanSummary(ep, schedule(ep))).toMatchObject({
      regularInstalment: null,
      principalPerPeriod: '3571.43',
      balloon: null,
      paymentsCount: 7,
    });
    const balloon = terms({
      repayment: 'balloon',
      balloon: { kind: 'amount', amount: 100n },
      amount: 1_000n,
      rate: rational(1n, 100n),
      annualRatePct: '1',
      payments: 12,
      rounding: { ...terms().rounding, payment: 'unit-ceil' },
    });
    expect(loanSummary(balloon, schedule(balloon))).toMatchObject({
      regularInstalment: '1.00',
      balloon: '0.00',
      paymentsCount: 11,
      lastPayment: '0.05',
      payoffDate: '2027-02-10',
    });
  });

  it('takes the largest payment, which need not be the first', () => {
    const bullet = terms({ repayment: 'bullet', payments: 3 });
    const summary = loanSummary(bullet, schedule(bullet));
    expect(summary.maxPayment).toBe(summary.lastPayment);
    expect(summary.firstPayment).not.toBe(summary.maxPayment);
  });

  it('rejects a schedule without rows', () => {
    const input = terms();
    const empty: Schedule = { ...schedule(input), rows: [] };
    expect(() => loanSummary(input, empty)).toThrow(RangeError);
  });
});

describe('loanCashFlows (SPEC §9.1)', () => {
  it('starts with the amount financed and excludes items outside the APR', () => {
    const input = terms({ fees: MIXED_FEES });
    const s = schedule(input);
    const flows = loanCashFlows(input, s);
    expect(flows).toHaveLength(61);
    // 25 000.00 + 750.00 financed outside the APR − 495.00 paid in the APR.
    expect(flows[0]).toEqual({
      date: { y: 2026, m: 3, d: 10 },
      period: 0,
      amount: rational(2_525_500n, 100n),
    });
    // 551.01 paid, of which the 12.88 insurance is not a finance charge.
    expect(flows[1]).toEqual({
      date: { y: 2026, m: 4, d: 10 },
      period: 1,
      amount: rational(-53_813n, 100n),
    });
    expect(flows[60]?.period).toBe(60);
  });

  it('counts periodic items in the APR and works in major units of any currency', () => {
    const fees: Fee[] = [
      {
        id: 'commission',
        kind: 'periodic',
        value: { calc: 'fixed', amount: 500n },
        financing: 'paid',
        inApr: true,
      },
      {
        id: 'cover',
        kind: 'insurance',
        value: { calc: 'fixed', amount: 300n },
        financing: 'paid',
        inApr: true,
      },
      {
        id: 'optional',
        kind: 'periodic',
        value: { calc: 'fixed', amount: 7n },
        financing: 'paid',
        inApr: false,
      },
    ];
    const input = terms({
      currency: 'KWD',
      minorUnits: 3,
      amount: 12_000n,
      rate: rational(0n),
      annualRatePct: '0',
      payments: 12,
      fees,
    });
    const flows = loanCashFlows(input, schedule(input));
    expect(flows[0]?.amount).toEqual(rational(12n));
    // 1.000 principal + 0.500 + 0.300; the optional 0.007 is excluded.
    expect(flows[1]?.amount).toEqual(rational(-1_800n, 1_000n));
  });

  it('keeps zero outflows of interest-free bullet periods', () => {
    const input = terms({
      repayment: 'bullet',
      rate: rational(0n),
      annualRatePct: '0',
      payments: 3,
    });
    const flows = loanCashFlows(input, schedule(input));
    expect(flows.map((flow) => flow.amount)).toEqual([
      rational(25_000n),
      rational(0n),
      rational(0n),
      rational(-25_000n),
    ]);
  });
});

describe('checkInvariants (SPEC §8.3)', () => {
  const input = terms({ payments: 3, amount: 300_000n });
  const s = schedule(input);
  const valid = { rows: ledgerRows(input, s), summary: loanSummary(input, s) };
  const options = { minorUnits: 2, repayment: 'annuity' } as const;

  function withRow(
    index: number,
    patch: Partial<LedgerRow>,
  ): { rows: LedgerRow[]; summary: LoanSummary } {
    return {
      rows: valid.rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
      summary: valid.summary,
    };
  }

  function codes(violations: readonly InvariantViolation[]): string[] {
    return violations.map((violation) => `${violation.invariant}@${String(violation.index)}`);
  }

  it('accepts a correct ledger', () => {
    expect(checkInvariants(valid, options)).toEqual([]);
  });

  it('reports I1, I2 and I3 on the row', () => {
    const first = valid.rows[0];
    expect(first).toBeDefined();
    expect(codes(checkInvariants(withRow(1, { interestCapitalized: '1.00' }), options))).toEqual([
      'I1@2',
      'I3@2',
      'I6@null',
    ]);
    expect(codes(checkInvariants(withRow(0, { payment: '0.01' }), options))).toEqual(['I2@1']);
    expect(codes(checkInvariants(withRow(0, { interestAccrued: '0.01' }), options))).toEqual([
      'I3@1',
    ]);
  });

  it('reports I4 on the first opening and on a broken chain', () => {
    expect(
      codes(
        checkInvariants(
          { ...valid, summary: { ...valid.summary, principalFinanced: '1.00' } },
          options,
        ),
      ),
    ).toEqual(['I4@1', 'I6@null']);
    const second = valid.rows[1];
    const shifted = withRow(1, {
      opening: shift(second?.opening ?? '0.00', 100n),
      closing: shift(second?.closing ?? '0.00', 100n),
    });
    expect(codes(checkInvariants(shifted, options))).toEqual(['I4@2', 'I4@3']);
  });

  it('reports I5 when the loan is not repaid, and on an empty ledger', () => {
    const last = valid.rows[2];
    expect(last).toBeDefined();
    const unpaid = withRow(2, {
      closing: '0.01',
      principal: shift(last?.principal ?? '0.00', -1n),
      payment: shift(last?.payment ?? '0.00', -1n),
    });
    expect(codes(checkInvariants(unpaid, options))).toEqual(['I5@null', 'I6@null']);
    expect(codes(checkInvariants({ rows: [], summary: valid.summary }, options))).toEqual([
      'I5@null',
      'I6@null',
    ]);
  });

  it('reports I6 when the principal does not add up to P', () => {
    const summary = { ...valid.summary, principalFinanced: valid.rows[0]?.opening ?? '' };
    expect(checkInvariants({ rows: valid.rows, summary }, options)).toEqual([]);
    expect(codes(checkInvariants({ rows: valid.rows.slice(1), summary }, options))).toEqual([
      'I4@2',
      'I6@null',
    ]);
  });

  it('reports I7 for amounts not written at the minor units', () => {
    for (const text of [
      '1000',
      '1000.0',
      '1000.000',
      '01000.00',
      '-0.00',
      '1e3',
      ' 1.00',
      '1,000.00',
    ]) {
      expect(codes(checkInvariants(withRow(0, { fees: text }), options))).toEqual(['I7@1']);
    }
    const notString = withRow(0, { penalty: 0 as unknown as string });
    expect(codes(checkInvariants(notString, options))).toEqual(['I7@1']);
    const summary = { ...valid.summary, totalFees: '0', amount: null as unknown as string };
    expect(codes(checkInvariants({ rows: valid.rows, summary }, options))).toEqual([
      'I7@null',
      'I7@null',
    ]);
    expect(
      checkInvariants(
        {
          rows: valid.rows,
          summary: { ...valid.summary, balloon: null, principalPerPeriod: null },
        },
        options,
      ),
    ).toEqual([]);
  });

  it('skips the checks that need a malformed amount', () => {
    const broken = withRow(1, { opening: 'x' });
    expect(codes(checkInvariants(broken, options))).toEqual(['I7@2']);
  });

  it('checks whole currency units and other digit counts', () => {
    const jpy = terms({ currency: 'JPY', minorUnits: 0, amount: 1_000_000n, payments: 4 });
    const sj = schedule(jpy);
    const ledger = { rows: ledgerRows(jpy, sj), summary: loanSummary(jpy, sj) };
    expect(checkInvariants(ledger, { minorUnits: 0, repayment: 'annuity' })).toEqual([]);
    expect(
      codes(checkInvariants(ledger, { minorUnits: 2, repayment: 'annuity' })).length,
    ).toBeGreaterThan(0);
  });

  it('reports I8 when a regular row does not pay the instalment', () => {
    const first = valid.rows[0];
    const instalment = valid.summary.regularInstalment ?? '';
    expect(first?.payment).toBe(instalment);
    const summary = { ...valid.summary, regularInstalment: '1.00' };
    expect(codes(checkInvariants({ rows: valid.rows, summary }, options))).toEqual([
      'I8@1',
      'I8@2',
    ]);
    expect(
      codes(
        checkInvariants({ rows: valid.rows, summary }, { minorUnits: 2, repayment: 'balloon' }),
      ),
    ).toEqual(['I8@1', 'I8@2']);
    expect(
      codes(
        checkInvariants(
          { rows: valid.rows, summary: { ...valid.summary, regularInstalment: null } },
          options,
        ),
      ),
    ).toEqual(['I8@null']);
    // Other repayment types have no instalment to check.
    expect(
      checkInvariants({ rows: valid.rows, summary }, { minorUnits: 2, repayment: 'bullet' }),
    ).toEqual([]);
    expect(
      checkInvariants(
        { rows: valid.rows, summary },
        { minorUnits: 2, repayment: 'equal-principal' },
      ),
    ).toEqual([]);
  });

  it('reports I9 for a negative balance', () => {
    const first = valid.rows[0];
    const negative = withRow(0, {
      opening: shift(first?.opening ?? '0.00', -400_000n),
      closing: shift(first?.closing ?? '0.00', -400_000n),
    });
    expect(codes(checkInvariants(negative, options))).toEqual(['I4@1', 'I9@1', 'I4@2']);
  });
});

/** A two-decimal amount string moved by `cents` minor units. */
function shift(text: string, cents: bigint): string {
  const value = BigInt(text.replace('.', '')) + cents;
  const magnitude = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : '';
  return `${sign}${(magnitude / 100n).toString()}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}
