// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineDecimal } from '../decimal';
import { type Rational, rational, toExplainString } from '../rational';
import { approx, exact, roundPayment } from '../rounding';
import type { PaymentRounding } from '../types';
import {
  exactBasisInstalment,
  levelInstalment,
  quotientToExplainString,
  roundInstalmentQuotient,
} from './annuity';

const POLICIES: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];

/** j / m as an exact fraction. */
function monthly(ratePct: string): Rational {
  const [whole = '0', fraction = ''] = ratePct.split('.');
  return rational(BigInt(whole + fraction), 100n * 12n * 10n ** BigInt(fraction.length));
}

describe('quotientToExplainString', () => {
  it('writes terminating values exactly, without trailing zeros', () => {
    expect(quotientToExplainString(12065n, 8n)).toBe('1508.125');
    expect(quotientToExplainString(10n, 4n)).toBe('2.5');
    expect(quotientToExplainString(100n, 1n)).toBe('100');
    expect(quotientToExplainString(100n, 4n)).toBe('25');
    expect(quotientToExplainString(-1n, 8n)).toBe('-0.125');
  });

  it('recognizes terminating values of fractions that are not in lowest terms', () => {
    expect(quotientToExplainString(3n * 1508125n, 3000n)).toBe('1508.125');
    expect(quotientToExplainString(21n, 7n)).toBe('3');
  });

  it('rounds other values half-up to 20 significant digits', () => {
    expect(quotientToExplainString(1n, 3n)).toBe('0.33333333333333333333');
    expect(quotientToExplainString(2n, 3n)).toBe('0.66666666666666666667');
    expect(quotientToExplainString(1n, 7000n)).toBe('0.00014285714285714285714');
    expect(quotientToExplainString(10n ** 30n, 3n)).toBe('333333333333333333333333333333');
  });

  it('normalizes the sign and zero', () => {
    expect(quotientToExplainString(-2n, 3n)).toBe('-0.66666666666666666667');
    expect(quotientToExplainString(2n, -3n)).toBe('-0.66666666666666666667');
    expect(quotientToExplainString(-2n, -3n)).toBe('0.66666666666666666667');
    expect(quotientToExplainString(0n, -5n)).toBe('0');
  });

  it('corrects the digit estimate next to powers of ten', () => {
    expect(quotientToExplainString(9999999n, 10001n)).toBe('999.89991000899910009');
    expect(quotientToExplainString(10000001n, 9999n)).toBe('1000.1001100110011001');
    expect(quotientToExplainString(1n, 1000003n)).toBe('0.000000999997000008999973');
  });

  it('agrees with the explanation strings of reduced rationals', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
        fc.bigInt({ min: 1n, max: 10n ** 30n }),
        fc.bigInt({ min: 1n, max: 1000n }),
        (num, den, common) => {
          expect(quotientToExplainString(num * common, den * common)).toBe(
            toExplainString(rational(num, den)),
          );
        },
      ),
    );
  });

  it('rejects a zero denominator', () => {
    expect(() => quotientToExplainString(1n, 0n)).toThrow(RangeError);
  });

  it('handles denominators with hundreds of factors 2 and 5', () => {
    // 1 / 5^600 = 2^600 / 10^600 terminates after 600 places.
    const tiny = quotientToExplainString(7n, 5n ** 600n);
    expect(tiny).toBe(toExplainString(rational(7n, 5n ** 600n)));
    expect(tiny).toHaveLength(602);
    expect(quotientToExplainString(5n ** 574n * 3n, 2n ** 678n * 5n ** 574n)).toBe(
      toExplainString(rational(3n, 2n ** 678n)),
    );
    expect(quotientToExplainString(1n, 3n * 5n ** 511n)).toBe(
      toExplainString(rational(1n, 3n * 5n ** 511n)),
    );
  });

  it('counts every power of 5 in the denominator', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 70 }),
        fc.integer({ min: 0, max: 70 }),
        fc.constantFrom(1n, 3n, 7n, 21n),
        fc.constantFrom(1n, 3n, 5n, 7n, 25n),
        (num, twos, fives, other, common) => {
          const den = 2n ** BigInt(twos) * 5n ** BigInt(fives) * other;
          expect(quotientToExplainString(num * common, den * common)).toBe(
            toExplainString(rational(num, den)),
          );
        },
      ),
    );
  });
});

