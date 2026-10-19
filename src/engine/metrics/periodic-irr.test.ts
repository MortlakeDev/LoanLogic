// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { fromInteger, parseDecimal } from '../rational';
import type { CashFlow } from '../types';
import { periodTimes, periodicIrrMetric, solvePeriodicIrr } from './periodic-irr';

const D0 = { y: 2026, m: 1, d: 15 };

function flows(amounts: readonly string[]): CashFlow[] {
  return amounts.map((amount, period) => ({
    date: { y: 2026, m: 1 + period, d: 15 },
    amount: parseDecimal(amount),
    period,
  }));
}

describe('periodTimes', () => {
  it('places each flow at its period index', () => {
    expect(periodTimes(flows(['100', '-50', '-55'])).map((flow) => flow.time)).toEqual([
      fromInteger(0),
      fromInteger(1),
      fromInteger(2),
    ]);
  });

  it('rejects a flow without a period', () => {
    expect(() => periodTimes([{ date: D0, amount: parseDecimal('1') }])).toThrow(RangeError);
  });
});

describe('solvePeriodicIrr', () => {
  it('solves the rate per period', () => {
    const result = solvePeriodicIrr(flows(['100', '-101']));
    expect(result.ok && Math.abs(result.root - 0.01)).toBeLessThanOrEqual(1e-12);
  });
});

describe('periodicIrrMetric (SPEC §9.2, §9.3)', () => {
  const solved = { ok: true, root: 0.01, multiple: false } as const;

  it('annualizes r simply for irrNominal, cnAnnualized and usRegZApr', () => {
    for (const method of ['irrNominal', 'cnAnnualized', 'usRegZApr'] as const) {
      const metric = periodicIrrMetric(method, solved, 12);
      expect(metric).toMatchObject({
        value: 12,
        explain: { formulaId: 'rate.periodic-irr', values: { r: '0.01', m: '12' } },
      });
    }
    expect(periodicIrrMetric('irrNominal', solved, 12)).toMatchObject({
      display: '12.00',
      precision: 2,
    });
    expect(periodicIrrMetric('usRegZApr', solved, 12)).toMatchObject({
      display: '12.000',
      precision: 3,
    });
  });

  it('compounds r for irrEffective', () => {
    const metric = periodicIrrMetric('irrEffective', solved, 12);
    expect(
      'value' in metric && Math.abs(metric.value - (1.01 ** 12 - 1) * 100),
    ).toBeLessThanOrEqual(1e-12);
    expect(metric).toMatchObject({ display: '12.68' });
  });

  it('carries IRR_MULTIPLE from the solve', () => {
    expect(periodicIrrMetric('irrNominal', { ...solved, multiple: true }, 1)).toMatchObject({
      warnings: ['IRR_MULTIPLE'],
    });
  });

  it('fails with the solve, and when (1 + r)^m exceeds the range of doubles', () => {
    const failure = { ok: false, reason: 'IRR_NO_CONVERGENCE' };
    expect(periodicIrrMetric('irrNominal', { ok: false }, 12)).toEqual(failure);
    expect(periodicIrrMetric('irrEffective', { ok: true, root: 1e7, multiple: false }, 52)).toEqual(
      failure,
    );
    expect(
      periodicIrrMetric('irrNominal', { ok: true, root: 1e7, multiple: false }, 52),
    ).toMatchObject({
      value: 5.2e10,
    });
  });
});
