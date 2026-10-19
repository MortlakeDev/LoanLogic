// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Rational,
  ONE,
  ZERO,
  add,
  compare,
  div,
  divRound,
  equals,
  floor,
  formatScaled,
  fromInteger,
  gcd,
  isInteger,
  mul,
  neg,
  parseDecimal,
  pow,
  rational,
  roundToInteger,
  sign,
  sub,
  toExplainString,
  toNumber,
} from './rational';
import type { RoundingMode } from './types';

const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];

/** Whether a rational is normalized: positive denominator, lowest terms. */
function isNormalized(a: Rational): boolean {
  return a.d > 0n && gcd(a.n, a.d) === 1n;
}

const smallBigInt = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
const nonZeroBigInt = smallBigInt.filter((value) => value !== 0n);
const anyRational = fc.tuple(smallBigInt, nonZeroBigInt).map(([n, d]): Rational => rational(n, d));
const nonZeroRational = anyRational.filter((value) => value.n !== 0n);

describe('gcd', () => {
  it('works on signs and zeros', () => {
    expect(gcd(12n, 18n)).toBe(6n);
    expect(gcd(-12n, 18n)).toBe(6n);
    expect(gcd(12n, -18n)).toBe(6n);
    expect(gcd(0n, 5n)).toBe(5n);
    expect(gcd(7n, 0n)).toBe(7n);
    expect(gcd(0n, 0n)).toBe(0n);
    expect(gcd(17n, 13n)).toBe(1n);
  });
});

describe('rational', () => {
  it('normalizes the sign into the numerator and reduces to lowest terms', () => {
    expect(rational(6n, -4n)).toEqual({ n: -3n, d: 2n });
    expect(rational(-6n, -4n)).toEqual({ n: 3n, d: 2n });
    expect(rational(-6n, 4n)).toEqual({ n: -3n, d: 2n });
    expect(rational(10n, 5n)).toEqual({ n: 2n, d: 1n });
  });

  it('defaults the denominator to 1 and canonicalizes zero', () => {
    expect(rational(7n)).toEqual({ n: 7n, d: 1n });
    expect(rational(0n, -5n)).toEqual({ n: 0n, d: 1n });
    expect(rational(0n, 12n)).toBe(ZERO);
  });

  it('rejects a zero denominator', () => {
    expect(() => rational(1n, 0n)).toThrow(RangeError);
  });

  it('exposes frozen constants', () => {
    expect(ZERO).toEqual({ n: 0n, d: 1n });
    expect(ONE).toEqual({ n: 1n, d: 1n });
    expect(Object.isFrozen(ZERO)).toBe(true);
    expect(Object.isFrozen(ONE)).toBe(true);
  });

  it('keeps every constructed value normalized', () => {
    fc.assert(
      fc.property(smallBigInt, nonZeroBigInt, (n, d) => {
        const value = rational(n, d);
        expect(isNormalized(value)).toBe(true);
        // Same value: n/d = value.n/value.d.
        expect(n * value.d).toBe(value.n * d);
      }),
    );
  });
});

describe('fromInteger', () => {
  it('accepts bigints and safe integers', () => {
    expect(fromInteger(5)).toEqual({ n: 5n, d: 1n });
    expect(fromInteger(-7n)).toEqual({ n: -7n, d: 1n });
    expect(fromInteger(0)).toEqual({ n: 0n, d: 1n });
  });

  it('rejects a fractional number', () => {
    expect(() => fromInteger(1.5)).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, multiplies and divides exactly', () => {
    expect(add(rational(1n, 3n), rational(1n, 6n))).toEqual({ n: 1n, d: 2n });
    expect(sub(rational(1n, 2n), rational(3n, 4n))).toEqual({ n: -1n, d: 4n });
    expect(mul(rational(-2n, 3n), rational(9n, 4n))).toEqual({ n: -3n, d: 2n });
    expect(div(rational(1n, 2n), rational(-1n, 4n))).toEqual({ n: -2n, d: 1n });
    expect(sub(rational(1n, 3n), rational(1n, 3n))).toBe(ZERO);
  });

  it('forms j / 12 exactly: 6.5 % / 12 = 13/2400', () => {
    expect(div(parseDecimal('0.065'), fromInteger(12))).toEqual({ n: 13n, d: 2400n });
  });

  it('rejects division by zero', () => {
    expect(() => div(ONE, ZERO)).toThrow(RangeError);
  });

  it('negates', () => {
    expect(neg(rational(3n, 4n))).toEqual({ n: -3n, d: 4n });
    expect(neg(rational(-3n, 4n))).toEqual({ n: 3n, d: 4n });
    expect(neg(ZERO)).toBe(ZERO);
  });

  it('satisfies the field laws and stays normalized', () => {
    fc.assert(
      fc.property(anyRational, anyRational, nonZeroRational, (a, b, c) => {
        expect(add(a, b)).toEqual(add(b, a));
        expect(mul(a, b)).toEqual(mul(b, a));
        expect(sub(add(a, b), b)).toEqual(a);
        expect(div(mul(a, c), c)).toEqual(a);
        expect(add(a, neg(a))).toEqual(ZERO);
        expect(mul(a, add(b, c))).toEqual(add(mul(a, b), mul(a, c)));
        for (const value of [add(a, b), sub(a, b), mul(a, b), div(a, c), neg(a)]) {
          expect(isNormalized(value)).toBe(true);
        }
      }),
    );
  });
});

