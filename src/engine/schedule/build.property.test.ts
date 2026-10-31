// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * Property tests of the schedule and ledger on random validated terms (T02 brief):
 * amount 1 minor unit … 1e12, rate −5 … 60 %, N 1 … 600, every repayment type,
 * frequency, accrual mode, rounding option and fee type. A schedule either fails with
 * one of the errors the SPEC defines for the combination, or its ledger satisfies the
 * invariants I1–I9 exactly, repays exactly the principal financed on strictly increasing
 * dates, pays the instalment on every regular annuity period, and is deterministic.
 */

import { Decimal } from 'decimal.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FREQUENCY_IDS } from '../frequency';
import { DAY_COUNT_IDS } from '../daycount';
import { type LocalDate, compareDates, daysBetween, daysInMonth } from '../date';
import { principalFinanced, upfrontTotals } from '../fees';
import { checkInvariants, ledgerRows, loanCashFlows, loanSummary } from '../ledger';
import { divRound, formatScaled, rational } from '../rational';
import type {
  Accrual,
  BalloonSpec,
  CompoundingId,
  EngineError,
  Fee,
  LoanTerms,
  PaymentRounding,
  RepaymentType,
  RoundingMode,
} from '../types';
import { balloonResidual } from './balloon';
import { type ScheduleRow, buildSchedule } from './build';
import { equalPrincipalAmount, remainderFirstPrincipal } from './equal-principal';

const CURRENCIES = [
  { currency: 'USD', minorUnits: 2 },
  { currency: 'JPY', minorUnits: 0 },
  { currency: 'KWD', minorUnits: 3 },
  { currency: 'CLF', minorUnits: 4 },
] as const;
const REPAYMENTS: readonly RepaymentType[] = ['annuity', 'equal-principal', 'bullet', 'balloon'];
const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];
const POLICIES: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];
const COMPOUNDINGS: readonly CompoundingId[] = [...FREQUENCY_IDS, 'continuous'];

const dateArb: fc.Arbitrary<LocalDate> = fc
  .record({
    y: fc.integer({ min: 1990, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }) => ({ y, m, d: Math.min(d, daysInMonth(y, m)) }));

const accrualArb: fc.Arbitrary<Accrual> = fc.oneof(
  fc
    .constantFrom(...COMPOUNDINGS)
    .map((compounding): Accrual => ({ mode: 'periodic', compounding })),
  fc
    .record({
      method: fc.constantFrom(...DAY_COUNT_IDS),
      paymentBasis: fc.constantFrom('nominal', 'exact'),
    })
    .map(({ method, paymentBasis }): Accrual => ({ mode: 'daycount', method, paymentBasis })),
);

/** A percentage with up to two decimals, 0 … `max`. */
const pctArb = (max: number): fc.Arbitrary<{ text: string; value: ReturnType<typeof rational> }> =>
  fc.integer({ min: 0, max: max * 100 }).map((hundredths) => ({
    text: formatScaled(BigInt(hundredths), 2),
    value: rational(BigInt(hundredths), 100n),
  }));

const feeArb = (index: number, scale: bigint): fc.Arbitrary<Fee> =>
  fc
    .record({
      kind: fc.constantFrom('upfront', 'periodic', 'insurance'),
      fixed: fc.boolean(),
      onBalance: fc.boolean(),
      amount: fc.bigInt({ min: 0n, max: 1000n * scale }),
      pct: pctArb(5),
      financing: fc.constantFrom('paid', 'financed'),
      inApr: fc.boolean(),
    })
    .map(({ kind, fixed, onBalance, amount, pct, financing, inApr }): Fee => ({
      id: `fee-${String(index)}`,
      kind,
      value: fixed
        ? { calc: 'fixed', amount }
        : {
            calc: kind === 'upfront' ? 'percent' : onBalance ? 'pct-balance' : 'pct-original',
            pct: pct.value,
          },
      financing: kind === 'upfront' ? financing : 'paid',
      inApr,
    }));

const termsArb: fc.Arbitrary<LoanTerms> = fc
  .record({
    unit: fc.constantFrom(...CURRENCIES),
    basisPoints: fc.integer({ min: -500, max: 6000 }),
    repayment: fc.constantFrom(...REPAYMENTS),
    frequency: fc.constantFrom(...FREQUENCY_IDS),
    payments: fc.oneof(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 600 })),
    disbursementDate: dateArb,
    endOfMonth: fc.boolean(),
    accrual: accrualArb,
    interest: fc.constantFrom(...MODES),
    fees: fc.constantFrom(...MODES),
    payment: fc.constantFrom(...POLICIES),
    principalRemainder: fc.constantFrom('last', 'first'),
    feeCount: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer(),
    balloonKind: fc.constantFrom('amount', 'percent'),
    balloonShare: fc.integer({ min: 1, max: 99 }),
  })
  .chain((base) => {
    const scale = 10n ** BigInt(base.unit.minorUnits);
    return fc
      .record({
        amount: fc.oneof(
          fc.bigInt({ min: 1n, max: 1000n * scale }),
          fc.bigInt({ min: 1n, max: 10n ** 12n * scale }),
        ),
        fees: fc.tuple(
          ...Array.from({ length: base.feeCount }, (_, index) => feeArb(index, scale)),
        ),
      })
      .map(({ amount, fees }): LoanTerms => {
        const balloon: BalloonSpec | null =
          base.repayment !== 'balloon'
            ? null
            : base.balloonKind === 'amount'
              ? { kind: 'amount', amount: (amount * BigInt(base.balloonShare)) / 100n }
              : { kind: 'percent', pct: rational(BigInt(base.balloonShare)) };
        return {
          currency: base.unit.currency,
          minorUnits: base.unit.minorUnits,
          amount,
          annualRatePct: formatScaled(BigInt(base.basisPoints), 2),
          rate: rational(BigInt(base.basisPoints), 10_000n),
          repayment: base.repayment,
          balloon,
          frequency: base.frequency,
          payments: base.payments,
          disbursementDate: base.disbursementDate,
          endOfMonth: base.endOfMonth,
          accrual: base.accrual,
          rounding: {
            interest: base.interest,
            fees: base.fees,
            payment: base.payment,
            principalRemainder: base.principalRemainder,
          },
          fees,
          rateMethods: [],
        };
      });
  });

