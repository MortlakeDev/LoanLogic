// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { div, fromInteger, parseDecimal } from '../rational';
import type {
  Accrual,
  CompoundingId,
  DayCountId,
  FrequencyId,
  RateFailure,
  RateMetric,
} from '../types';
import { effectiveMetric } from './effective';

function metricOf(annualRatePct: string, frequency: FrequencyId, accrual: Accrual): RateMetric {
  const result: RateMetric | RateFailure = effectiveMetric({
    annualRatePct,
    rate: div(parseDecimal(annualRatePct), fromInteger(100)),
    frequency,
    accrual,
  });
  if ('ok' in result) {
    throw new Error('expected a metric');
  }
  return result;
}

function periodic(compounding: CompoundingId): Accrual {
  return { mode: 'periodic', compounding };
}

function daycount(method: DayCountId): Accrual {
  return { mode: 'daycount', method, paymentBasis: 'nominal' };
}

function closeTo(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(expected)));
}

describe('effectiveMetric (SPEC §9.2)', () => {
  it('compounds the periodic rate c times a year', () => {
    const metric = metricOf('6.5', 'monthly', periodic('monthly'));
    closeTo(metric.value, ((1 + 0.065 / 12) ** 12 - 1) * 100);
    expect(metric.display).toBe('6.70');
    expect(metric.precision).toBe(2);
    expect(metric.explain).toEqual({
      formulaId: 'rate.effective',
      values: { j: '0.065', c: '12' },
    });
  });

  it('uses the compounding frequency, not the payment frequency', () => {
    const metric = metricOf('5.29', 'monthly', periodic('semiannual'));
    closeTo(metric.value, ((1 + 0.0529 / 2) ** 2 - 1) * 100);
    expect(metric.display).toBe('5.36');
    expect(metric.explain.values).toEqual({ j: '0.0529', c: '2' });
  });

  it('uses e^j − 1 for continuous compounding', () => {
    const metric = metricOf('8', 'monthly', periodic('continuous'));
    closeTo(metric.value, Math.expm1(0.08) * 100);
    expect(metric.display).toBe('8.33');
    expect(metric.explain.values).toEqual({ j: '0.08', c: 'continuous' });
  });

  it('uses a 365-day year of ACT/360 interest in day-count mode', () => {
    const metric = metricOf('7.25', 'monthly', daycount('act-360'));
    closeTo(metric.value, ((1 + (0.0725 * 365) / 360 / 12) ** 12 - 1) * 100);
    expect(metric.display).toBe('7.60');
    expect(metric.explain).toEqual({
      formulaId: 'rate.effective',
      values: { j: '0.0725', m: '12', k: '1.0138888888888888889' },
    });
  });

  it('uses k = 1 for every other day-count method, compounding m times', () => {
    for (const method of [
      '30u-360',
      '30-360-isda',
      '30e-360',
      'act-365f',
      'act-act-isda',
    ] as const) {
      const metric = metricOf('6.1', 'quarterly', daycount(method));
      closeTo(metric.value, ((1 + 0.061 / 4) ** 4 - 1) * 100);
      expect(metric.explain.values).toEqual({ j: '0.061', m: '4', k: '1' });
    }
  });

  it('is exactly 0 for j = 0 with every accrual', () => {
    const accruals: Accrual[] = [
      periodic('monthly'),
      periodic('semiannual'),
      periodic('continuous'),
      daycount('act-360'),
      daycount('act-365f'),
    ];
    for (const accrual of accruals) {
      const metric = metricOf('0', 'monthly', accrual);
      expect(Object.is(metric.value, 0)).toBe(true);
      expect(metric.display).toBe('0.00');
    }
  });

  it('handles negative and very high rates', () => {
    const negative = metricOf('-0.5', 'monthly', periodic('monthly'));
    expect(negative.display).toBe('-0.50');
    const high = metricOf('390', 'weekly', periodic('weekly'));
    closeTo(high.value, ((1 + 3.9 / 52) ** 52 - 1) * 100);
    expect(high.display).toBe('4197.74');
  });

  it('keeps full precision for rates with many decimals and weekly compounding', () => {
    const metric = metricOf('123.456789012', 'weekly', periodic('weekly'));
    closeTo(metric.value, Math.expm1(52 * Math.log1p(1.23456789012 / 52)) * 100);
  });

  it('agrees with the double formula for every valid periodic input', () => {
    const perYear: Readonly<Record<FrequencyId, number>> = {
      weekly: 52,
      biweekly: 26,
      monthly: 12,
      quarterly: 4,
      semiannual: 2,
      annual: 1,
    };
    const compoundings = Object.keys(perYear) as FrequencyId[];
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 100000 }),
        fc.constantFrom(...compoundings),
        (hundredths, compounding) => {
          const pct = (hundredths / 100).toFixed(2);
          const c = perYear[compounding];
          const j = hundredths / 10000;
          const metric = metricOf(pct, 'monthly', periodic(compounding));
          expect(
            Math.abs(metric.value - Math.expm1(c * Math.log1p(j / c)) * 100),
          ).toBeLessThanOrEqual(1e-11 * Math.max(1, Math.abs(metric.value)));
        },
      ),
    );
  });
});