describe('pow', () => {
  it('raises to positive, negative and zero powers', () => {
    expect(pow(rational(2n, 3n), 3)).toEqual({ n: 8n, d: 27n });
    expect(pow(rational(2n, 3n), -2)).toEqual({ n: 9n, d: 4n });
    expect(pow(rational(-2n, 3n), 3)).toEqual({ n: -8n, d: 27n });
    expect(pow(rational(-2n, 3n), -1)).toEqual({ n: -3n, d: 2n });
    expect(pow(rational(-2n, 3n), -2)).toEqual({ n: 9n, d: 4n });
    expect(pow(rational(5n, 7n), 0)).toBe(ONE);
    expect(pow(ZERO, 0)).toBe(ONE);
    expect(pow(ZERO, 5)).toBe(ZERO);
  });

  it('rejects zero to a negative power and fractional exponents', () => {
    expect(() => pow(ZERO, -1)).toThrow(RangeError);
    expect(() => pow(ONE, 0.5)).toThrow(RangeError);
  });

  it('keeps 1 200 periods exact and in lowest terms: (1 + 13/2400)^1200', () => {
    const growth = pow(add(ONE, rational(13n, 2400n)), 1200);
    expect(growth.n).toBe(2413n ** 1200n);
    expect(growth.d).toBe(2400n ** 1200n);
    expect(gcd(growth.n, growth.d)).toBe(1n);
  });

  it('agrees with repeated multiplication', () => {
    fc.assert(
      fc.property(nonZeroRational, fc.integer({ min: -6, max: 6 }), (a, k) => {
        let expected = ONE;
        for (let index = 0; index < Math.abs(k); index += 1) {
          expected = mul(expected, a);
        }
        if (k < 0) {
          expected = div(ONE, expected);
        }
        expect(pow(a, k)).toEqual(expected);
        expect(isNormalized(pow(a, k))).toBe(true);
      }),
    );
  });
});

describe('sign, compare, equals, isInteger', () => {
  it('compares exactly', () => {
    expect(sign(rational(-1n, 3n))).toBe(-1);
    expect(sign(ZERO)).toBe(0);
    expect(sign(rational(1n, 3n))).toBe(1);
    expect(compare(rational(1n, 3n), rational(1n, 2n))).toBe(-1);
    expect(compare(rational(2n, 4n), rational(1n, 2n))).toBe(0);
    expect(compare(rational(-1n, 3n), rational(-1n, 2n))).toBe(1);
    expect(equals(rational(2n, 4n), rational(1n, 2n))).toBe(true);
    expect(equals(rational(1n, 3n), rational(1n, 2n))).toBe(false);
    expect(isInteger(rational(6n, 3n))).toBe(true);
    expect(isInteger(rational(7n, 3n))).toBe(false);
  });

  it('orders consistently with subtraction', () => {
    fc.assert(
      fc.property(anyRational, anyRational, (a, b) => {
        expect(compare(a, b)).toBe(sign(sub(a, b)));
        expect(compare(b, a)).toBe(-compare(a, b));
        expect(equals(a, b)).toBe(compare(a, b) === 0);
      }),
    );
  });
});

