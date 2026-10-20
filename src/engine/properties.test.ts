// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * Property tests through the public API (T02 brief): random valid loan inputs — amount
 * 1 … 1e12, rate −5 … 60 %, N 1 … 600, every repayment type, frequency, accrual mode,
 * rounding option and fee type — either compute a schedule whose ledger invariants
 * I1–I9 (SPEC §8.3) hold exactly, or fail with one of the schedule-dependent errors the
 * SPEC defines for such inputs. Same input → same output.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type DayCountId,
  type FeeInput,
  type FrequencyId,
  type LoanInput,
  type PaymentRounding,
  type RepaymentType,
  type RoundingMode,
  calculateLoan,
  checkInvariants,
  minorUnits,
} from './index';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'KWD', 'CLF', 'GBP'] as const;
const FREQUENCIES: readonly FrequencyId[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
];
const METHODS: readonly DayCountId[] = [
  '30u-360',
  '30-360-isda',
  '30e-360',
  'act-360',
  'act-365f',
  'act-act-isda',
];
const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];
const POLICIES: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];
const REPAYMENTS: readonly RepaymentType[] = ['annuity', 'equal-principal', 'bullet', 'balloon'];

/** Errors a valid-looking input may still produce, depending on the schedule (SPEC §13). */
const SCHEDULE_ERRORS = new Set([
  'NEG_AMORTIZATION',
  'BALLOON_RANGE',
  'AMOUNT_TOO_SMALL_FOR_TERM',
  'FEE_RANGE',
]);

/** A decimal string for `units / 10^digits`, as SPEC §15 spells it. */
function decimal(units: bigint, digits: number): string {
  const negative = units < 0n;
  const text = (negative ? -units : units).toString().padStart(digits + 1, '0');
  const whole = digits === 0 ? text : text.slice(0, text.length - digits);
  const fraction = digits === 0 ? '' : `.${text.slice(text.length - digits)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

const isoDate = fc
  .record({
    y: fc.integer({ min: 2000, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }) => {
    const last =
      [
        31,
        (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ][m - 1] ?? 31;
    return `${String(y)}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  });

function feeArbitrary(currency: string, index: number): fc.Arbitrary<FeeInput> {
  const digits = minorUnits(currency) ?? 2;
  const fixed = fc
    .bigInt({ min: 0n, max: 500n * 10n ** BigInt(digits) })
    .map((units) => decimal(units, digits));
  const percent = fc
    .integer({ min: 0, max: 3000 })
    .map((thousandths) => decimal(BigInt(thousandths), 3));
  const id = `fee-${String(index)}`;
  return fc.oneof(
    fc.record({
      id: fc.constant(id),
      kind: fc.constant('upfront' as const),
      calc: fc.constant('fixed' as const),
      value: fixed,
      financing: fc.constantFrom('paid' as const, 'financed' as const),
      inApr: fc.boolean(),
    }),
    fc.record({
      id: fc.constant(id),
      kind: fc.constant('upfront' as const),
      calc: fc.constant('percent' as const),
      value: percent,
      financing: fc.constantFrom('paid' as const, 'financed' as const),
      inApr: fc.boolean(),
    }),
    fc.record({
      id: fc.constant(id),
      kind: fc.constantFrom('periodic' as const, 'insurance' as const),
      calc: fc.constant('fixed' as const),
      value: fixed,
      inApr: fc.boolean(),
    }),
    fc.record({
      id: fc.constant(id),
      kind: fc.constantFrom('periodic' as const, 'insurance' as const),
      calc: fc.constantFrom('pct-original' as const, 'pct-balance' as const),
      value: fc.integer({ min: 0, max: 500 }).map((thousandths) => decimal(BigInt(thousandths), 3)),
      inApr: fc.boolean(),
    }),
  );
}

