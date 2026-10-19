// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineDecimal } from './decimal';
import { parseDecimal, rational } from './rational';
import {
  type Real,
  approx,
  exact,
  pow10,
  realToExplainString,
  realToNumber,
  roundPayment,
  roundRationalToMinor,
  roundToMinor,
  toDecimal,
} from './rounding';
import type { PaymentRounding, RoundingMode } from './types';

const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];
const POLICIES: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];

/** An exact value from a decimal string. */
function x(text: string): Real {
  return exact(parseDecimal(text));
}

/** An irrational-path value from a decimal string. */
function d(text: string): Real {
  return approx(new EngineDecimal(text));
}

describe('Real helpers', () => {
  it('wraps exact and decimal values', () => {
    expect(exact(rational(1n, 3n))).toEqual({ kind: 'exact', value: { n: 1n, d: 3n } });
    const value = new EngineDecimal('0.5');
    expect(approx(value)).toEqual({ kind: 'decimal', value });
  });

  it('converts to decimals and doubles', () => {
    const value = new EngineDecimal('0.004360520704');
    expect(toDecimal(approx(value))).toBe(value);
    expect(toDecimal(exact(rational(1n, 3n))).toString()).toBe(`0.${'3'.repeat(50)}`);
    expect(realToNumber(exact(rational(13n, 200n)))).toBe(0.065);
    expect(realToNumber(approx(value))).toBe(0.004360520704);
  });

  it('writes explanation strings for both kinds', () => {
    expect(realToExplainString(x('1508.125'))).toBe('1508.125');
    expect(realToExplainString(exact(rational(2n, 3n)))).toBe('0.66666666666666666667');
    expect(realToExplainString(approx(new EngineDecimal(2).div(3)))).toBe('0.66666666666666666667');
  });

  it('builds powers of ten', () => {
    expect(pow10(0)).toBe(1n);
    expect(pow10(2)).toBe(100n);
    expect(pow10(4)).toBe(10000n);
  });
});

describe('roundRationalToMinor (SPEC §1.3)', () => {
  it('reproduces the SPEC table at two decimals', () => {
    const value = (text: string, mode: RoundingMode): bigint =>
      roundRationalToMinor(parseDecimal(text), 2, mode);
    expect(value('0.125', 'half-up')).toBe(13n);
    expect(value('-0.125', 'half-up')).toBe(-13n);
    expect(value('0.125', 'half-even')).toBe(12n);
    expect(value('0.135', 'half-even')).toBe(14n);
    expect(value('-0.125', 'half-even')).toBe(-12n);
    expect(value('0.121', 'ceil')).toBe(13n);
    expect(value('-0.129', 'ceil')).toBe(-12n);
    expect(value('0.129', 'floor')).toBe(12n);
    expect(value('-0.121', 'floor')).toBe(-13n);
    expect(value('0.12', 'ceil')).toBe(12n);
    expect(value('-0.12', 'floor')).toBe(-12n);
  });

  it('rounds the E5 interest tie 14.625 per mode', () => {
    const tie = parseDecimal('14.625');
    expect(roundRationalToMinor(tie, 2, 'half-up')).toBe(1463n);
    expect(roundRationalToMinor(tie, 2, 'half-even')).toBe(1462n);
    expect(roundRationalToMinor(tie, 2, 'ceil')).toBe(1463n);
    expect(roundRationalToMinor(tie, 2, 'floor')).toBe(1462n);
  });

  it('quantizes to JPY 0, KWD 3 and CLF 4 minor units', () => {
    // JPY: 2.5 yen.
    expect(roundRationalToMinor(parseDecimal('2.5'), 0, 'half-up')).toBe(3n);
    expect(roundRationalToMinor(parseDecimal('2.5'), 0, 'half-even')).toBe(2n);
    expect(roundRationalToMinor(parseDecimal('-2.5'), 0, 'half-up')).toBe(-3n);
    // KWD: 1.0005 dinars.
    expect(roundRationalToMinor(parseDecimal('1.0005'), 3, 'half-up')).toBe(1001n);
    expect(roundRationalToMinor(parseDecimal('1.0005'), 3, 'half-even')).toBe(1000n);
    expect(roundRationalToMinor(parseDecimal('1.0015'), 3, 'half-even')).toBe(1002n);
    // CLF: 0.00005 and −0.00005.
    const half = parseDecimal('0.00005');
    const negativeHalf = parseDecimal('-0.00005');
    expect(MODES.map((mode) => roundRationalToMinor(half, 4, mode))).toEqual([1n, 0n, 1n, 0n]);
    expect(MODES.map((mode) => roundRationalToMinor(negativeHalf, 4, mode))).toEqual([
      -1n,
      0n,
      0n,
      -1n,
    ]);
  });

  it('rounds thirds of a cent', () => {
    const third = rational(1n, 300n); // 1/3 cent in dollars
    expect(MODES.map((mode) => roundRationalToMinor(third, 2, mode))).toEqual([0n, 0n, 1n, 0n]);
    const twoThirds = rational(-2n, 300n);
    expect(MODES.map((mode) => roundRationalToMinor(twoThirds, 2, mode))).toEqual([
      -1n,
      -1n,
      0n,
      -1n,
    ]);
  });
});

