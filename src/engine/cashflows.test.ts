// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { cashFlowMethods, computeCashFlowRates } from './cashflows';
import { addDays, parseIsoDate } from './date';
import { isFrequencyId } from './frequency';
import { parseDecimal } from './rational';
import {
  type CashFlow,
  type CashFlowTerms,
  type RateFailure,
  type RateMetric,
  type Rates,
  RATE_METHOD_IDS,
} from './types';

interface ExpectedRate {
  readonly value?: string;
  readonly display?: string;
  readonly precision?: number;
  readonly warnings?: readonly string[];
  readonly ok?: false;
  readonly reason?: string;
}

interface CashFlowVector {
  readonly id: string;
  readonly kind: string;
  readonly input: {
    readonly frequency?: string;
    readonly flows: readonly {
      readonly date: string;
      readonly amount: string;
      readonly period?: number;
    }[];
  };
  readonly expected: {
    readonly ok: boolean;
    readonly rates?: Readonly<Record<string, ExpectedRate>>;
  };
}

const FILES = import.meta.glob<unknown>('../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

function isCashFlowVector(value: unknown): value is CashFlowVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'cashflows' &&
    'expected' in value &&
    typeof value.expected === 'object' &&
    value.expected !== null &&
    'ok' in value.expected &&
    value.expected.ok === true
  );
}

const VECTORS: readonly CashFlowVector[] = Object.values(FILES)
  .filter(isCashFlowVector)
  .sort((a, b) => a.id.localeCompare(b.id));

/** Builds validated terms by hand from a vector's (valid) input. */
function termsOf(vector: CashFlowVector): CashFlowTerms {
  const { frequency } = vector.input;
  const flows: CashFlow[] = vector.input.flows.map((flow) => {
    const date = parseIsoDate(flow.date);
    if (date === undefined) {
      throw new Error(`bad date ${flow.date}`);
    }
    const amount = parseDecimal(flow.amount);
    return flow.period === undefined ? { date, amount } : { date, amount, period: flow.period };
  });
  return {
    frequency: frequency !== undefined && isFrequencyId(frequency) ? frequency : null,
    hasPeriods: flows.every((flow) => flow.period !== undefined),
    flows,
  };
}

function isFailure(rate: RateMetric | RateFailure): rate is RateFailure {
  return 'ok' in rate;
}

/** SPEC §14 comparison of one rate. */
function expectRate(actual: RateMetric | RateFailure | undefined, expected: ExpectedRate): void {
  expect(actual).toBeDefined();
  if (actual === undefined) {
    return;
  }
  if (expected.ok === false) {
    expect(actual).toEqual({ ok: false, reason: expected.reason });
    return;
  }
  expect(isFailure(actual)).toBe(false);
  if (isFailure(actual)) {
    return;
  }
  const value = Number(expected.value);
  expect(Math.abs(actual.value - value)).toBeLessThanOrEqual(
    Math.max(1e-7, 1e-9 * Math.abs(value)),
  );
  expect(actual.display).toBe(expected.display);
  expect(actual.precision).toBe(expected.precision);
  expect([...(actual.warnings ?? [])].sort()).toEqual([...(expected.warnings ?? [])].sort());
}

function expectRates(rates: Rates, expected: Readonly<Record<string, ExpectedRate>>): void {
  expect(Object.keys(rates)).toEqual(Object.keys(expected));
  for (const [method, rate] of Object.entries(expected)) {
    expectRate(rates[method as keyof Rates], rate);
  }
}

describe('cash-flow golden vectors (SPEC §9.7, §14)', () => {
  it('has the vectors this suite checks', () => {
    const ids = VECTORS.map((vector) => vector.id);
    for (const id of [
      'cashflows-close-roots',
      'cashflows-irregular-aprc-backward-counting',
      'cashflows-multiple-irr',
      'cashflows-no-root',
      'cashflows-same-date-flows',
      'cn-pboc-annex-fee-loan',
      'cn-pboc-annex-lump-sum-2y',
      'cn-pboc-annex-mortgage-20y',
      'e4-pboc-annualized-rate',
      'xirr-excel-documentation-example',
    ]) {
      expect(ids).toContain(id);
    }
  });

  for (const vector of VECTORS) {
    it(vector.id, () => {
      const rates = computeCashFlowRates(termsOf(vector));
      expectRates(rates, vector.expected.rates ?? {});
    });
  }
});