/**
 * The phase-2 error the SPEC defines for these terms (§5.3, §5.5, §13), checked in the
 * order buildSchedule reports them, or `null` when there is none.
 */
function phaseTwoError(terms: LoanTerms): string | null {
  const principal = principalFinanced(
    terms.amount,
    upfrontTotals(terms.fees, terms.amount, terms.rounding.fees),
  );
  if (terms.repayment === 'balloon') {
    if (terms.accrual.mode === 'daycount' && terms.accrual.paymentBasis === 'exact') {
      return 'UNSUPPORTED';
    }
    const residual = terms.balloon === null ? 0n : balloonResidual(terms.balloon, principal);
    return residual > 0n && residual < principal ? null : 'BALLOON_RANGE';
  }
  if (
    terms.repayment === 'equal-principal' &&
    terms.rounding.principalRemainder === 'first' &&
    remainderFirstPrincipal(principal, terms.payments) < 0n
  ) {
    return 'AMOUNT_TOO_SMALL_FOR_TERM';
  }
  return null;
}

/** Checks a schedule error against the conditions of SPEC §5.1 and §13. */
function expectDefinedError(terms: LoanTerms, error: EngineError): void {
  const expected = phaseTwoError(terms);
  if (expected !== null) {
    expect(error.code).toBe(expected);
    return;
  }
  // Phase 3: only an annuity or balloon instalment can fall short of the interest, in a
  // period before the last; an annuity never does without a positive rate (I_k ≤ 0 ≤ A).
  // The exact payment basis is exempt (SPEC v0.2.2 §5.1).
  expect(error).toMatchObject({ code: 'NEG_AMORTIZATION', field: null });
  expect(['annuity', 'balloon']).toContain(terms.repayment);
  expect(terms.accrual.mode === 'daycount' && terms.accrual.paymentBasis === 'exact').toBe(false);
  const period = Number(error.params?.period);
  expect(period).toBeGreaterThanOrEqual(1);
  expect(period).toBeLessThan(terms.payments);
  if (terms.repayment === 'annuity') {
    expect(terms.rate.n > 0n).toBe(true);
  }
}

/** Decimals with room for an exact sum of day-count fractions. */
const Precise = Decimal.clone({ precision: 100 });

