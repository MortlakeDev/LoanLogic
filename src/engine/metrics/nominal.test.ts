// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { div, fromInteger, parseDecimal } from '../rational';
import { nominalMetric } from './nominal';
import type { ContractRate } from './types';

function contract(annualRatePct: string): ContractRate {
  return {
    annualRatePct,
    rate: div(parseDecimal(annualRatePct), fromInteger(100)),
    frequency: 'monthly',
    accrual: { mode: 'periodic', compounding: 'monthly' },
  };
}

describe('nominalMetric (SPEC §9.2)', () => {
  it('shows the rate as entered with at least two decimals', () => {
    expect(nominalMetric(contract('6.875'))).toEqual({
      value: 6.875,
      display: '6.875',
      precision: 3,
      explain: { formulaId: 'rate.nominal', values: { j: '0.06875' } },
    });
    expect(nominalMetric(contract('12'))).toMatchObject({
      value: 12,
      display: '12.00',
      precision: 2,
    });
    expect(nominalMetric(contract('3.10'))).toMatchObject({
      value: 3.1,
      display: '3.10',
      explain: { values: { j: '0.031' } },
    });
  });

  it('handles negative and zero rates', () => {
    expect(nominalMetric(contract('-0.5'))).toMatchObject({
      value: -0.5,
      display: '-0.50',
      explain: { values: { j: '-0.005' } },
    });
    const zero = nominalMetric(contract('-0'));
    expect(Object.is(zero.value, 0)).toBe(true);
    expect(zero.display).toBe('0.00');
    expect(zero.explain.values.j).toBe('0');
  });

  it('never carries warnings', () => {
    expect('warnings' in nominalMetric(contract('999.99'))).toBe(false);
  });
});
