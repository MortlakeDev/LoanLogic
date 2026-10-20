// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Root finding for rate metrics (SPEC §10). Rates are solved in IEEE doubles (SPEC §0.2):
 * the equation `Σ a_k (1 + x)^−t_k = 0` is searched in `[−0.99, 1e7]`, with the number of
 * sign changes of the time-aggregated flows deciding between a single bracketed root and
 * an enumeration of several roots on a fixed grid. Every root is refined with Brent's
 * method and accepted only when its bracket is no wider than `1e−12 × max(1, |x|)`; the
 * size of `f` is never a stopping criterion because it does not bound the rate's error.
 */

/** One cash flow of a rate equation: time `t ≥ 0` (periods or years) and amount (double). */
export interface SolverFlow {
  readonly t: number;
  readonly amount: number;
}

/**
 * Outcome of a rate solve: the chosen root and whether two or more roots were found
 * (`IRR_MULTIPLE`), or a failure (`IRR_NO_CONVERGENCE`).
 */
export type SolveResult =
  { readonly ok: true; readonly root: number; readonly multiple: boolean } | { readonly ok: false };

/** Lower end of the search range: −99 % (SPEC §10). */
export const RATE_SEARCH_MIN = -0.99;

/** Upper end of the search range: 10⁹ % (SPEC §10). */
export const RATE_SEARCH_MAX = 1e7;

/** Relative bracket width at which a root is accepted (SPEC §10). */
const WIDTH_FACTOR = 1e-12;

/** Brent iterations before a refinement gives up (failure, never a guess). */
const DEFAULT_MAX_ITERATIONS = 300;

/** Spacing of the fine grid on `[−0.99, 1)` (SPEC §10). */
const FINE_GRID_STEPS_PER_UNIT = 2000;

/** Ratio of the geometric grid on `[1, 1e7)` (SPEC §10). */
const COARSE_GRID_RATIO = 1.05;

/** The widest bracket that is accepted around a root near `x`: `1e−12 × max(1, |x|)`. */
export function bracketTolerance(x: number): number {
  return WIDTH_FACTOR * Math.max(1, Math.abs(x));
}

/** −1, 0 or 1; distinguishes nothing finer than the sign. */
function signOf(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * Refines a root of `fn` inside `[lo, hi]` with Brent's method (inverse quadratic and
 * secant steps that fall back to bisection). `fn(lo)` and `fn(hi)` must have strictly
 * opposite signs.
 *
 * Stops only when the bracket around the best estimate `b` is no wider than
 * `1e−12 × max(1, |b|)` (SPEC §10). An evaluation that is exactly zero collapses the
 * bracket to that point, which satisfies the same rule. Returns `null` when the bracket
 * has not become narrow enough after `maxIterations` evaluations.
 *
 * @param fn Continuous function of the rate (a double); may be scaled by any positive
 *   factor, only its sign and shape matter.
 * @param lo Lower end of the bracket.
 * @param hi Upper end of the bracket.
 * @param fLo `fn(lo)`, already evaluated.
 * @param fHi `fn(hi)`, already evaluated.
 * @param maxIterations Evaluation budget (default 300).
 * @throws RangeError if `fLo` and `fHi` do not have strictly opposite signs.
 */
export function refineRoot(
  fn: (x: number) => number,
  lo: number,
  hi: number,
  fLo: number,
  fHi: number,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): number | null {
  if (signOf(fLo) * signOf(fHi) >= 0) {
    throw new RangeError('refineRoot needs a bracket with strictly opposite signs');
  }
  // b is the best estimate, c the contrapoint (f(b) and f(c) have opposite signs), a the
  // previous b. d is the last step, e the step before it.
  let a = lo;
  let fa = fLo;
  let b = hi;
  let fb = fHi;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iteration = 0; iteration <= maxIterations; iteration += 1) {
    if (Number.isNaN(fb)) {
      return null;
    }
    if (fb === 0) {
      return b;
    }
    if (signOf(fb) === signOf(fc)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    // Half of the accepted width: the bracket [b, c] is done when |c − b| ≤ 2·tol.
    const tol = 0.5 * bracketTolerance(b);
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol) {
      return b;
    }
    if (iteration === maxIterations) {
      break;
    }
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) {
        q = -q;
      } else {
        p = -p;
      }
      // Accept the interpolation only when it stays well inside the bracket and shrinks
      // faster than bisection would; NaN comparisons are false and fall back to bisection.
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = fn(b);
  }
  return null;
}