describe('cashFlowMethods (SPEC §9.7)', () => {
  const date = { y: 2026, m: 1, d: 15 };
  const later = { y: 2026, m: 2, d: 15 };
  const flows: CashFlow[] = [
    { date, amount: parseDecimal('100'), period: 0 },
    { date: later, amount: parseDecimal('-101'), period: 1 },
  ];

  it('computes only the XIRR family without a frequency', () => {
    expect(cashFlowMethods({ frequency: null, hasPeriods: false, flows })).toEqual([
      'xirr',
      'uaRealAnnual',
      'international',
    ]);
  });

  it('adds every periodic metric with a frequency and periods, in RATE_METHOD_IDS order', () => {
    expect(cashFlowMethods({ frequency: 'monthly', hasPeriods: true, flows })).toEqual([
      'irrNominal',
      'irrEffective',
      'xirr',
      'usRegZApr',
      'ukAprc',
      'euAprc',
      'cnAnnualized',
      'uaRealAnnual',
      'international',
    ]);
  });

  it('adds only the backward-counted APRCs with a frequency and no periods', () => {
    expect(cashFlowMethods({ frequency: 'weekly', hasPeriods: false, flows })).toEqual([
      'xirr',
      'ukAprc',
      'euAprc',
      'uaRealAnnual',
      'international',
    ]);
  });

  it('never computes nominal or effective', () => {
    for (const terms of [
      { frequency: null, hasPeriods: false, flows },
      { frequency: 'annual' as const, hasPeriods: true, flows },
      { frequency: 'annual' as const, hasPeriods: false, flows },
    ]) {
      const methods = cashFlowMethods(terms);
      expect(methods).not.toContain('nominal');
      expect(methods).not.toContain('effective');
      expect(methods).toEqual(RATE_METHOD_IDS.filter((id) => methods.includes(id)));
    }
  });
});

describe('computeCashFlowRates', () => {
  it('computes the XIRR family only, without a frequency', () => {
    const rates = computeCashFlowRates({
      frequency: null,
      hasPeriods: false,
      flows: [
        { date: { y: 2026, m: 1, d: 1 }, amount: parseDecimal('1000') },
        { date: { y: 2027, m: 1, d: 1 }, amount: parseDecimal('-1100') },
      ],
    });
    expect(Object.keys(rates)).toEqual(['xirr', 'uaRealAnnual', 'international']);
    const xirr = rates.xirr;
    expect(xirr !== undefined && !isFailure(xirr) && xirr.display).toBe('10.00');
  });

  it('is not misled by zero amounts at the first or the last date', () => {
    const start = { y: 2026, m: 1, d: 1 };
    const flow = (period: number, amount: string): CashFlow => ({
      date: addDays(start, 7 * period),
      amount: parseDecimal(amount),
      period,
    });
    // r = 10 % per week in both lists; a zero far from the other flows must not create a
    // root at −99 % or 100 % through underflow.
    for (const flows of [
      [flow(0, '1000'), flow(1, '-1100'), flow(1200, '0')],
      [flow(0, '0'), flow(1100, '1000'), flow(1101, '-1100')],
    ]) {
      const rates = computeCashFlowRates({ frequency: 'weekly', hasPeriods: true, flows });
      for (const method of ['irrNominal', 'cnAnnualized'] as const) {
        const rate = rates[method];
        expect(rate !== undefined && !isFailure(rate) && rate.value).toBeCloseTo(520, 8);
      }
      // Summed per date with the zero sum dropped, two dates remain: the US APR uses the
      // single-payment rule, 10 % × 365/7 (SPEC v0.2.2 §9.3 a).
      const apr = rates.usRegZApr;
      expect(apr !== undefined && !isFailure(apr) && apr.value).toBeCloseTo((10 * 365) / 7, 8);
      const effective = rates.irrEffective;
      expect(effective !== undefined && !isFailure(effective) && effective.value / 100).toBeCloseTo(
        1.1 ** 52 - 1,
        6,
      );
    }
  });

  it('uses the single-payment Reg Z rule for two flows with periods', () => {
    // Weekly: 7 days, i = 1 % → APR = 1 % × 365/7 (not × 52).
    const rates = computeCashFlowRates({
      frequency: 'weekly',
      hasPeriods: true,
      flows: [
        { date: { y: 2026, m: 3, d: 2 }, amount: parseDecimal('100'), period: 0 },
        { date: { y: 2026, m: 3, d: 9 }, amount: parseDecimal('-101'), period: 1 },
      ],
    });
    const apr = rates.usRegZApr;
    expect(apr !== undefined && !isFailure(apr) && apr.value).toBeCloseTo((365 / 7) * 1, 9);
    const nominal = rates.irrNominal;
    expect(nominal !== undefined && !isFailure(nominal) && nominal.value).toBeCloseTo(52, 9);
  });
});
