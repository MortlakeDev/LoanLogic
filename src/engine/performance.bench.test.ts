// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * Performance budget (T02 brief, PLAN §5.6): a 1 200-period annuity with every rate
 * metric completes in ≤ 50 ms in Node. Run with `npm run bench` (CI runs it on its own,
 * without coverage). The median of several runs after a warm-up is measured, so one slow
 * run on a shared machine does not fail the build.
 */

import { describe, expect, it } from 'vitest';
import { type LoanInput, RATE_METHOD_IDS, calculateLoan } from './index';

const LONG_LOAN: LoanInput = {
  currency: 'USD',
  amount: '500000.00',
  annualRatePct: '6.875',
  repayment: 'annuity',
  frequency: 'monthly',
  term: { payments: 1200 },
  disbursementDate: '2026-01-15',
  fees: [
    {
      id: 'origination',
      kind: 'upfront',
      calc: 'percent',
      value: '1',
      financing: 'paid',
      inApr: true,
    },
    { id: 'insurance', kind: 'insurance', calc: 'pct-balance', value: '0.02', inApr: true },
  ],
};

const BUDGET_MS = 50;

describe('engine performance', () => {
  it(`calculates a 1 200-period annuity with all rate metrics in ≤ ${String(BUDGET_MS)} ms (median)`, () => {
    for (let run = 0; run < 3; run += 1) {
      expect(calculateLoan(LONG_LOAN).ok).toBe(true);
    }
    const times: number[] = [];
    for (let run = 0; run < 9; run += 1) {
      const start = performance.now();
      const result = calculateLoan(LONG_LOAN);
      times.push(performance.now() - start);
      expect(result.ok && result.rows.length === 1200).toBe(true);
      // Every metric must actually be computed: a quick failure would flatter the time.
      if (result.ok) {
        expect(Object.keys(result.rates)).toEqual([...RATE_METHOD_IDS]);
        expect(Object.values(result.rates).every((rate) => !('ok' in rate))).toBe(true);
      }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY;
    // Reported in the test output and in the PR (T02 brief).
    console.info(`1 200-period annuity, all rate metrics: median ${median.toFixed(1)} ms`);
    expect(median).toBeLessThanOrEqual(BUDGET_MS);
  });
});
