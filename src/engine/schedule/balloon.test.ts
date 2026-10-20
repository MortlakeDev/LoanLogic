// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { EngineDecimal } from '../decimal';
import { rational } from '../rational';
import { approx, exact } from '../rounding';
import { levelInstalment } from './annuity';
import { balloonInstalment, balloonPart, balloonResidual } from './balloon';

describe('balloonInstalment', () => {
  it('spreads P − Bal evenly at a zero rate (SPEC §5.5)', () => {
    expect(
      balloonInstalment(1_000_000n, 300_000n, exact(rational(0n)), 10, 2, 'minor-half-up'),
    ).toEqual({
      amount: 70_000n,
      exact: '700',
    });
  });

  it('is the level instalment with the residual left outstanding', () => {
    const rate = exact(rational(699n, 120_000n));
    const balloon = balloonInstalment(3_000_000n, 900_000n, rate, 48, 2, 'minor-half-up');
    expect(balloon).toEqual(levelInstalment(3_000_000n, rate, 48, 2, 'minor-half-up', 900_000n));
    // Vector balloon-percent-auto-loan.
    expect(balloon.amount).toBe(55_520n);
    expect(balloon.amount).toBeLessThan(
      levelInstalment(3_000_000n, rate, 48, 2, 'minor-half-up').amount,
    );
  });

  it('is exact for one payment: A* = P(1 + i) − Bal', () => {
    // 1 000.00 at 1 % per period with a 400.00 balloon: 1 010.00 − 400.00 = 610.00.
    const result = balloonInstalment(
      100_000n,
      40_000n,
      exact(rational(1n, 100n)),
      1,
      2,
      'minor-half-up',
    );
    expect(result).toEqual({ amount: 61_000n, exact: '610' });
  });
});

describe('balloonPart', () => {
  it('is the last principal beyond a regular instalment (vector balloon-percent-auto-loan)', () => {
    // p_N 9 499.78, A 555.20, I_N 55.34 → 9 499.78 − (555.20 − 55.34) = 8 999.92.
    expect(balloonPart(949_978n, 55_520n, 5_534n)).toBe(899_992n);
  });
});

describe('balloonResidual', () => {
  it('takes an amount as entered or rounds a percentage of P half-up', () => {
    expect(balloonResidual({ kind: 'amount', amount: 1_500_000n }, 4_039_900n)).toBe(1_500_000n);
    expect(balloonResidual({ kind: 'percent', pct: rational(30n) }, 3_000_000n)).toBe(900_000n);
    expect(balloonResidual({ kind: 'percent', pct: rational(25n, 2n) }, 101n)).toBe(13n);
  });
});

describe('balloonInstalment with an irrational rate', () => {
  it('agrees with the exact evaluation away from ties', () => {
    // The same rational i once exact, once as a 50-digit decimal.
    const i = rational(699n, 120_000n);
    const decimal = new EngineDecimal(699).div(120_000);
    const fromExact = balloonInstalment(3_000_000n, 900_000n, exact(i), 48, 2, 'minor-half-up');
    const fromDecimal = balloonInstalment(
      3_000_000n,
      900_000n,
      approx(decimal),
      48,
      2,
      'minor-half-up',
    );
    expect(fromDecimal.amount).toBe(fromExact.amount);
    expect(fromDecimal.exact.slice(0, 18)).toBe(fromExact.exact.slice(0, 18));
  });

  it('spreads P − Bal evenly at a decimal zero rate', () => {
    expect(
      balloonInstalment(1_000n, 400n, approx(new EngineDecimal(0)), 3, 2, 'minor-half-up'),
    ).toEqual({
      amount: 200n,
      exact: '2',
    });
  });
});