describe('divRound (SPEC §1.3)', () => {
  // value = num / 10; columns: half-up, half-even, ceil, floor.
  const table: readonly (readonly [bigint, bigint, bigint, bigint, bigint])[] = [
    [25n, 3n, 2n, 3n, 2n],
    [-25n, -3n, -2n, -2n, -3n],
    [35n, 4n, 4n, 4n, 3n],
    [-35n, -4n, -4n, -3n, -4n],
    [5n, 1n, 0n, 1n, 0n],
    [-5n, -1n, 0n, 0n, -1n],
    [15n, 2n, 2n, 2n, 1n],
    [-15n, -2n, -2n, -1n, -2n],
    [24n, 2n, 2n, 3n, 2n],
    [-24n, -2n, -2n, -2n, -3n],
    [26n, 3n, 3n, 3n, 2n],
    [-26n, -3n, -3n, -2n, -3n],
    [30n, 3n, 3n, 3n, 3n],
    [-30n, -3n, -3n, -3n, -3n],
    [0n, 0n, 0n, 0n, 0n],
    [1n, 0n, 0n, 1n, 0n],
    [-1n, 0n, 0n, 0n, -1n],
  ];

  it.each(table)('%s / 10 rounds per mode', (num, halfUp, halfEven, ceil, floorValue) => {
    expect(divRound(num, 10n, 'half-up')).toBe(halfUp);
    expect(divRound(num, 10n, 'half-even')).toBe(halfEven);
    expect(divRound(num, 10n, 'ceil')).toBe(ceil);
    expect(divRound(num, 10n, 'floor')).toBe(floorValue);
  });

  it('reproduces the SPEC §1.3 examples at two decimals', () => {
    // 0.125 → 0.13 / 0.12, −0.125 → −0.13, 0.135 → 0.14 (half-even).
    expect(divRound(125n, 10n, 'half-up')).toBe(13n);
    expect(divRound(-125n, 10n, 'half-up')).toBe(-13n);
    expect(divRound(125n, 10n, 'half-even')).toBe(12n);
    expect(divRound(135n, 10n, 'half-even')).toBe(14n);
    expect(divRound(-125n, 10n, 'half-even')).toBe(-12n);
    expect(divRound(-135n, 10n, 'half-even')).toBe(-14n);
  });

  it('treats a negative denominator like a negative numerator', () => {
    for (const mode of MODES) {
      expect(divRound(5n, -2n, mode)).toBe(divRound(-5n, 2n, mode));
      expect(divRound(-5n, -2n, mode)).toBe(divRound(5n, 2n, mode));
      expect(divRound(7n, -3n, mode)).toBe(divRound(-7n, 3n, mode));
    }
  });

  it('rejects a zero denominator', () => {
    expect(() => divRound(1n, 0n, 'half-up')).toThrow(RangeError);
  });

  it('stays within its bounds for every mode', () => {
    fc.assert(
      fc.property(smallBigInt, nonZeroBigInt, (num, den) => {
        // Normalize to a positive denominator for the reference checks.
        const n = den < 0n ? -num : num;
        const d = den < 0n ? -den : den;
        const down = divRound(num, den, 'floor');
        const up = divRound(num, den, 'ceil');
        // floor: down·d ≤ n < (down + 1)·d; ceil: (up − 1)·d < n ≤ up·d.
        expect(down * d <= n && n < (down + 1n) * d).toBe(true);
        expect((up - 1n) * d < n && n <= up * d).toBe(true);
        expect(up - down).toBe(n % d === 0n ? 0n : 1n);
        for (const mode of ['half-up', 'half-even'] as const) {
          const r = divRound(num, den, mode);
          // Nearest: |n − r·d| ≤ d/2.
          const twiceError = 2n * (n - r * d);
          expect(twiceError <= d && -twiceError <= d).toBe(true);
          expect(r === down || r === up).toBe(true);
        }
        const twiceRemainder = 2n * (n - down * d);
        if (twiceRemainder === d) {
          // An exact tie: half-up goes away from zero, half-even to the even neighbour.
          expect(divRound(num, den, 'half-up')).toBe(n > 0n ? up : down);
          expect(divRound(num, den, 'half-even') % 2n).toBe(0n);
        } else {
          expect(divRound(num, den, 'half-up')).toBe(divRound(num, den, 'half-even'));
        }
      }),
    );
  });

  it('rounds integers through roundToInteger and floor', () => {
    expect(roundToInteger(rational(5n, 2n), 'half-up')).toBe(3n);
    expect(roundToInteger(rational(5n, 2n), 'half-even')).toBe(2n);
    expect(roundToInteger(rational(-5n, 2n), 'ceil')).toBe(-2n);
    expect(floor(rational(-1n, 3n))).toBe(-1n);
    expect(floor(rational(7n, 3n))).toBe(2n);
    expect(floor(fromInteger(4))).toBe(4n);
  });
});

