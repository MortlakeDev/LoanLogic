// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RATE_SEARCH_MAX,
  RATE_SEARCH_MIN,
  type SolveResult,
  type SolverFlow,
  bracketTolerance,
  refineRoot,
  solveRate,
  solveSingleRoot,
} from './solvers';

/** Flows `P` at t = 0 and `−A` at t = 1…n with A the annuity payment of rate r. */
function annuityFlows(principal: number, rate: number, n: number): SolverFlow[] {
  // r / (1 − (1 + r)^−n) first, so that a tiny r does not underflow in P·r.
  const payment =
    rate === 0 ? principal / n : principal * (rate / -Math.expm1(-n * Math.log1p(rate)));
  return [
    { t: 0, amount: principal },
    ...Array.from({ length: n }, (_, k) => ({ t: k + 1, amount: -payment })),
  ];
}

/** Flows whose present value is `Σ a_k v^k` with `v = 1/(1 + x)`. */
function polynomialFlows(coefficients: readonly number[]): SolverFlow[] {
  return coefficients.map((amount, t) => ({ t, amount }));
}

function rootOf(result: SolveResult): number {
  if (!result.ok) {
    throw new Error('expected a root');
  }
  return result.root;
}

describe('bracketTolerance', () => {
  it('is 1e-12 absolute up to |x| = 1 and relative beyond', () => {
    expect(bracketTolerance(0)).toBe(1e-12);
    expect(bracketTolerance(-0.5)).toBe(1e-12);
    expect(bracketTolerance(1e6)).toBeCloseTo(1e-6, 18);
    expect(bracketTolerance(-4)).toBeCloseTo(4e-12, 24);
  });
});

describe('refineRoot', () => {
  it('rejects a bracket without strictly opposite signs', () => {
    expect(() => refineRoot((x) => x, 1, 2, 1, 2)).toThrow(RangeError);
    expect(() => refineRoot((x) => x, 0, 2, 0, 2)).toThrow(RangeError);
  });

  it('converges on a smooth function to the bracket-width tolerance', () => {
    const root = refineRoot((x) => x * x - 2, 0, 2, -2, 2);
    expect(root).not.toBeNull();
    expect(Math.abs((root ?? 0) - Math.SQRT2)).toBeLessThanOrEqual(1e-12);
  });

  it('accepts either orientation of the bracket', () => {
    const root = refineRoot((x) => 1 - x, 3, -1, -2, 2);
    expect(Math.abs((root ?? 0) - 1)).toBeLessThanOrEqual(1e-12);
  });

  it('returns a point where the function is exactly zero', () => {
    // The first secant step from (−1, −1) and (1, 1) lands on 0 exactly.
    expect(refineRoot((x) => x, -1, 1, -1, 1)).toBe(0);
  });

  it('falls back to bisection on a discontinuous sign change', () => {
    const step = (x: number): number => (x < 0.3 ? -1 : 1);
    const root = refineRoot(step, 0, 1, -1, 1);
    expect(root).not.toBeNull();
    expect(Math.abs((root ?? 0) - 0.3)).toBeLessThanOrEqual(1e-12);
  });

  it('meets the relative width near large roots', () => {
    const root = refineRoot((x) => x - 1e6, 0, 1e7, -1e6, 9e6);
    expect(Math.abs((root ?? 0) - 1e6)).toBeLessThanOrEqual(1e-6);
  });

  it('gives up (null) when the evaluation budget is spent, never a guess', () => {
    const step = (x: number): number => (x < 0.3 ? -1 : 1);
    expect(refineRoot(step, 0, 1, -1, 1, 5)).toBeNull();
    expect(refineRoot((x) => x - 0.123, 0, 1, -0.123, 0.877, 0)).toBeNull();
  });

  it('does not stop on a small |f| while the bracket is still wide', () => {
    // f is tiny everywhere (|f| ≤ 1e-30) but has one sign change at 0.7.
    const flat = (x: number): number => (x - 0.7) * 1e-30;
    const root = refineRoot(flat, 0, 1, flat(0), flat(1));
    expect(Math.abs((root ?? 0) - 0.7)).toBeLessThanOrEqual(1e-12);
  });
});

describe('solveSingleRoot', () => {
  it('finds a root inside the initial bracket [−0.99, 1]', () => {
    const root = solveSingleRoot((x) => x - 0.25);
    expect(Math.abs((root ?? 0) - 0.25)).toBeLessThanOrEqual(1e-12);
  });

  it('doubles the upper end until the sign changes', () => {
    const root = solveSingleRoot((x) => x - 37.5);
    expect(Math.abs((root ?? 0) - 37.5)).toBeLessThanOrEqual(37.5e-12);
  });

  it('returns an end of the bracket where the function is exactly zero', () => {
    expect(solveSingleRoot((x) => x - RATE_SEARCH_MIN)).toBe(RATE_SEARCH_MIN);
    expect(solveSingleRoot((x) => x - 1)).toBe(1);
    expect(solveSingleRoot((x) => x - 8)).toBe(8);
  });

  it('reaches 1e7 but not beyond', () => {
    expect(solveSingleRoot((x) => x - RATE_SEARCH_MAX)).toBe(RATE_SEARCH_MAX);
    const nearTop = solveSingleRoot((x) => x - 9.5e6);
    expect(Math.abs((nearTop ?? 0) - 9.5e6)).toBeLessThanOrEqual(9.5e-6);
    expect(solveSingleRoot((x) => x - 2e7)).toBeNull();
  });

  it('fails for a root below −0.99', () => {
    expect(solveSingleRoot((x) => x + 0.995)).toBeNull();
  });
});

