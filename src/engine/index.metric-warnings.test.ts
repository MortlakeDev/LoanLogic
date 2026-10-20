// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * calculateLoan passes the metric warnings of computeRates through to the result
 * (SPEC §13: IRR_MULTIPLE with params.methods). Since SPEC v0.2.2 a valid loan always has a
 * positive inflow at D0, and no realistic schedule has several rates of return, so the
 * metrics module is wrapped to report one; how IRR_MULTIPLE itself arises is tested in
 * metrics/index.test.ts and by the cash-flow vectors.
 */

import { describe, expect, it, vi } from 'vitest';
import { calculateLoan } from './index';
import type * as MetricsModule from './metrics/index';

vi.mock('./metrics/index', async (importOriginal) => {
  const actual = await importOriginal<typeof MetricsModule>();
  return {
    ...actual,
    computeRates: (request: MetricsModule.RateRequest): MetricsModule.RateOutcome => ({
      ...actual.computeRates(request),
      warnings: [{ code: 'IRR_MULTIPLE', params: { methods: 'irrNominal' } }],
    }),
  };
});

describe('calculateLoan: metric warnings', () => {
  it('appends the warnings of the rate metrics after the input and schedule warnings', () => {
    const result = calculateLoan({
      currency: 'USD',
      amount: '1000.00',
      annualRatePct: '120',
      repayment: 'annuity',
      frequency: 'monthly',
      term: { payments: 360 },
      disbursementDate: '2026-01-15',
      rounding: { payment: 'unit-ceil' },
      rateMethods: ['irrNominal'],
    });
    expect(result.ok && result.warnings).toEqual([
      { code: 'RATE_HIGH', params: { annualRatePct: '120' } },
      {
        code: 'EARLY_CLOSE',
        params: { paymentsCount: expect.any(String) as string, scheduled: '360' },
      },
      { code: 'IRR_MULTIPLE', params: { methods: 'irrNominal' } },
    ]);
  });
});