describe('parseDecimal', () => {
  it('parses plain decimals exactly', () => {
    expect(parseDecimal('-12.5')).toEqual({ n: -25n, d: 2n });
    expect(parseDecimal('0.065')).toEqual({ n: 13n, d: 200n });
    expect(parseDecimal('100000.00')).toEqual({ n: 100000n, d: 1n });
    expect(parseDecimal('1000000000000000.00')).toEqual({ n: 10n ** 15n, d: 1n });
    expect(parseDecimal('0.0000000000000000000000000000001')).toEqual({ n: 1n, d: 10n ** 31n });
    expect(parseDecimal('-0')).toBe(ZERO);
    expect(parseDecimal('0.000')).toBe(ZERO);
  });

  it('rejects text that is not a plain decimal', () => {
    for (const text of ['', '-', '1e5', '+1', '1.', '.5', '1,000.00', ' 1', '1 ', '1.2.3', '--1']) {
      expect(() => parseDecimal(text), text).toThrow(RangeError);
    }
  });
});

describe('formatScaled', () => {
  it('places the decimal point and pads with zeros', () => {
    expect(formatScaled(123450n, 2)).toBe('1234.50');
    expect(formatScaled(5n, 2)).toBe('0.05');
    expect(formatScaled(-5n, 2)).toBe('-0.05');
    expect(formatScaled(1n, 4)).toBe('0.0001');
    expect(formatScaled(123n, 0)).toBe('123');
    expect(formatScaled(-123n, 0)).toBe('-123');
  });

  it('never writes a negative zero', () => {
    expect(formatScaled(0n, 2)).toBe('0.00');
    expect(formatScaled(0n, 0)).toBe('0');
  });

  it('round-trips through parseDecimal', () => {
    fc.assert(
      fc.property(smallBigInt, fc.integer({ min: 0, max: 8 }), (scaled, places) => {
        const text = formatScaled(scaled, places);
        expect(text).toMatch(/^-?(0|[1-9]\d*)(\.\d+)?$/);
        expect(parseDecimal(text)).toEqual(rational(scaled, 10n ** BigInt(places)));
        expect(text.split('.')[1]?.length ?? 0).toBe(places);
      }),
    );
  });
});

describe('toExplainString', () => {
  it('writes terminating values exactly', () => {
    expect(toExplainString(parseDecimal('0.065'))).toBe('0.065');
    expect(toExplainString(parseDecimal('-0.065'))).toBe('-0.065');
    expect(toExplainString(rational(12065n, 8n))).toBe('1508.125');
    expect(toExplainString(fromInteger(5))).toBe('5');
    expect(toExplainString(ZERO)).toBe('0');
    expect(toExplainString(rational(1n, 10n ** 30n))).toBe(`0.${'0'.repeat(29)}1`);
  });

  it('rounds other values half-up to 20 significant digits', () => {
    expect(toExplainString(rational(1n, 3n))).toBe('0.33333333333333333333');
    expect(toExplainString(rational(2n, 3n))).toBe('0.66666666666666666667');
    expect(toExplainString(rational(-1n, 3n))).toBe('-0.33333333333333333333');
    expect(toExplainString(rational(-2n, 3n))).toBe('-0.66666666666666666667');
    expect(toExplainString(rational(100n, 3n))).toBe('33.333333333333333333');
    expect(toExplainString(rational(1n, 30000n))).toBe('0.000033333333333333333333');
    expect(toExplainString(rational(1n, 7n))).toBe('0.14285714285714285714');
  });

  it('honours a custom number of significant digits', () => {
    expect(toExplainString(rational(1n, 3n), 12)).toBe('0.333333333333');
    // SPEC §4: 61/365 + 121/366 = 0.497724380567…
    expect(toExplainString(add(rational(61n, 365n), rational(121n, 366n)), 12)).toBe(
      '0.497724380567',
    );
  });

  it('drops the zeros left by a carry into a new digit', () => {
    // 1 − 1/(3·10^24) rounds to 1.0000000000000000000 at 20 digits.
    expect(toExplainString(sub(ONE, rational(1n, 3n * 10n ** 24n)))).toBe('1');
    expect(toExplainString(sub(fromInteger(10), rational(1n, 3n * 10n ** 24n)))).toBe('10');
  });

  it('never uses exponent notation for large values', () => {
    expect(toExplainString(rational(10n ** 25n, 3n))).toBe('3333333333333333333333333');
  });

  it('round-trips terminating values', () => {
    fc.assert(
      fc.property(
        smallBigInt,
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (n, twos, fives) => {
          const value = rational(n, 2n ** BigInt(twos) * 5n ** BigInt(fives));
          expect(parseDecimal(toExplainString(value))).toEqual(value);
        },
      ),
    );
  });
});

