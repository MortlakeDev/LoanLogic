// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDecimal } from '../rational';
import { balloonResidual } from './balloon';
import { equalPrincipalAmount, remainderFirstPrincipal } from './equal-principal';

describe('equalPrincipalAmount (SPEC §5.3)', () => {
  it('rounds P / N half-up to the minor unit: E2 100 000.00 / 7 = 14 285.71', () => {
    expect(equalPrincipalAmount(10000000n, 7)).toBe(1428571n);
    expect(equalPrincipalAmount(24000000n, 12)).toBe(2000000n);
    expect(equalPrincipalAmount(10000000n, 1)).toBe(10000000n);
  });

  it('always rounds ties up, never to even', () => {
    expect(equalPrincipalAmount(1n, 2)).toBe(1n); // 0.5
    expect(equalPrincipalAmount(5n, 2)).toBe(3n); // 2.5
    expect(equalPrincipalAmount(36180n, 360)).toBe(101n); // 100.5
    expect(equalPrincipalAmount(14n, 4)).toBe(4n); // 3.5
  });
});

describe('remainderFirstPrincipal (SPEC §5.3)', () => {
  it('puts the rounding remainder into the first payment', () => {
    // E2 with the remainder first: 100 000.00 − 6 × 14 285.71 = 14 285.74.
    expect(remainderFirstPrincipal(10000000n, 7)).toBe(1428574n);
    expect(remainderFirstPrincipal(24000000n, 12)).toBe(2000000n);
    expect(remainderFirstPrincipal(10000000n, 1)).toBe(10000000n);
    expect(remainderFirstPrincipal(10n, 7)).toBe(4n); // q = 1
    expect(remainderFirstPrincipal(10n, 6)).toBe(0n); // q = 2
  });

  it('goes negative when q rounds up on a small amount (AMOUNT_TOO_SMALL_FOR_TERM)', () => {
    // Vector error-amount-too-small-for-term: 361.80 over 360: q = 1.01, p_1 = −0.79.
    expect(remainderFirstPrincipal(36180n, 360)).toBe(-79n);
    expect(remainderFirstPrincipal(17n, 10)).toBe(-1n); // q = 2
  });

  it('sums to P with N − 1 equal instalments and differs from q by at most N/2', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 17n }),
        fc.integer({ min: 1, max: 1200 }),
        (principal, payments) => {
          const q = equalPrincipalAmount(principal, payments);
          const first = remainderFirstPrincipal(principal, payments);
          expect(first + BigInt(payments - 1) * q).toBe(principal);
          // p_1 − q = P − N·q = N·(P/N − q), and half-up gives P/N − q in [−1/2, 1/2).
          const twiceDifference = 2n * (first - q);
          expect(twiceDifference < BigInt(payments)).toBe(true);
          expect(-twiceDifference <= BigInt(payments)).toBe(true);
        },
      ),
    );
  });
});

describe('balloonResidual (SPEC §5.5)', () => {
  it('uses an amount as entered', () => {
    expect(balloonResidual({ kind: 'amount', amount: 1500000n }, 4039900n)).toBe(1500000n);
    expect(balloonResidual({ kind: 'amount', amount: 100n }, 1000n)).toBe(100n);
  });

  it('takes a percentage of the principal financed, half-up', () => {
    // balloon-percent-auto-loan: 30 % of 30 000.00 = 9 000.00.
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('30') }, 3000000n)).toBe(900000n);
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('1') }, 50n)).toBe(1n); // 0.5
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('1') }, 250n)).toBe(3n); // 2.5
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('1') }, 249n)).toBe(2n); // 2.49
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('12.5') }, 1000003n)).toBe(125000n);
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('100') }, 1000n)).toBe(1000n);
    expect(balloonResidual({ kind: 'percent', pct: parseDecimal('0') }, 1000n)).toBe(0n);
  });
});