/**
 * Finds the root of a function with exactly one sign change on the search range
 * (SPEC §10, "One"): bracket `[−0.99, 1]`; while `fn` has the same sign at both ends,
 * double the upper end, at most up to 1e7; then refine with `refineRoot`. Returns `null`
 * when no sign change is found in `[−0.99, 1e7]` or the refinement does not converge.
 *
 * @param fn Function of the rate (a double) with at most one root on the range.
 */
export function solveSingleRoot(fn: (x: number) => number): number | null {
  const lo = RATE_SEARCH_MIN;
  const fLo = fn(lo);
  if (Number.isNaN(fLo)) {
    return null;
  }
  if (fLo === 0) {
    return lo;
  }
  let hi = 1;
  let fHi = fn(hi);
  while (signOf(fHi) === signOf(fLo) && hi < RATE_SEARCH_MAX) {
    hi = Math.min(2 * hi, RATE_SEARCH_MAX);
    fHi = fn(hi);
  }
  if (fHi === 0) {
    return hi;
  }
  if (Number.isNaN(fHi) || signOf(fHi) === signOf(fLo)) {
    return null;
  }
  return refineRoot(fn, lo, hi, fLo, fHi);
}

/** A time with the sum of the amounts at that time. */
interface Group {
  readonly t: number;
  readonly amount: number;
}

/** Sums flows with equal times (SPEC §10) and orders the groups by time. */
function aggregate(flows: readonly SolverFlow[]): Group[] {
  const sums = new Map<number, number>();
  for (const flow of flows) {
    if (!Number.isFinite(flow.t) || flow.t < 0 || !Number.isFinite(flow.amount)) {
      throw new RangeError(
        `Solver flows need a finite time ≥ 0 and a finite amount, got t=${String(flow.t)}, amount=${String(flow.amount)}`,
      );
    }
    // Normalizes −0 so that both zeros are one time.
    const t = flow.t === 0 ? 0 : flow.t;
    sums.set(t, (sums.get(t) ?? 0) + flow.amount);
  }
  return [...sums.entries()].map(([t, amount]) => ({ t, amount })).sort((x, y) => x.t - y.t);
}

/** Sign changes of the group sums in time order, zeros skipped (SPEC §10). */
function countSignChanges(groups: readonly Group[]): number {
  let changes = 0;
  let previous: -1 | 0 | 1 = 0;
  for (const group of groups) {
    const current = signOf(group.amount);
    if (current !== 0) {
      if (previous !== 0 && current !== previous) {
        changes += 1;
      }
      previous = current;
    }
  }
  return changes;
}

/**
 * The present value `Σ a_k (1 + x)^−t_k` times a positive factor, so with the same sign
 * and the same roots: `(1 + x)^{t_max}` when `x < 0` (SPEC §10, "Overflow") and
 * `(1 + x)^{t_min}` when `x ≥ 0`, with `t_max` and `t_min` the latest and earliest times
 * whose sum is not zero. Every term is then at most its amount, and the term at `t_max`
 * (or `t_min`) keeps its full size: a sum of zero at a late time (or at time 0 before
 * late flows) would otherwise let every other term underflow to 0 and make `f` exactly 0
 * at a point that is not a root. With the usual nonzero flow at time 0, `t_min = 0` and
 * nothing is scaled for `x ≥ 0`. Powers are evaluated as `exp(−t · log1p(x))`, accurate
 * for small `x`; the sum is compensated (Neumaier) because it cancels to zero at the root.
 */