/**
 * SPEC v0.2.4 §9.6: `yf1Parts` is well formed ("30/360", "61/365+121/366") and `yf1` is its
 * exact sum serialized: the exact decimal when it terminates, otherwise rounded half-up to
 * the 20 significant digits the engine writes.
 */
function expectYf1FromParts(yf1: string | undefined, parts: string | undefined): void {
  expect(parts).toMatch(/^\d+\/(360|365|366)(\+\d+\/(360|365|366))*$/);
  // The exact sum as a reduced integer fraction n/d.
  let n = 0n;
  let d = 1n;
  for (const part of (parts ?? '').split('+')) {
    const [days = '0', base = '1'] = part.split('/');
    n = n * BigInt(base) + BigInt(days) * d;
    d *= BigInt(base);
  }
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const g = gcd(n, d);
  n /= g;
  d /= g;
  // A reduced fraction terminates when its denominator has no prime factors but 2 and 5.
  let rest = d;
  for (const factor of [2n, 5n]) {
    while (rest % factor === 0n) {
      rest /= factor;
    }
  }
  // 100 digits: exact for a terminating sum, and enough to round the others correctly.
  const exact = new Precise(n.toString()).div(d.toString());
  const expected = rest === 1n ? exact : exact.toSignificantDigits(20, Decimal.ROUND_HALF_UP);
  expect(new Precise(yf1 ?? 'NaN').eq(expected)).toBe(true);
}