describe('toNumber', () => {
  it('converts ordinary values', () => {
    expect(toNumber(ZERO)).toBe(0);
    expect(toNumber(parseDecimal('0.065'))).toBe(0.065);
    expect(toNumber(rational(-1n, 3n))).toBe(-1 / 3);
    expect(toNumber(fromInteger(10n ** 17n))).toBe(1e17);
  });

  it('is correctly rounded for numerators and denominators below 2^53', () => {
    const safe = fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n });
    fc.assert(
      fc.property(
        safe,
        safe.filter((value) => value !== 0n),
        (n, d) => {
          // IEEE division of exactly representable operands is correctly rounded.
          // `+ 0` turns the −0 of 0 / −d into the 0 that toNumber returns.
          expect(toNumber(rational(n, d))).toBe(Number(n) / Number(d) + 0);
        },
      ),
    );
  });

  it('rounds an inexact quotient that truncates to a tie upwards (sticky bit)', () => {
    // (2^64 + 2^11 + 1/3) lies just above the midpoint between 2^64 and 2^64 + 2^12.
    expect(toNumber(rational((2n ** 64n + 2n ** 11n) * 3n + 1n, 3n))).toBe(2 ** 64 + 2 ** 12);
    expect(toNumber(rational(-((2n ** 64n + 2n ** 11n) * 3n + 1n), 3n))).toBe(-(2 ** 64 + 2 ** 12));
  });

  it('handles huge numerators and denominators: (1 + 13/2400)^1200', () => {
    const growth = pow(add(ONE, rational(13n, 2400n)), 1200);
    const expected = Math.exp(1200 * Math.log1p(13 / 2400));
    expect(Math.abs(toNumber(growth) / expected - 1)).toBeLessThan(1e-12);
    expect(Math.abs(toNumber(div(ONE, growth)) * expected - 1)).toBeLessThan(1e-12);
  });

  it('covers the whole double range', () => {
    expect(toNumber(fromInteger(2n ** 1000n))).toBe(2 ** 1000);
    expect(toNumber(rational(1n, 2n ** 1000n))).toBe(2 ** -1000);
    expect(toNumber(fromInteger(3n * 2n ** 1022n))).toBe(1.5 * 2 ** 1023);
    const ratio = toNumber(rational(3n ** 700n, 2n ** 1000n));
    expect(Math.abs(ratio / Math.exp(700 * Math.log(3) - 1000 * Math.log(2)) - 1)).toBeLessThan(
      1e-11,
    );
    expect(toNumber(rational(1n, 2n ** 1074n))).toBe(5e-324);
    expect(toNumber(fromInteger(2n ** 1024n))).toBe(Infinity);
    expect(toNumber(fromInteger(-(2n ** 1024n)))).toBe(-Infinity);
    expect(toNumber(rational(1n, 2n ** 1200n))).toBe(0);
  });

  it('stays within one rounding of the exact value for large operands', () => {
    const big = fc.bigInt({ min: 1n, max: 2n ** 400n });
    fc.assert(
      fc.property(big, big, fc.boolean(), (n, d, negative) => {
        const value = rational(negative ? -n : n, d);
        const approx = toNumber(value);
        // |approx − n/d| ≤ 2^−52 · |n/d|, checked exactly on a 2^80 scale.
        const exact = rational(value.n * 2n ** 80n, value.d);
        const scaled = fromNumber(approx * 2 ** 80);
        const error = sub(scaled, exact);
        const bound = mul(exact, rational(1n, 2n ** 52n));
        expect(compare(abs(error), abs(bound))).toBeLessThanOrEqual(0);
      }),
    );
  });

  it('is correctly rounded (nearest, ties to even) for operands of up to 2 000 bits', () => {
    // Operands with a given bit length; the quotient stays inside the normal double range.
    const operand = (bits: number): fc.Arbitrary<bigint> =>
      fc.bigInt({ min: 2n ** BigInt(bits - 1), max: 2n ** BigInt(bits) - 1n });
    const quotient = fc
      .integer({ min: 1, max: 2000 })
      .chain((bits) =>
        fc.tuple(
          operand(bits),
          fc.integer({ min: Math.max(1, bits - 1000), max: bits + 1000 }).chain(operand),
        ),
      );
    fc.assert(
      fc.property(quotient, fc.boolean(), ([n, d], negative) => {
        expectCorrectlyRounded(rational(negative ? -n : n, d));
      }),
    );
  });

  it('rounds exact ties to the even neighbour, also through huge operands', () => {
    // 2^53 + 1 and 2^53 + 3 lie halfway between two doubles.
    const big = 3n ** 500n;
    expect(toNumber(fromInteger(2n ** 53n + 1n))).toBe(2 ** 53);
    expect(toNumber(fromInteger(2n ** 53n + 3n))).toBe(2 ** 53 + 4);
    expect(toNumber(rational((2n ** 53n + 1n) * big, big))).toBe(2 ** 53);
    expect(toNumber(rational(-(2n ** 53n + 3n) * big, big))).toBe(-(2 ** 53 + 4));
    expect(toNumber(rational(2n ** 53n + 1n, 2n ** 900n))).toBe(2 ** -847);
    expect(toNumber(fromInteger((2n ** 53n + 3n) * 2n ** 900n))).toBe((2 ** 53 + 4) * 2 ** 900);
    expectCorrectlyRounded(rational((2n ** 53n + 1n) * 2n ** 900n + 1n, 3n ** 300n));
  });
});

