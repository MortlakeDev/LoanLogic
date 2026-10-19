// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { minorUnits } from './currency';
import { type LocalDate, daysBetween, formatIsoDate, parseIsoDate } from './date';
import { yearFraction } from './daycount';
import { EngineDecimal, type EngineDecimalValue, fromRational } from './decimal';
import {
  amountFinancedForRates,
  periodicFeeAmount,
  principalFinanced,
  upfrontTotals,
} from './fees';
import {
  FREQUENCY_IDS,
  isEndOfMonthSchedule,
  periodsPerYear,
  scheduleDate,
  scheduleDates,
} from './frequency';
import { formatMinor, toMinorUnits } from './money';
import {
  type Rational,
  ONE,
  ZERO,
  add,
  div,
  fromInteger,
  parseDecimal,
  pow,
  rational,
} from './rational';
import { compoundingPerYear, dayCountInterest, periodicInterest, periodicRate } from './rates';
import { type Real, approx, exact } from './rounding';
import { type TermSpec, resolvePayments } from './term';
import type { CompoundingId, Fee, LoanInput, RoundingMode } from './types';

const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];
const COMPOUNDINGS: readonly CompoundingId[] = [...FREQUENCY_IDS, 'continuous'];

/** `j` from a percent string: "6.5" → 0.065. */
function j(pct: string): Rational {
  return div(parseDecimal(pct), fromInteger(100));
}

/** Minor units of an amount at two decimals. */
function cents(text: string): bigint {
  const value = toMinorUnits(text, 2);
  if (value === undefined) {
    throw new Error(`Bad test amount ${text}`);
  }
  return value;
}

function exactValue(real: Real): Rational {
  if (real.kind !== 'exact') {
    throw new Error('Expected an exact rate');
  }
  return real.value;
}

function decimalValue(real: Real): EngineDecimalValue {
  if (real.kind !== 'decimal') {
    throw new Error('Expected an irrational (decimal) rate');
  }
  return real.value;
}

/** Whether `actual` matches `expected` to at least `digits` significant digits. */
function agrees(actual: EngineDecimalValue, expected: string, digits: number): boolean {
  const reference = new EngineDecimal(expected);
  return actual
    .minus(reference)
    .abs()
    .lte(reference.abs().times(new EngineDecimal(10).pow(-digits)));
}

describe('compoundingPerYear', () => {
  it('gives c for every frequency and null for continuous compounding', () => {
    expect(FREQUENCY_IDS.map(compoundingPerYear)).toEqual([52, 26, 12, 4, 2, 1]);
    expect(compoundingPerYear('continuous')).toBeNull();
  });
});