describe('solveRate', () => {
  it('fails without a sign change', () => {
    expect(solveRate([])).toEqual({ ok: false });
    expect(solveRate([{ t: 0, amount: 100 }])).toEqual({ ok: false });
    expect(
      solveRate([
        { t: 0, amount: 100 },
        { t: 1, amount: 10 },
      ]),
    ).toEqual({ ok: false });
    expect(
      solveRate([
        { t: 0, amount: 0 },
        { t: 1, amount: 0 },
      ]),
    ).toEqual({ ok: false });
  });

  it('solves a one-period loan exactly to the tolerance', () => {
    const result = solveRate([
      { t: 0, amount: 100 },
      { t: 1, amount: -110 },
    ]);
    expect(result.ok && result.multiple).toBe(false);
    expect(Math.abs(rootOf(result) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('expands the bracket for rates above 100 %', () => {
    const result = solveRate([
      { t: 0, amount: 1 },
      { t: 1, amount: -6 },
    ]);
    expect(Math.abs(rootOf(result) - 5)).toBeLessThanOrEqual(5e-12);
  });

  it('fails when the only root lies outside [−0.99, 1e7]', () => {
    expect(
      solveRate([
        { t: 0, amount: 1 },
        { t: 1, amount: -1e8 },
      ]),
    ).toEqual({ ok: false });
    expect(
      solveRate([
        { t: 0, amount: 1 },
        { t: 1, amount: -0.005 },
      ]),
    ).toEqual({ ok: false });
  });

  it('sums flows at the same time before counting sign changes', () => {
    // −50 and +1000 at t = 0 are one inflow of 950: one sign change, no IRR_MULTIPLE.
    const flows: SolverFlow[] = [
      { t: 1, amount: -1100 },
      { t: 0, amount: 1000 },
      { t: 0, amount: -50 },
    ];
    const result = solveRate(flows);
    expect(result).toMatchObject({ ok: true, multiple: false });
    expect(Math.abs(rootOf(result) - (1100 / 950 - 1))).toBeLessThanOrEqual(1e-12);
  });

  it('treats −0 and 0 as the same time', () => {
    const result = solveRate([
      { t: -0, amount: 60 },
      { t: 0, amount: 40 },
      { t: 1, amount: -105 },
    ]);
    expect(Math.abs(rootOf(result) - 0.05)).toBeLessThanOrEqual(1e-12);
  });

  it('skips zero sums when counting sign changes', () => {
    const result = solveRate([
      { t: 0, amount: 100 },
      { t: 1, amount: 0 },
      { t: 2, amount: -121 },
    ]);
    expect(result).toMatchObject({ ok: true, multiple: false });
    expect(Math.abs(rootOf(result) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('enumerates two roots and picks the smallest non-negative one', () => {
    // 100 − 230 v + 132 v²: roots 10 % and 20 %.
    const result = solveRate(polynomialFlows([100, -230, 132]));
    expect(result).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(result) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('separates roots 0.2 points apart on the grid', () => {
    const result = solveRate(polynomialFlows([100, -210.2, 110.46]));
    expect(result).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(result) - 0.05)).toBeLessThanOrEqual(1e-12);
  });

  it('takes a grid point where f is exactly zero as a root', () => {
    // 1 − 3v + 2v² = (2v − 1)(v − 1): roots x = 0 and x = 1, both grid points.
    const result = solveRate(polynomialFlows([1, -3, 2]));
    expect(result).toEqual({ ok: true, root: 0, multiple: true });
  });

  it('prefers a non-negative root over a negative one', () => {
    // (v − 2)(v − 0.8): x = −50 % and x = 25 %.
    const result = solveRate(polynomialFlows([1.6, -2.8, 1]));
    expect(result).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(result) - 0.25)).toBeLessThanOrEqual(1e-12);
  });

  it('picks the negative root closest to zero when there is no other', () => {
    // (v − 2)(v − 1.25): x = −50 % and x = −20 %.
    const result = solveRate(polynomialFlows([2.5, -3.25, 1]));
    expect(result).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(result) + 0.2)).toBeLessThanOrEqual(1e-12);
  });

  it('reports one root without IRR_MULTIPLE when the other is out of range', () => {
    // (v − 1/1.1)(v − 200): x = 10 % and x = −99.5 %.
    const v1 = 1 / 1.1;
    const result = solveRate(polynomialFlows([200 * v1, -(200 + v1), 1]));
    expect(result).toMatchObject({ ok: true, multiple: false });
    expect(Math.abs(rootOf(result) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('enumerates roots on the geometric part of the grid', () => {
    // (v − 1/3)(v − 1/51): x = 200 % and x = 5 000 %.
    const result = solveRate(polynomialFlows([1 / 153, -(1 / 3 + 1 / 51), 1]));
    expect(result).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(result) - 2)).toBeLessThanOrEqual(2e-12);
  });

  it('fails when several sign changes give no real root', () => {
    // 1 − v + v² has no real root.
    expect(solveRate(polynomialFlows([1, -1, 1]))).toEqual({ ok: false });
  });

  it('solves a 1 200-period loan at a negative rate without overflow', () => {
    const result = solveRate(annuityFlows(500000, -0.004, 1200));
    expect(Math.abs(rootOf(result) + 0.004)).toBeLessThanOrEqual(1e-12);
  });

  it('does not let a zero sum at the latest time choose the scale for x < 0', () => {
    // With t_max = 1200 the factor (1 + x)^1200 would underflow every nonzero term at
    // x = −0.99 and make f exactly 0 there: a spurious root of −99 %.
    const result = solveRate([
      { t: 0, amount: 1000 },
      { t: 1, amount: -1100 },
      { t: 1200, amount: 0 },
    ]);
    expect(result).toMatchObject({ ok: true, multiple: false });
    expect(Math.abs(rootOf(result) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('keeps late flows from underflowing to zero for x ≥ 0 after a zero sum at time 0', () => {
    // Unscaled, 2^−1100 underflows: f(1) would be exactly 0, a spurious root of 100 %.
    const single = solveRate([
      { t: 0, amount: 0 },
      { t: 1100, amount: 1000 },
      { t: 1101, amount: -1100 },
    ]);
    expect(single).toMatchObject({ ok: true, multiple: false });
    expect(Math.abs(rootOf(single) - 0.1)).toBeLessThanOrEqual(1e-12);
    // On the enumeration grid every point above about 1 would be an exact zero.
    const several = solveRate([
      { t: 0, amount: 50 },
      { t: 0, amount: -50 },
      { t: 1100, amount: 100 },
      { t: 1101, amount: -230 },
      { t: 1102, amount: 132 },
    ]);
    expect(several).toMatchObject({ ok: true, multiple: true });
    expect(Math.abs(rootOf(several) - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('solves a zero rate to within the tolerance of zero', () => {
    const result = solveRate(annuityFlows(12000, 0, 12));
    expect(Math.abs(rootOf(result))).toBeLessThanOrEqual(1e-12);
  });

  it('solves a very high rate to the relative tolerance', () => {
    const result = solveRate(annuityFlows(500, 50, 8));
    expect(Math.abs(rootOf(result) - 50)).toBeLessThanOrEqual(50e-12 * 2);
  });

  it('rejects negative or non-finite times and amounts', () => {
    expect(() => solveRate([{ t: -1, amount: 1 }])).toThrow(RangeError);
    expect(() => solveRate([{ t: Number.NaN, amount: 1 }])).toThrow(RangeError);
    expect(() => solveRate([{ t: 1, amount: Number.POSITIVE_INFINITY }])).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const flows = annuityFlows(250000, 0.0052, 360);
    expect(solveRate(flows)).toEqual(solveRate(flows));
  });
});

describe('solveRate properties', () => {
  const rate = fc.double({ min: -0.5, max: 3, noNaN: true });
  const periods = fc.integer({ min: 1, max: 240 });
  const principal = fc.double({ min: 1, max: 1e12, noNaN: true });

  it('recovers the rate of an annuity', () => {
    fc.assert(
      fc.property(rate, periods, principal, (r, n, p) => {
        const result = solveRate(annuityFlows(p, r, n));
        expect(result.ok && !result.multiple).toBe(true);
        expect(Math.abs(rootOf(result) - r)).toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(r)));
      }),
    );
  });

  it('does not depend on the scale, sign convention or order of the flows', () => {
    fc.assert(
      fc.property(
        rate,
        periods,
        fc.double({ min: 1e-6, max: 1e6, noNaN: true }),
        fc.boolean(),
        (r, n, scale, negate) => {
          const flows = annuityFlows(1000, r, n);
          const base = rootOf(solveRate(flows));
          const factor = negate ? -scale : scale;
          const transformed = [...flows]
            .reverse()
            .map((flow) => ({ t: flow.t, amount: flow.amount * factor }));
          const other = rootOf(solveRate(transformed));
          expect(Math.abs(other - base)).toBeLessThanOrEqual(4e-12 * Math.max(1, Math.abs(base)));
        },
      ),
    );
  });
});

describe('NaN never becomes a root', () => {
  it('refineRoot gives up when an evaluation inside the bracket is NaN', () => {
    expect(refineRoot((x) => (x === -1 || x === 1 ? x : Number.NaN), -1, 1, -1, 1)).toBeNull();
  });

  it('solveSingleRoot gives up when an end of the bracket evaluates to NaN', () => {
    expect(solveSingleRoot(() => Number.NaN)).toBeNull();
    expect(solveSingleRoot((x) => (x < 0 ? -1 : Number.NaN))).toBeNull();
  });
});