/** Raw IEEE-754 bits of a double. */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

/** The double with the given raw bits. */
function fromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

/** Exact value of a finite, non-negative double, decoded from its bits. */
function exactOfDouble(value: number): Rational {
  const bits = bitsOf(value);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & (2n ** 52n - 1n);
  const significand = exponent === 0 ? fraction : fraction + 2n ** 52n;
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  return power >= 0
    ? fromInteger(significand * 2n ** BigInt(power))
    : rational(significand, 2n ** BigInt(-power));
}

/**
 * Checks that `toNumber(value)` is the double nearest to `value` (ties to an even
 * significand), by comparing it exactly with both neighbouring doubles. Only for values
 * whose magnitude is a positive normal double.
 */
function expectCorrectlyRounded(value: Rational): void {
  const result = toNumber(value);
  expect(Number.isFinite(result) && result !== 0).toBe(true);
  expect(Math.sign(result)).toBe(sign(value));
  const target = abs(value);
  const bits = bitsOf(Math.abs(result));
  const distance = (bitsValue: bigint): Rational =>
    abs(sub(target, exactOfDouble(fromBits(bitsValue))));
  const own = distance(bits);
  for (const neighbour of [bits - 1n, bits + 1n]) {
    const order = compare(own, distance(neighbour));
    expect(order).toBeLessThanOrEqual(0);
    if (order === 0) {
      // An exact tie: the even significand wins.
      expect(bits % 2n).toBe(0n);
    }
  }
}

/** Exact rational of a finite double. */
function fromNumber(value: number): Rational {
  if (Number.isInteger(value)) {
    return fromInteger(BigInt(value));
  }
  let scaled = value;
  let exponent = 0n;
  while (!Number.isInteger(scaled)) {
    scaled *= 2;
    exponent += 1n;
  }
  return rational(BigInt(scaled), 2n ** exponent);
}

function abs(value: Rational): Rational {
  return value.n < 0n ? neg(value) : value;
}
