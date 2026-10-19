// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { fromInteger, mul, neg, parseDecimal, rational } from '../rational';
import { annualRateMetric, solveTimedFlows, toSolverFlows } from './solve';

describe('toSolverFlows', () => {
  it('sums equal exact times before converting to doubles', () => {
    const flows = toSolverFlows([
      { time: rational(1n, 12n), amount: parseDecimal('0.1') },
      { time: rational(2n, 24n), amount: parseDecimal('0.2') },
      { time: rational(1n, 12n), amount: parseDecimal('-0.3') },
      { time: fromInteger(0), amount: parseDecimal('5') },
    ]);
    // 0.1 + 0.2 − 0.3 is exactly zero here, not 5.5e-17 as in doubles. The sums are
    // scaled by one power of two (5 → 5/4), which leaves every root unchanged.
    expect(flows).toEqual([
      { t: 1 / 12, amount: 0 },
      { t: 0, amount: 1.25 },
    ]);
  });

  it('scales amounts beyond the double range by one exact power of two', () => {
    const huge = parseDecimal(`1${'0'.repeat(400)}`);
    const flows = toSolverFlows([
      { time: fromInteger(0), amount: huge },
      { time: fromInteger(1), amount: neg(mul(huge, parseDecimal('1.1'))) },
    ]);
    expect(flows.every((flow) => Number.isFinite(flow.amount) && flow.amount !== 0)).toBe(true);
    expect(flows[1]?.amount ?? 0).toBeCloseTo(-1.1 * (flows[0]?.amount ?? 0), 12);
    const tiny = parseDecimal(`0.${'0'.repeat(400)}1`);
    const small = toSolverFlows([
      { time: fromInteger(0), amount: tiny },
      { time: fromInteger(1), amount: neg(mul(tiny, fromInteger(2))) },
    ]);
    expect(small.map((flow) => flow.amount / Math.abs(small[0]?.amount ?? 1))).toEqual([1, -2]);
  });

  it('leaves sums that are all zero at zero (no scale to choose)', () => {
    expect(
      toSolverFlows([
        { time: fromInteger(0), amount: parseDecimal('0') },
        { time: fromInteger(1), amount: parseDecimal('-0.00') },
      ]),
    ).toEqual([
      { t: 0, amount: 0 },
      { t: 1, amount: 0 },
    ]);
  });

  it('changes no bit of amounts in the normal double range other than the common power of two', () => {
    const flows = toSolverFlows([
      { time: fromInteger(0), amount: parseDecimal('98000') },
      { time: fromInteger(1), amount: parseDecimal('-8884.88') },
    ]);
    // 98000 has a binary magnitude of 16 (2^16 ≤ 98000 < 2^17): every amount is divided by 2^16.
    expect(flows.map((flow) => flow.amount * 2 ** 16)).toEqual([98000, -8884.88]);
  });
});

describe('solveTimedFlows', () => {
  it('ignores a zero sum when counting sign changes', () => {
    const result = solveTimedFlows([
      { time: fromInteger(0), amount: parseDecimal('100') },
      { time: fromInteger(1), amount: parseDecimal('0.1') },
      { time: fromInteger(1), amount: parseDecimal('0.2') },
      { time: fromInteger(1), amount: parseDecimal('-0.3') },
      { time: fromInteger(2), amount: parseDecimal('-121') },
    ]);
    expect(result).toMatchObject({ ok: true, multiple: false });
    expect(result.ok && Math.abs(result.root - 0.1)).toBeLessThanOrEqual(1e-12);
  });
});

describe('annualRateMetric', () => {
  it('reports X in percent with the time basis', () => {
    expect(
      annualRateMetric({ ok: true, root: 0.0731, multiple: false }, 1, 'counted-back'),
    ).toEqual({
      value: 0.0731 * 100,
      display: '7.3',
      precision: 1,
      explain: { formulaId: 'rate.annual-irr', values: { X: '0.0731', timeBasis: 'counted-back' } },
    });
  });

  it('carries IRR_MULTIPLE and fails with the solve', () => {
    expect(annualRateMetric({ ok: true, root: 0.1, multiple: true }, 2, 'days-365')).toMatchObject({
      display: '10.00',
      warnings: ['IRR_MULTIPLE'],
    });
    expect(annualRateMetric({ ok: false }, 2, 'periods')).toEqual({
      ok: false,
      reason: 'IRR_NO_CONVERGENCE',
    });
  });
});