describe('roundInstalmentQuotient', () => {
  it('applies each payment rounding policy (SPEC §1.5)', () => {
    // 150812.5 minor units = 1508.125 USD.
    expect(roundInstalmentQuotient(1508125n, 10n, 2, 'minor-half-up')).toBe(150813n);
    expect(roundInstalmentQuotient(1508121n, 10n, 2, 'minor-ceil')).toBe(150813n);
    expect(roundInstalmentQuotient(1508125n, 10n, 2, 'unit-half-up')).toBe(150800n);
    expect(roundInstalmentQuotient(1508125n, 10n, 2, 'unit-ceil')).toBe(150900n);
    expect(roundInstalmentQuotient(150850n, 1n, 2, 'unit-half-up')).toBe(150900n);
    expect(roundInstalmentQuotient(150800n, 1n, 2, 'unit-ceil')).toBe(150800n);
  });

  it('matches roundPayment on the value in major units', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(...POLICIES),
        (num, magnitude, negative, mu, policy) => {
          const den = negative ? -magnitude : magnitude;
          const expected = roundPayment(exact(rational(num, den * 10n ** BigInt(mu))), mu, policy);
          expect(roundInstalmentQuotient(num, den, mu, policy)).toBe(expected);
        },
      ),
    );
  });
});