const loanInput: fc.Arbitrary<LoanInput> = fc
  .record({
    currency: fc.constantFrom(...CURRENCIES),
    majorAmount: fc.bigInt({ min: 1n, max: 10n ** 12n }),
    fraction: fc.bigInt({ min: 0n, max: 9999n }),
    rateThousandths: fc.integer({ min: -5000, max: 60000 }),
    repayment: fc.constantFrom(...REPAYMENTS),
    balloonPct: fc.integer({ min: 1, max: 95 }),
    balloonAsAmount: fc.boolean(),
    frequency: fc.constantFrom(...FREQUENCIES),
    payments: fc.integer({ min: 1, max: 600 }),
    disbursementDate: isoDate,
    endOfMonth: fc.boolean(),
    daycount: fc.boolean(),
    compounding: fc.constantFrom<FrequencyId | 'continuous' | undefined>(
      undefined,
      'continuous',
      ...FREQUENCIES,
    ),
    method: fc.constantFrom(...METHODS),
    exactBasis: fc.boolean(),
    interest: fc.constantFrom(...MODES),
    fees: fc.constantFrom(...MODES),
    payment: fc.constantFrom(...POLICIES),
    remainderFirst: fc.boolean(),
    feeCount: fc.integer({ min: 0, max: 3 }),
  })
  .chain((draw) => {
    const digits = minorUnits(draw.currency) ?? 2;
    const amountUnits =
      draw.majorAmount * 10n ** BigInt(digits) +
      (digits === 0 ? 0n : draw.fraction % 10n ** BigInt(digits));
    return fc
      .tuple(
        ...Array.from({ length: draw.feeCount }, (_, index) => feeArbitrary(draw.currency, index)),
      )
      .map((fees): LoanInput => {
        const balloonUnits = (amountUnits * BigInt(draw.balloonPct)) / 100n;
        return {
          currency: draw.currency,
          amount: decimal(amountUnits, digits),
          annualRatePct: decimal(BigInt(draw.rateThousandths), 3),
          repayment: draw.repayment,
          ...(draw.repayment === 'balloon'
            ? {
                balloon: draw.balloonAsAmount
                  ? { kind: 'amount' as const, value: decimal(balloonUnits, digits) }
                  : { kind: 'percent' as const, value: String(draw.balloonPct) },
              }
            : {}),
          frequency: draw.frequency,
          term: { payments: draw.payments },
          disbursementDate: draw.disbursementDate,
          endOfMonth: draw.endOfMonth,
          accrual: draw.daycount
            ? {
                mode: 'daycount',
                method: draw.method,
                paymentBasis: draw.exactBasis && draw.repayment !== 'balloon' ? 'exact' : 'nominal',
              }
            : {
                mode: 'periodic',
                ...(draw.compounding === undefined ? {} : { compounding: draw.compounding }),
              },
          rounding: {
            interest: draw.interest,
            fees: draw.fees,
            payment: draw.payment,
            principalRemainder: draw.remainderFirst ? 'first' : 'last',
          },
          fees,
          // A subset keeps the run fast; all metrics are covered by the vectors.
          rateMethods: ['nominal', 'irrNominal', 'xirr', 'usRegZApr'],
        };
      });
  });

describe('calculateLoan on random valid inputs', () => {
  it('produces a ledger whose invariants I1–I9 hold exactly, or a schedule error', () => {
    fc.assert(
      fc.property(loanInput, (input) => {
        const result = calculateLoan(input);
        if (!result.ok) {
          for (const error of result.errors) {
            expect(SCHEDULE_ERRORS.has(error.code), JSON.stringify(error)).toBe(true);
            // Each error belongs to one repayment type and one field (SPEC §5, §13).
            if (error.code === 'FEE_RANGE') {
              // Upfront fees paid at closing take the whole amount (SPEC §6.1).
              expect(error.field).toBe('fees');
            } else if (error.code === 'BALLOON_RANGE') {
              expect([input.repayment, error.field]).toEqual(['balloon', 'balloon.value']);
            } else if (error.code === 'AMOUNT_TOO_SMALL_FOR_TERM') {
              expect([input.repayment, input.rounding?.principalRemainder, error.field]).toEqual([
                'equal-principal',
                'first',
                'amount',
              ]);
            } else {
              // NEG_AMORTIZATION: annuity or balloon, never the exact payment basis (§5.1).
              expect(['annuity', 'balloon']).toContain(input.repayment);
              expect(error.field).toBeNull();
              expect(
                input.accrual?.mode === 'daycount' && input.accrual.paymentBasis === 'exact',
              ).toBe(false);
            }
          }
          return;
        }
        const digits = minorUnits(input.currency) ?? 2;
        expect(checkInvariants(result, { minorUnits: digits, repayment: input.repayment })).toEqual(
          [],
        );
        // Σ principal = principal financed, and payment dates strictly increase.
        // Engine money strings always carry exactly `digits` decimals.
        const toUnits = (text: string): bigint => BigInt(text.replace('.', ''));
        const principal = result.rows.reduce((total, row) => total + toUnits(row.principal), 0n);
        expect(principal).toBe(toUnits(result.summary.principalFinanced));
        for (let index = 1; index < result.rows.length; index += 1) {
          expect((result.rows[index]?.date ?? '') > (result.rows[index - 1]?.date ?? '')).toBe(
            true,
          );
        }
        expect(result.rows[0]?.date ?? '').toBe(result.summary.firstPaymentDate);
        expect(result.summary.paymentsCount).toBe(result.rows.length);
        // Annuity and balloon: principal + interest is the instalment on every row but the last.
        if (input.repayment === 'annuity' || input.repayment === 'balloon') {
          const instalment = toUnits(result.summary.regularInstalment ?? '0');
          result.rows.slice(0, -1).forEach((row) => {
            expect(toUnits(row.principal) + toUnits(row.interestPaid)).toBe(instalment);
          });
        }
      }),
      { numRuns: 150 },
    );
    // 150 random loans of up to 1 200 periods: several seconds under coverage while the
    // UI test files run in parallel, so the default 5 s limit is too tight.
  }, 30_000);

  it('is deterministic: the same input gives the same output', () => {
    fc.assert(
      fc.property(loanInput, (input) => {
        expect(JSON.stringify(calculateLoan(structuredClone(input)))).toBe(
          JSON.stringify(calculateLoan(input)),
        );
      }),
      { numRuns: 40 },
    );
  }, 30_000);
});