describe('periodicRate (SPEC §3.2, §1.6)', () => {
  it('is exactly zero for j = 0 with every frequency and compounding', () => {
    for (const frequency of FREQUENCY_IDS) {
      for (const compounding of COMPOUNDINGS) {
        expect(periodicRate(ZERO, frequency, compounding)).toEqual(exact(ZERO));
        expect(periodicRate(j('0.000'), frequency, compounding)).toEqual(exact(ZERO));
      }
    }
  });

  it('is j / m exactly when c = m, never a rounded j/m', () => {
    expect(periodicRate(j('6.5'), 'monthly', 'monthly')).toEqual(exact(rational(13n, 2400n)));
    for (const frequency of FREQUENCY_IDS) {
      for (const pct of ['6.5', '-0.5', '1000', '0.01']) {
        expect(periodicRate(j(pct), frequency, frequency)).toEqual(
          exact(div(j(pct), fromInteger(periodsPerYear(frequency)))),
        );
      }
    }
  });

  it('is exact when c/m is a positive integer', () => {
    // Quarterly payments, monthly compounding, 6.6 %: 1.0055^3 − 1 = 0.016590916375.
    expect(periodicRate(j('6.6'), 'quarterly', 'monthly')).toEqual(
      exact(parseDecimal('0.016590916375')),
    );
    // Bi-weekly payments, weekly compounding: (1 + j/52)^2 − 1.
    expect(exactValue(periodicRate(j('5.2'), 'biweekly', 'weekly'))).toEqual(
      parseDecimal('0.002001'),
    );
    // Annual payments, weekly compounding: c/m = 52.
    const annual = exactValue(periodicRate(j('10'), 'annual', 'weekly'));
    expect(annual).toEqual(add(pow(add(ONE, rational(1n, 520n)), 52), rational(-1n)));
    // Negative rate, semiannual payments, monthly compounding.
    expect(exactValue(periodicRate(j('-6'), 'semiannual', 'monthly'))).toEqual(
      add(pow(rational(199n, 200n), 6), rational(-1n)),
    );
  });

  it('carries at least 40 significant digits when irrational (Canadian c = 2, m = 12)', () => {
    // (1 + 0.0529/2)^(1/6) − 1, reference computed independently at 90 digits.
    const canada = decimalValue(periodicRate(j('5.29'), 'monthly', 'semiannual'));
    expect(
      agrees(canada, '4.360520704037069087054616777223371920062251047669851848010994e-3', 45),
    ).toBe(true);
  });

  it.each([
    // [pct, frequency, compounding, reference (90-digit computation)]
    [
      '6',
      'monthly',
      'quarterly',
      '4.975206272652512013625378373825942159547178805062206118050176e-3',
    ],
    [
      '-5',
      'monthly',
      'semiannual',
      '-4.210744514489469859548920382221448832414856632343274834764206e-3',
    ],
    [
      '10',
      'monthly',
      'weekly',
      '8.360082710614787898439294906203620950851487622085541937511354e-3',
    ],
    ['6', 'weekly', 'monthly', '1.151633739384250220662049007126459067225802444916406568239865e-3'],
    [
      '8',
      'quarterly',
      'semiannual',
      '1.980390271855696600564482180455639791275418921991928151699416e-2',
    ],
    [
      '-20',
      'monthly',
      'annual',
      '-1.842347012624832637366863402459521692683021198764355513958382e-2',
    ],
  ] as const)(
    'computes %s %% paid %s, compounded %s, to 40 digits',
    (pct, frequency, compounding, reference) => {
      const rate = decimalValue(periodicRate(j(pct), frequency, compounding));
      expect(agrees(rate, reference, 40)).toBe(true);
    },
  );

  it.each([
    ['8', 'monthly', '6.688938354019326438430140704922290376740419940297605103983513e-3'],
    ['-3', 'weekly', '-5.767566888039872298895832088481170466175671626623029235631874e-4'],
    ['1000', 'weekly', '2.120433960254956989669982179926255601979437052823441490135404e-1'],
  ] as const)(
    'computes continuous compounding e^(j/m) − 1 for %s %% %s',
    (pct, frequency, reference) => {
      const rate = decimalValue(periodicRate(j(pct), frequency, 'continuous'));
      expect(agrees(rate, reference, 40)).toBe(true);
    },
  );

  it('keeps 40 digits and the sign of interest for a tiny irrational rate (0.0001 %)', () => {
    const canada = periodicRate(j('0.0001'), 'monthly', 'semiannual');
    expect(
      agrees(
        decimalValue(canada),
        '8.333331597222752700429406257719369354515958371044468260616253e-8',
        40,
      ),
    ).toBe(true);
    // 1.00 × i = 0.0000083… minor units: only ceil reaches a whole minor unit.
    expect(MODES.map((mode) => periodicInterest(100n, canada, mode))).toEqual([0n, 0n, 1n, 0n]);
    const continuous = periodicRate(j('-0.0001'), 'weekly', 'continuous');
    expect(
      agrees(
        decimalValue(continuous),
        '-1.923076904585798935100894590197299205215505611453299187816340e-8',
        40,
      ),
    ).toBe(true);
    expect(MODES.map((mode) => periodicInterest(100n, continuous, mode))).toEqual([
      0n,
      0n,
      0n,
      -1n,
    ]);
  });

  it('preserves the effective annual rate (1 + i)^m = (1 + j/c)^c', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 100000 }).filter((value) => value !== 0),
        fc.constantFrom(...FREQUENCY_IDS),
        fc.constantFrom(...FREQUENCY_IDS),
        (hundredths, frequency, compounding) => {
          const rate = rational(BigInt(hundredths), 10000n); // −20 % … 1 000 %
          const m = periodsPerYear(frequency);
          const c = periodsPerYear(compounding);
          const target = pow(add(ONE, div(rate, fromInteger(c))), c);
          const i = periodicRate(rate, frequency, compounding);
          if (i.kind === 'exact') {
            expect(c % m).toBe(0);
            expect(pow(add(ONE, i.value), m)).toEqual(target);
          } else {
            expect(c % m).not.toBe(0);
            const annual = i.value.plus(1).pow(m);
            const expected = fromRational(target);
            expect(annual.minus(expected).abs().lte(expected.times('1e-44'))).toBe(true);
          }
        },
      ),
    );
  });

  it('matches e^j a year with continuous compounding', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 100000 }).filter((value) => value !== 0),
        fc.constantFrom(...FREQUENCY_IDS),
        (hundredths, frequency) => {
          const rate = rational(BigInt(hundredths), 10000n);
          const i = decimalValue(periodicRate(rate, frequency, 'continuous'));
          const annual = i.plus(1).pow(periodsPerYear(frequency));
          const expected = fromRational(rate).exp();
          expect(annual.minus(expected).abs().lte(expected.times('1e-44'))).toBe(true);
        },
      ),
    );
  });
});