describe('roundToMinor', () => {
  it('rounds exact values like roundRationalToMinor', () => {
    expect(roundToMinor(x('14.625'), 2, 'half-even')).toBe(1462n);
  });

  it('rounds decimal values with every mode at ties and for negative values', () => {
    expect(MODES.map((mode) => roundToMinor(d('14.625'), 2, mode))).toEqual([
      1463n,
      1462n,
      1463n,
      1462n,
    ]);
    expect(MODES.map((mode) => roundToMinor(d('-14.625'), 2, mode))).toEqual([
      -1463n,
      -1462n,
      -1462n,
      -1463n,
    ]);
    expect(MODES.map((mode) => roundToMinor(d('14.635'), 2, mode))).toEqual([
      1464n,
      1464n,
      1464n,
      1463n,
    ]);
  });

  it('rounds irrational-path values', () => {
    const third = approx(new EngineDecimal(1).div(3));
    expect(MODES.map((mode) => roundToMinor(third, 2, mode))).toEqual([33n, 33n, 34n, 33n]);
    const negativeThird = approx(new EngineDecimal(-1).div(3));
    expect(MODES.map((mode) => roundToMinor(negativeThird, 2, mode))).toEqual([
      -33n,
      -33n,
      -33n,
      -34n,
    ]);
    expect(roundToMinor(third, 4, 'half-up')).toBe(3333n);
    expect(roundToMinor(third, 0, 'ceil')).toBe(1n);
  });

  it('gives the same result for exact and decimal forms of a terminating value', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 10 }),
        fc.constantFrom(0, 2, 3, 4),
        fc.constantFrom(...MODES),
        (scaled, places, minorUnits, mode) => {
          const value = rational(scaled, 10n ** BigInt(places));
          expect(roundToMinor(approx(toDecimal(exact(value))), minorUnits, mode)).toBe(
            roundToMinor(exact(value), minorUnits, mode),
          );
        },
      ),
    );
  });
});

describe('roundPayment (SPEC §1.5)', () => {
  const apply = (value: Real, minorUnits: number): bigint[] =>
    POLICIES.map((policy) => roundPayment(value, minorUnits, policy));

  it('rounds E6, A* = 1 508.125 exactly, with every policy', () => {
    // minor-half-up 1 508.13, minor-ceil 1 508.13, unit-half-up 1 508, unit-ceil 1 509.
    expect(apply(x('1508.125'), 2)).toEqual([150813n, 150813n, 150800n, 150900n]);
  });

  it('separates the policies around whole units and minor units', () => {
    expect(apply(x('1508.5'), 2)).toEqual([150850n, 150850n, 150900n, 150900n]);
    expect(apply(x('1508.49'), 2)).toEqual([150849n, 150849n, 150800n, 150900n]);
    expect(apply(x('1508.121'), 2)).toEqual([150812n, 150813n, 150800n, 150900n]);
    // Exact amounts are not bumped by the ceiling policies.
    expect(apply(x('1508.12'), 2)).toEqual([150812n, 150812n, 150800n, 150900n]);
    expect(apply(x('1508'), 2)).toEqual([150800n, 150800n, 150800n, 150800n]);
  });

  it('treats minor and whole units alike for JPY (0 decimals)', () => {
    expect(apply(x('113265.4'), 0)).toEqual([113265n, 113266n, 113265n, 113266n]);
    expect(apply(x('113265.5'), 0)).toEqual([113266n, 113266n, 113266n, 113266n]);
  });

  it('rounds KWD (3 decimals) and CLF (4 decimals)', () => {
    expect(apply(x('1162.8235'), 3)).toEqual([1162824n, 1162824n, 1163000n, 1163000n]);
    expect(apply(x('18.97945'), 4)).toEqual([189795n, 189795n, 190000n, 190000n]);
    expect(apply(x('18.97944'), 4)).toEqual([189794n, 189795n, 190000n, 190000n]);
  });

  it('rounds irrational-path instalments', () => {
    const value = d('2991.1150000000000000000000000000000000000000001');
    expect(POLICIES.map((policy) => roundPayment(value, 2, policy))).toEqual([
      299112n,
      299112n,
      299100n,
      299200n,
    ]);
  });

  it('rounds towards +∞ with ceil and away from zero with half-up for negative values', () => {
    expect(apply(x('-1.5'), 2)).toEqual([-150n, -150n, -200n, -100n]);
    expect(apply(x('-1.005'), 2)).toEqual([-101n, -100n, -100n, -100n]);
  });
});