function presentValueFunction(groups: readonly Group[]): (x: number) => number {
  // Zero sums contribute nothing; they must not choose the scale.
  const terms = groups.filter((group) => group.amount !== 0);
  const tMin = terms.reduce((min, group) => Math.min(min, group.t), Number.POSITIVE_INFINITY);
  const tMax = terms.reduce((max, group) => Math.max(max, group.t), 0);
  return (x: number): number => {
    const logGrowth = Math.log1p(x);
    const shift = x < 0 ? tMax : tMin;
    let sum = 0;
    let compensation = 0;
    for (const group of terms) {
      const term = group.amount * Math.exp((shift - group.t) * logGrowth);
      const next = sum + term;
      compensation += Math.abs(sum) >= Math.abs(term) ? sum - next + term : term - next + sum;
      sum = next;
    }
    return sum + compensation;
  };
}

/**
 * The enumeration grid of SPEC §10: `−0.99 + k/2000` while below 1, then `1.05^k` while
 * below 1e7, then 1e7. Each point is computed from `k` directly, so no error accumulates.
 */
function enumerationGrid(): number[] {
  const grid: number[] = [];
  for (let k = 0; ; k += 1) {
    const x = RATE_SEARCH_MIN + k / FINE_GRID_STEPS_PER_UNIT;
    if (x >= 1) {
      break;
    }
    grid.push(x);
  }
  for (let k = 0; ; k += 1) {
    const x = COARSE_GRID_RATIO ** k;
    if (x >= RATE_SEARCH_MAX) {
      break;
    }
    grid.push(x);
  }
  grid.push(RATE_SEARCH_MAX);
  return grid;
}

/** The grid is the same for every equation; built once. */
const GRID: readonly number[] = Object.freeze(enumerationGrid());

/**
 * Every root found on the grid (SPEC §10, "More than one"): a grid point where `fn` is
 * exactly zero, and one refined root in each cell whose ends have strictly opposite
 * signs. Returns `null` if a refinement does not converge.
 */
function enumerateRoots(fn: (x: number) => number): number[] | null {
  const roots: number[] = [];
  let previousX = Number.NaN;
  let previousF = 0;
  for (const x of GRID) {
    const fx = fn(x);
    if (fx === 0) {
      roots.push(x);
    } else if (signOf(previousF) * signOf(fx) < 0) {
      // previousF is 0 before the first point and after an exact zero: no cell to refine.
      const root = refineRoot(fn, previousX, x, previousF, fx);
      if (root === null) {
        return null;
      }
      roots.push(root);
    }
    previousX = x;
    previousF = fx;
  }
  return roots;
}

/**
 * The smallest non-negative root, else the negative root closest to zero (SPEC §10;
 * MCOB 10.3.1B R(2)). `roots` is not empty.
 */
function chooseRoot(roots: readonly number[]): number {
  const nonNegative = roots.filter((root) => root >= 0);
  return nonNegative.length > 0 ? Math.min(...nonNegative) : Math.max(...roots);
}

/**
 * Solves `Σ a_k (1 + x)^−t_k = 0` for the rate `x` in `[−0.99, 1e7]` (SPEC §10).
 *
 * Flows with equal times are summed first and the signs of the sums are counted in time
 * order, skipping zeros. No sign change: no root (failure). One: the unique root, from the
 * expanding bracket of `solveSingleRoot`. More than one: every root found on the grid of
 * §10; the smallest non-negative one is chosen (else the negative root closest to zero)
 * and `multiple` is true when two or more were found. No root found or a refinement that
 * does not converge: failure.
 *
 * @param flows Times `t ≥ 0` (periods or years, double) and amounts (double, any sign
 *   convention; only relative signs matter).
 * @returns The root as a decimal fraction per unit of `t` (0.05 = 5 %), with the
 *   `multiple` flag, or `{ ok: false }`.
 * @throws RangeError if a time is negative or not finite, or an amount is not finite.
 */
export function solveRate(flows: readonly SolverFlow[]): SolveResult {
  const groups = aggregate(flows);
  const changes = countSignChanges(groups);
  if (changes === 0) {
    return { ok: false };
  }
  const fn = presentValueFunction(groups);
  if (changes === 1) {
    const root = solveSingleRoot(fn);
    return root === null ? { ok: false } : { ok: true, root, multiple: false };
  }
  const roots = enumerateRoots(fn);
  if (roots === null || roots.length === 0) {
    return { ok: false };
  }
  return { ok: true, root: chooseRoot(roots), multiple: roots.length >= 2 };
}