describe('periodicInterest (SPEC §3.2, §5.1)', () => {
  it('rounds the E5 tie 2 700.00 × 6.5 % ÷ 12 = 14.625 exactly per mode', () => {
    const i = periodicRate(j('6.5'), 'monthly', 'monthly');
    expect(MODES.map((mode) => periodicInterest(cents('2700.00'), i, mode))).toEqual([
      1463n,
      1462n,
      1463n,
      1462n,
    ]);
    // The same tie with a negative rate.
    const negative = periodicRate(j('-6.5'), 'monthly', 'monthly');
    expect(MODES.map((mode) => periodicInterest(cents('2700.00'), negative, mode))).toEqual([
      -1463n,
      -1462n,
      -1462n,
      -1463n,
    ]);
  });

  it('reproduces first-row interest of exact golden vectors', () => {
    const monthly = (pct: string): Real => periodicRate(j(pct), 'monthly', 'monthly');
    // e1: 100 000.00 at 6.5 % → 541.67.
    expect(periodicInterest(cents('100000.00'), monthly('6.5'), 'half-up')).toBe(54167n);
    // max-amount: 1e15 at 5 % → 4 166 666 666 666.67.
    expect(periodicInterest(cents('1000000000000000.00'), monthly('5'), 'half-up')).toBe(
      416666666666667n,
    );
    // kwd-three-decimals: 50 000.000 KWD at 5.5 % → 229.167.
    expect(periodicInterest(50000000n, monthly('5.5'), 'half-up')).toBe(229167n);
    // clf-four-decimals-mortgage: 3 000.0000 CLF at 4.5 % → 11.2500.
    expect(periodicInterest(30000000n, monthly('4.5'), 'half-up')).toBe(112500n);
    // jpy-mortgage-35y: 35 000 000 JPY at 1.85 % → 53 958.
    expect(periodicInterest(35000000n, monthly('1.85'), 'half-up')).toBe(53958n);
    // negative-rate-annuity: 100 000.00 at −0.5 % → −41.67.
    expect(periodicInterest(cents('100000.00'), monthly('-0.5'), 'half-up')).toBe(-4167n);
    // rounding-interest-ceil / -floor: 18 750.00 at 9.75 % = 152.34375.
    expect(periodicInterest(cents('18750.00'), monthly('9.75'), 'ceil')).toBe(15235n);
    expect(periodicInterest(cents('18750.00'), monthly('9.75'), 'floor')).toBe(15234n);
    // high-rate-short-weekly: 500.00 at 390 % weekly → 37.50.
    expect(
      periodicInterest(cents('500.00'), periodicRate(j('390'), 'weekly', 'weekly'), 'half-up'),
    ).toBe(3750n);
    // quarterly-payments-monthly-compounding: 180 000.00 at 6.6 % → 2 986.36.
    expect(
      periodicInterest(
        cents('180000.00'),
        periodicRate(j('6.6'), 'quarterly', 'monthly'),
        'half-up',
      ),
    ).toBe(298636n);
    // zero-rate-semiannual-compounding with ceil: still 0.00.
    expect(
      periodicInterest(cents('12000.00'), periodicRate(ZERO, 'monthly', 'semiannual'), 'ceil'),
    ).toBe(0n);
  });

  it('reproduces first-row interest of irrational golden vectors', () => {
    // canada-semiannual-compounding: 500 000.00 at 5.29 % → 2 180.26 (2 180.2603…).
    const canada = periodicRate(j('5.29'), 'monthly', 'semiannual');
    expect(MODES.map((mode) => periodicInterest(cents('500000.00'), canada, mode))).toEqual([
      218026n,
      218026n,
      218027n,
      218026n,
    ]);
    // continuous-compounding: 10 000.00 at 8 % → 66.89 (66.8893…).
    const continuous = periodicRate(j('8'), 'monthly', 'continuous');
    expect(MODES.map((mode) => periodicInterest(cents('10000.00'), continuous, mode))).toEqual([
      6689n,
      6689n,
      6689n,
      6688n,
    ]);
  });

  it('rounds decimal-path ties per mode', () => {
    const half = approx(new EngineDecimal('0.5'));
    expect(MODES.map((mode) => periodicInterest(5n, half, mode))).toEqual([3n, 2n, 3n, 2n]);
    expect(MODES.map((mode) => periodicInterest(3n, half, mode))).toEqual([2n, 2n, 2n, 1n]);
    const negativeHalf = approx(new EngineDecimal('-0.5'));
    expect(MODES.map((mode) => periodicInterest(5n, negativeHalf, mode))).toEqual([
      -3n,
      -2n,
      -2n,
      -3n,
    ]);
  });

  it('gives zero interest on a zero balance', () => {
    expect(periodicInterest(0n, periodicRate(j('6.5'), 'monthly', 'monthly'), 'ceil')).toBe(0n);
    expect(periodicInterest(0n, periodicRate(j('5.29'), 'monthly', 'semiannual'), 'ceil')).toBe(0n);
  });
});