describe('levelInstalment', () => {
  it('reproduces SPEC E1: 100 000.00 at 6.5 % over 24 months', () => {
    const result = levelInstalment(10_000_000n, exact(monthly('6.5')), 24, 2, 'minor-half-up');
    expect(result.amount).toBe(445_463n);
    expect(result.exact.startsWith('4454.6251433')).toBe(true);
    expect(result.exact.replace(/^-?0*|\./g, '')).toHaveLength(20);
  });

  it('is exact for N = 1 (SPEC E6: A* = 1 508.125 → 1 508.13)', () => {
    const result = levelInstalment(150_000n, exact(monthly('6.5')), 1, 2, 'minor-half-up');
    expect(result).toEqual({ amount: 150_813n, exact: '1508.125' });
  });

  it('divides evenly at a zero rate, exact or decimal', () => {
    expect(levelInstalment(1_000_000n, exact(rational(0n)), 12, 2, 'minor-half-up')).toEqual({
      amount: 83_333n,
      exact: '833.33333333333333333',
    });
    expect(
      levelInstalment(1_000_000n, approx(new EngineDecimal(0)), 12, 2, 'minor-half-up'),
    ).toEqual({
      amount: 83_333n,
      exact: '833.33333333333333333',
    });
  });

  it('handles a negative rate (vector negative-rate-annuity: 812.50)', () => {
    const result = levelInstalment(10_000_000n, exact(monthly('-0.5')), 120, 2, 'minor-half-up');
    expect(result.amount).toBe(81_250n);
  });

  it('leaves the residual of a balloon outstanding', () => {
    expect(
      levelInstalment(1_000_000n, exact(rational(0n)), 10, 2, 'minor-half-up', 300_000n),
    ).toEqual({
      amount: 70_000n,
      exact: '700',
    });
    // Vector balloon-percent-auto-loan: 30 000.00 at 6.99 % over 48 months, Bal 9 000.00.
    const balloon = levelInstalment(
      3_000_000n,
      exact(monthly('6.99')),
      48,
      2,
      'minor-half-up',
      900_000n,
    );
    expect(balloon.amount).toBe(55_520n);
  });

  it('rounds with each payment policy', () => {
    const rate = exact(monthly('6.5'));
    expect(levelInstalment(10_000_000n, rate, 24, 2, 'minor-ceil').amount).toBe(445_463n);
    expect(levelInstalment(10_000_000n, rate, 24, 2, 'unit-half-up').amount).toBe(445_500n);
    expect(levelInstalment(10_000_000n, rate, 24, 2, 'unit-ceil').amount).toBe(445_500n);
    expect(levelInstalment(10_000_000n, rate, 24, 0, 'unit-half-up').amount).toBe(445_463n);
  });

  it('gives the same instalment from a decimal rate away from ties', () => {
    const rational13 = monthly('6.5');
    const decimal = new EngineDecimal(rational13.n.toString()).div(rational13.d.toString());
    const fromDecimal = levelInstalment(10_000_000n, approx(decimal), 24, 2, 'minor-half-up');
    const fromExact = levelInstalment(10_000_000n, exact(rational13), 24, 2, 'minor-half-up');
    expect(fromDecimal.amount).toBe(fromExact.amount);
    expect(fromDecimal.exact.slice(0, 18)).toBe(fromExact.exact.slice(0, 18));
  });

  it('computes an irrational rate in decimal arithmetic (Canadian compounding)', () => {
    // Vector canada-semiannual-compounding: i = (1 + 0.0529/2)^(1/6) − 1, A = 2 991.12.
    const i = new EngineDecimal('1.02645').ln().div(6).exp().minus(1);
    const result = levelInstalment(50_000_000n, approx(i), 300, 2, 'minor-half-up');
    expect(result.amount).toBe(299_112n);
    expect(result.exact.startsWith('2991.1')).toBe(true);
  });

  it('keeps a tiny decimal rate off the boundary at P / N (SPEC §1.6)', () => {
    // i = ±1e−29 per month (continuous compounding at ±1.2e−26 %): A* lies about
    // P·|i|/2 ≈ 5e−13 minor units from P / N, far more than the 1e−15 SPEC §1.6 leaves
    // implementation-defined. At a fixed 50 digits 1 − (1 + i)^−N cancels to exactly
    // N·i and A* collapses onto P / N.
    const up = levelInstalment(
      96_000_000_000_000_000n,
      approx(new EngineDecimal('1e-29')),
      1200,
      2,
      'minor-ceil',
    );
    expect(up.amount).toBe(80_000_000_000_001n);
    const down = levelInstalment(
      96_000_000_000_000_600n,
      approx(new EngineDecimal('-1e-29')),
      1200,
      2,
      'minor-half-up',
    );
    expect(down.amount).toBe(80_000_000_000_000n);
    // The balloon formula has the same cancellation.
    const balloon = levelInstalment(
      96_000_000_000_000_000n,
      approx(new EngineDecimal('1e-29')),
      1200,
      2,
      'minor-ceil',
      48_000_000_000_000_000n,
    );
    expect(balloon.amount).toBe(40_000_000_000_001n);
  });

  it('agrees with the exact evaluation of the same decimal rate', () => {
    // A terminating decimal i is also a rational: the decimal path must round A* the same
    // way unless A* lies within 1e−15 minor units of a rounding boundary (SPEC §1.6).
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 17n }),
        fc.integer({ min: -9999, max: 99_999 }).filter((digits) => digits !== 0),
        fc.integer({ min: 1, max: 49 }),
        fc.integer({ min: 1, max: 1200 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(...POLICIES),
        fc.integer({ min: 0, max: 99 }),
        (principal, digits, places, payments, mu, policy, share) => {
          // |i| < 1, from about 1 down to 1e−53.
          const i = rational(BigInt(digits), 10n ** BigInt(places + 4));
          const residual = (principal * BigInt(share)) / 100n;
          const exactResult = levelInstalment(principal, exact(i), payments, mu, policy, residual);
          if (nearBoundary(exactQuotient(principal, residual, i, payments), mu, policy)) {
            return;
          }
          const decimal = new EngineDecimal(digits).div(new EngineDecimal(10).pow(places + 4));
          const fromDecimal = levelInstalment(
            principal,
            approx(decimal),
            payments,
            mu,
            policy,
            residual,
          );
          expect(fromDecimal.amount).toBe(exactResult.amount);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/** A* in minor units as an exact quotient [num, den] for a rational i ≠ 0. */
function exactQuotient(
  principal: bigint,
  residual: bigint,
  i: Rational,
  payments: number,
): readonly [bigint, bigint] {
  const uN = (i.n + i.d) ** BigInt(payments);
  const bN = i.d ** BigInt(payments);
  return [(principal * uN - residual * bN) * i.n, i.d * (uN - bN)];
}

/** Whether num / den (minor units) lies within 1e−15 minor units of a rounding boundary. */
function nearBoundary(
  [num, den]: readonly [bigint, bigint],
  minorUnits: number,
  policy: PaymentRounding,
): boolean {
  const unit = policy.startsWith('unit') ? 10n ** BigInt(minorUnits) : 1n;
  // w = n / d counts rounding steps of `unit` minor units, shifted so that the boundaries
  // are the integers: ceil rounds at k·unit, half-up at (k + 1/2)·unit.
  const ceil = policy.endsWith('ceil');
  const sign = den < 0n ? -1n : 1n;
  const n = sign * (ceil ? num : 2n * num - den * unit);
  const d = sign * (ceil ? den * unit : 2n * den * unit);
  const remainder = ((n % d) + d) % d;
  const steps = remainder < d - remainder ? remainder : d - remainder;
  // steps / d of a step of `unit` minor units, against 1e−15 minor units.
  return steps * unit * 10n ** 15n <= d;
}

describe('exactBasisInstalment', () => {
  it('equals the level instalment when every period has the same rate', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: -2000, max: 20000 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(...POLICIES),
        (principal, basisPoints, payments, mu, policy) => {
          const r = rational(BigInt(basisPoints), 120_000n);
          const rates = Array.from({ length: payments }, () => r);
          expect(exactBasisInstalment(principal, rates, mu, policy)).toEqual(
            levelInstalment(principal, exact(r), payments, mu, policy),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('divides evenly when every rate is zero', () => {
    const rates = Array.from({ length: 4 }, () => rational(0n));
    expect(exactBasisInstalment(1_000n, rates, 2, 'minor-half-up')).toEqual({
      amount: 250n,
      exact: '2.5',
    });
  });

  it('solves the recurrence with varying rates', () => {
    // P = 100, r = 10 %, 20 %: A* = 100 · 1.1 · 1.2 / (1 + 1.2) = 60 exactly.
    const rates = [rational(1n, 10n), rational(1n, 5n)];
    expect(exactBasisInstalment(10_000n, rates, 2, 'minor-half-up')).toEqual({
      amount: 6_000n,
      exact: '60',
    });
  });

  it('needs at least one period', () => {
    expect(() => exactBasisInstalment(1_000n, [], 2, 'minor-half-up')).toThrow(RangeError);
  });
});