describe('buildSchedule properties', () => {
  it('holds the ledger invariants on every schedule it builds', () => {
    fc.assert(
      fc.property(termsArb, (terms) => {
        const result = buildSchedule(terms);
        if (!result.ok) {
          expectDefinedError(terms, result.error);
          return;
        }
        expect(phaseTwoError(terms)).toBeNull();
        const { schedule } = result;
        const rows = ledgerRows(terms, schedule);
        const summary = loanSummary(terms, schedule);
        expect(checkInvariants({ rows, summary }, terms)).toEqual([]);

        // Σ principal = principal financed; the early close shortens the schedule only.
        const repaid = schedule.rows.reduce((total, row) => total + row.principal, 0n);
        expect(repaid).toBe(schedule.principalFinanced);
        expect(schedule.rows.length).toBeLessThanOrEqual(terms.payments);
        expect(schedule.earlyClose).toBe(schedule.rows.length < terms.payments);

        // Dates strictly increase from D0, and `days` counts the gaps.
        let previous = terms.disbursementDate;
        for (const row of schedule.rows) {
          expect(compareDates(previous, row.date)).toBe(-1);
          expect(row.days).toBe(daysBetween(previous, row.date));
          previous = row.date;
        }

        // Principal by repayment type (SPEC §5.2–§5.5) on every period but the last, which
        // repays the balance.
        const regular = schedule.rows.slice(0, -1);
        const last = schedule.rows[schedule.rows.length - 1];
        expect(last?.principal).toBe(last?.opening);
        switch (terms.repayment) {
          case 'annuity':
          case 'balloon': {
            // Every period but the last pays exactly A of interest + principal. No principal
            // is negative (that would be NEG_AMORTIZATION), except with the exact payment
            // basis, which adds a long period's shortfall to the balance (SPEC §5.1).
            const instalment = schedule.regularInstalment;
            expect(instalment).not.toBeNull();
            for (const row of regular) {
              expect(row.interest + row.principal).toBe(instalment);
            }
            const exactBasis =
              terms.accrual.mode === 'daycount' && terms.accrual.paymentBasis === 'exact';
            if (!exactBasis) {
              expect(schedule.rows.every((row) => row.principal >= 0n)).toBe(true);
            }
            expect(schedule.principalPerPeriod).toBeNull();
            if (terms.repayment === 'balloon' && last !== undefined && instalment !== null) {
              expect(schedule.balloon).toBe(
                schedule.earlyClose ? 0n : last.principal - (instalment - last.interest),
              );
            } else {
              expect(schedule.balloon).toBeNull();
            }
            break;
          }
          case 'equal-principal': {
            const q = schedule.principalPerPeriod ?? -1n;
            expect(q).toBe(equalPrincipalAmount(schedule.principalFinanced, terms.payments));
            const first =
              terms.rounding.principalRemainder === 'first'
                ? remainderFirstPrincipal(schedule.principalFinanced, terms.payments)
                : q;
            regular.forEach((row, position) => {
              expect(row.principal).toBe(position === 0 ? first : q);
            });
            expect(schedule.regularInstalment).toBeNull();
            expect(schedule.balloon).toBeNull();
            break;
          }
          case 'bullet':
            expect(regular.every((row) => row.principal === 0n)).toBe(true);
            expect(last?.principal).toBe(schedule.principalFinanced);
            expect(schedule.earlyClose).toBe(false);
            expect(schedule.regularInstalment).toBeNull();
            expect(schedule.principalPerPeriod).toBeNull();
            expect(schedule.balloon).toBeNull();
            break;
        }

        // Every explanation carries exactly its own values (SPEC §9.6): the first row as
        // posted for equal principal and bullet, and the rate values of the accrual mode.
        const { formulaId, values } = schedule.explain;
        const daycount = terms.accrual.mode === 'daycount';
        const periodicRate =
          !daycount && terms.accrual.compounding !== terms.frequency ? ['j', 'm', 'i'] : ['j', 'm'];
        const expectedKeys: Record<string, readonly string[]> = {
          'instalment.annuity': ['P', 'N', ...periodicRate, 'Astar', 'A'],
          'instalment.balloon': ['P', 'N', ...periodicRate, 'Astar', 'A', 'Bal'],
          'instalment.annuity-exact-basis': ['P', 'N', 'j', 'dayCount', 'Astar', 'A'],
          'instalment.equal-principal': [
            'P',
            'N',
            'q',
            'p1',
            'I1',
            'first',
            ...(daycount ? ['j', 'dayCount', 'yf1', 'yf1Parts'] : periodicRate),
          ],
          'instalment.bullet': [
            'P',
            'N',
            'I1',
            'first',
            ...(daycount ? ['j', 'dayCount', 'yf1', 'yf1Parts'] : periodicRate),
          ],
        };
        expect(Object.keys(values).sort()).toEqual([...(expectedKeys[formulaId] ?? [])].sort());
        if (terms.repayment === 'equal-principal' || terms.repayment === 'bullet') {
          const firstRow = schedule.rows[0];
          if (firstRow === undefined) {
            throw new Error('expected a first row');
          }
          const money = (value: bigint): string => formatScaled(value, terms.minorUnits);
          expect(values.I1).toBe(money(firstRow.interest));
          expect(values.first).toBe(money(firstRow.principal + firstRow.interest));
          if (terms.repayment === 'equal-principal') {
            expect(values.p1).toBe(money(firstRow.principal));
          }
          if (daycount) {
            expectYf1FromParts(values.yf1, values.yf1Parts);
          }
        }

        // Fixed and pct-original items are the same every period; pct-balance follows the
        // opening balance (SPEC §6.2).
        terms.fees.forEach((fee, index) => {
          if (fee.kind === 'upfront') {
            return;
          }
          for (const row of schedule.rows) {
            const base = fee.value.calc === 'pct-balance' ? row.opening : terms.amount;
            expect(row.itemAmounts[index]).toBe(
              fee.value.calc === 'fixed'
                ? fee.value.amount
                : divRound(base * fee.value.pct.n, fee.value.pct.d * 100n, terms.rounding.fees),
            );
          }
        });

        // Upfront items never appear in a period; the columns sum their items.
        const column = (row: ScheduleRow, kind: Fee['kind']): bigint =>
          terms.fees.reduce(
            (total, fee, index) =>
              fee.kind === kind ? total + (row.itemAmounts[index] ?? 0n) : total,
            0n,
          );
        for (const row of schedule.rows) {
          expect(row.itemAmounts).toHaveLength(terms.fees.length);
          expect(column(row, 'upfront')).toBe(0n);
          expect(row.fees).toBe(column(row, 'periodic'));
          expect(row.insurance).toBe(column(row, 'insurance'));
          expect(row.payment).toBe(row.interest + row.principal + row.fees + row.insurance);
        }

        const flows = loanCashFlows(terms, schedule);
        expect(flows.map((flow) => flow.period)).toEqual([
          0,
          ...schedule.rows.map((row) => row.index),
        ]);

        // Same input → same output.
        expect(buildSchedule(terms)).toEqual(result);
      }),
      { numRuns: 250 },
    );
    // Long exact schedules (600 periods, 50-digit decimals) take a few seconds in all.
  }, 60_000);
});