describe('dayCountInterest (SPEC §3.3)', () => {
  it('forms B × j × YF exactly before rounding', () => {
    // 18 250 minor units × 1 % × 1/365 = 0.5 exactly.
    const yf = rational(1n, 365n);
    expect(MODES.map((mode) => dayCountInterest(18250n, j('1'), yf, mode))).toEqual([
      1n,
      0n,
      1n,
      0n,
    ]);
    expect(MODES.map((mode) => dayCountInterest(18250n, j('-1'), yf, mode))).toEqual([
      -1n,
      0n,
      0n,
      -1n,
    ]);
    expect(dayCountInterest(54750n, j('1'), yf, 'half-even')).toBe(2n); // 1.5 → 2
  });

  it('reproduces daycount-act365f row 1: 200 000.00 × 5.49 % × 31/365 = 932.55', () => {
    expect(dayCountInterest(cents('200000.00'), j('5.49'), rational(31n, 365n), 'half-up')).toBe(
      93255n,
    );
  });

  it('is zero for a zero rate or a zero year fraction', () => {
    expect(dayCountInterest(cents('1000.00'), ZERO, rational(31n, 360n), 'ceil')).toBe(0n);
    expect(dayCountInterest(cents('1000.00'), j('5'), ZERO, 'ceil')).toBe(0n);
  });
});

interface LoanVector {
  readonly id: string;
  readonly kind: 'loan' | 'cashflows';
  readonly input: LoanInput;
  readonly expected: {
    readonly ok: boolean;
    readonly warnings?: readonly { readonly code: string }[];
    readonly summary?: Readonly<Record<string, string | number | null>>;
    readonly rows?: readonly Readonly<Record<string, string | number>>[];
  };
}

const VECTOR_FILES = import.meta.glob<LoanVector>('../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Test input: ${what}`);
  }
  return value;
}

/**
 * Every row of every valid loan vector, recomputed with the foundation functions alone
 * (no schedule builder): N and the schedule dates (SPEC §2.3–§2.4), days, the interest
 * `R_int(B_{k−1} × i)` or `R_int(B_{k−1} × j × YF)` from the vector's own opening balance
 * (§3, §4), the periodic fee and insurance columns (§6.2–§6.3) and the upfront totals of
 * the summary (§6.1, §9.1).
 */
describe('golden vectors: every row from the foundation functions', () => {
  const vectors = Object.values(VECTOR_FILES).filter(
    (vector) => vector.kind === 'loan' && vector.expected.ok,
  );

  it('finds the valid loan vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(60);
  });

  it.each(vectors.map((vector) => [vector.id, vector] as const))('%s', (_id, vector) => {
    const { input } = vector;
    const rows = vector.expected.rows ?? [];
    const summary = vector.expected.summary ?? {};
    const mu = defined(minorUnits(input.currency), 'currency');
    const minor = (text: string | number | null | undefined): bigint =>
      defined(toMinorUnits(String(text), mu), `amount ${String(text)}`);
    const anchor = defined(parseIsoDate(input.disbursementDate), 'disbursementDate');
    const endOfMonth = input.endOfMonth ?? true;
    const { term } = input;
    const spec: TermSpec =
      'payments' in term
        ? { kind: 'payments', payments: term.payments }
        : 'years' in term
          ? { kind: 'years', years: term.years, months: term.months ?? 0 }
          : { kind: 'endDate', endDate: defined(parseIsoDate(term.endDate), 'endDate') };
    const resolved = resolvePayments(spec, anchor, input.frequency, endOfMonth);
    if (!resolved.ok) {
      throw new Error(`Unexpected ${resolved.code}`);
    }
    const planned = scheduleDates(anchor, resolved.payments, input.frequency, endOfMonth);
    const earlyClose = (vector.expected.warnings ?? []).some((w) => w.code === 'EARLY_CLOSE');
    if (earlyClose) {
      expect(rows.length).toBeLessThan(resolved.payments);
    } else {
      expect(rows).toHaveLength(resolved.payments);
    }
    expect(summary.paymentsCount).toBe(rows.length);

    const amount = minor(input.amount);
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
    const feeMode = input.rounding?.fees ?? 'half-up';
    const totals = upfrontTotals(fees, amount, feeMode);
    expect(formatMinor(totals.paid, mu)).toBe(summary.upfrontFeesPaid);
    expect(formatMinor(totals.financed, mu)).toBe(summary.upfrontFeesFinanced);
    expect(formatMinor(principalFinanced(amount, totals), mu)).toBe(summary.principalFinanced);
    expect(formatMinor(amountFinancedForRates(amount, totals), mu)).toBe(
      summary.amountFinancedForRates,
    );

    const rate = div(parseDecimal(input.annualRatePct), fromInteger(100));
    const interestMode = input.rounding?.interest ?? 'half-up';
    const { accrual } = input;
    const eomSchedule = isEndOfMonthSchedule(anchor, planned, input.frequency);
    // Periodic accrual: one rate i for every period; day-count accrual: j × YF per period.
    const interestOf: (opening: bigint, from: LocalDate, to: LocalDate) => bigint =
      accrual === undefined || accrual.mode === 'periodic'
        ? (() => {
            const i = periodicRate(rate, input.frequency, accrual?.compounding ?? input.frequency);
            return (opening) => periodicInterest(opening, i, interestMode);
          })()
        : (opening, from, to) =>
            dayCountInterest(
              opening,
              rate,
              yearFraction(accrual.method, from, to, eomSchedule),
              interestMode,
            );
    rows.forEach((row, index) => {
      const date = defined(planned[index], 'date');
      const previous = scheduleDate(anchor, index, input.frequency, endOfMonth);
      expect(row.date).toBe(formatIsoDate(date));
      expect(row.days).toBe(daysBetween(previous, date));
      const opening = minor(row.opening);
      const interest = interestOf(opening, previous, date);
      expect(formatMinor(interest, mu)).toBe(row.interestAccrued);
      const column = (kind: Fee['kind']): bigint =>
        fees
          .filter((fee) => fee.kind === kind)
          .reduce((sum, fee) => sum + periodicFeeAmount(fee, amount, opening, feeMode), 0n);
      expect(formatMinor(column('periodic'), mu)).toBe(row.fees);
      expect(formatMinor(column('insurance'), mu)).toBe(row.insurance);
    });
  });
});
