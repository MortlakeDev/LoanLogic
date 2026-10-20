// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { type LocalDate, parseIsoDate } from '../date';
import { parseDecimal } from '../rational';
import type { CashFlow, RateFailure, RateMetric } from '../types';
import { regZSinglePayment, singlePaymentFlows } from './us-regz';

function date(text: string): LocalDate {
  const parsed = parseIsoDate(text);
  if (parsed === undefined) {
    throw new Error(`bad date ${text}`);
  }
  return parsed;
}

function flows(start: string, advance: string, end: string, payment: string): CashFlow[] {
  return [
    { date: date(start), amount: parseDecimal(advance), period: 0 },
    { date: date(end), amount: parseDecimal(payment), period: 1 },
  ];
}

function metric(result: RateMetric | RateFailure): RateMetric {
  if ('ok' in result) {
    throw new Error('expected a metric');
  }
  return result;
}

/** Root of `(1 + f·i)(1 + i)^t = ratio` for t = 1 (a quadratic). */
function oneYearRoot(f: number, ratio: number): number {
  if (f === 0) {
    return ratio - 1;
  }
  const b = 1 + f;
  const c = 1 - ratio;
  return (-b + Math.sqrt(b * b - 4 * f * c)) / (2 * f);
}

describe('regZSinglePayment (SPEC §9.3 a)', () => {
  it('uses 365/days for a term that is not a whole number of months', () => {
    // 300.00 with 45.00 added, repaid as 345.00 after 14 days: 15 % × 365/14.
    const apr = metric(regZSinglePayment(flows('2026-03-02', '300.00', '2026-03-16', '-345.00')));
    expect(Math.abs(apr.value - (15 * 365) / 14)).toBeLessThanOrEqual(1e-12);
    expect(apr.display).toBe('391.071');
    expect(apr.precision).toBe(3);
    expect('warnings' in apr).toBe(false);
    expect(apr.explain).toEqual({
      formulaId: 'rate.regz-single-payment',
      values: {
        Af: '300',
        P: '345',
        days: '14',
        months: '0',
        unitPeriodsPerYear: '26.071428571428571429',
        i: '0.15',
      },
    });
  });

  it('uses 12/M for a whole number of months', () => {
    const apr = metric(regZSinglePayment(flows('2026-01-10', '1000', '2026-02-10', '-1010')));
    expect(apr.value).toBe(12);
    expect(apr.display).toBe('12.000');
    expect(apr.explain.values).toMatchObject({
      days: '31',
      months: '1',
      unitPeriodsPerYear: '12',
      i: '0.01',
    });

    const quarter = metric(regZSinglePayment(flows('2026-01-15', '1000', '2026-04-15', '-1020')));
    expect(quarter.value).toBe(8);
    expect(quarter.explain.values).toMatchObject({ months: '3', unitPeriodsPerYear: '4' });

    const fiveMonths = metric(
      regZSinglePayment(flows('2026-01-15', '1000', '2026-06-15', '-1050')),
    );
    expect(fiveMonths.value).toBe(12);
    expect(fiveMonths.explain.values.unitPeriodsPerYear).toBe('2.4');

    const elevenMonths = metric(
      regZSinglePayment(flows('2026-01-15', '1000', '2026-12-15', '-1110')),
    );
    expect(Math.abs(elevenMonths.value - (11 * 12) / 11)).toBeLessThanOrEqual(1e-12);
  });

  it('measures months back from the payment date with its own day of month', () => {
    // 31 January → 28 February is 28 days, not a month (SPEC v0.2.1).
    const short = metric(regZSinglePayment(flows('2026-01-31', '1000', '2026-02-28', '-1010')));
    expect(Math.abs(short.value - (365 / 28) * 1)).toBeLessThanOrEqual(1e-12);
    expect(short.explain.values).toMatchObject({ days: '28', months: '0' });
    // 28 February → 31 March is one whole month.
    const month = metric(regZSinglePayment(flows('2026-02-28', '1000', '2026-03-31', '-1010')));
    expect(month.value).toBe(12);
    expect(month.explain.values).toMatchObject({ days: '31', months: '1' });
  });

  it('uses a one-year unit-period for a term of whole years', () => {
    // PBOC annex example 1: 100 000 → 110 000 after 2 years.
    const apr = metric(regZSinglePayment(flows('2021-04-15', '100000', '2023-04-15', '-110000')));
    expect(Math.abs(apr.value - (Math.sqrt(1.1) - 1) * 100)).toBeLessThanOrEqual(1e-9);
    expect(apr.display).toBe('4.881');
    expect(apr.explain.values).toMatchObject({
      Af: '100000',
      P: '110000',
      days: '0',
      months: '0',
      unitPeriodsPerYear: '1',
      t: '2',
      f: '0',
    });
    expect(Math.abs(Number(apr.explain.values.i) - (Math.sqrt(1.1) - 1))).toBeLessThanOrEqual(
      1e-12,
    );
  });

  it('adds the remaining whole months as f = M/12', () => {
    const apr = metric(regZSinglePayment(flows('2025-01-15', '1000', '2026-04-15', '-1100')));
    expect(Math.abs(apr.value / 100 - oneYearRoot(0.25, 1.1))).toBeLessThanOrEqual(1e-12);
    expect(apr.explain.values).toMatchObject({ t: '1', f: '0.25', months: '3', days: '90' });
  });

  it('adds the remaining days as f = days/365 when they are not whole months', () => {
    // 31 Jan 2025 → 28 Feb 2026: one year back is 28 Feb 2025; 28 days remain.
    const apr = metric(regZSinglePayment(flows('2025-01-31', '1000', '2026-02-28', '-1100')));
    expect(Math.abs(apr.value / 100 - oneYearRoot(28 / 365, 1.1))).toBeLessThanOrEqual(1e-12);
    expect(apr.explain.values).toMatchObject({ t: '1', months: '0', days: '28' });
    expect(Number(apr.explain.values.f)).toBeCloseTo(28 / 365, 15);
  });

  it('counts a remainder of 365 days in a leap year as f = 1, not a full year', () => {
    // From 2 Mar 2027, two years back from 1 Mar 2029 is 1 Mar 2027 (too early): t = 1,
    // and 2 Mar 2027 → 1 Mar 2028 is 365 days.
    const apr = metric(regZSinglePayment(flows('2027-03-02', '1000', '2029-03-01', '-1210')));
    expect(apr.explain.values).toMatchObject({ t: '1', f: '1', days: '365' });
    expect(Math.abs(apr.value / 100 - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('handles exactly one year and negative growth', () => {
    const year = metric(regZSinglePayment(flows('2025-03-01', '1000', '2026-03-01', '-1065')));
    expect(Math.abs(year.value - 6.5)).toBeLessThanOrEqual(1e-9);
    const negative = metric(regZSinglePayment(flows('2026-01-10', '1000', '2026-02-10', '-990')));
    expect(negative.value).toBe(-12);
    expect(negative.display).toBe('-12.000');
    const zero = metric(regZSinglePayment(flows('2026-01-10', '1000', '2026-02-10', '-1000')));
    expect(zero.display).toBe('0.000');
  });

  it('accepts the lender view (signs swapped)', () => {
    const apr = metric(regZSinglePayment(flows('2026-03-02', '-300', '2026-03-16', '345')));
    expect(apr.display).toBe('391.071');
  });

  it('fails when the amounts do not have opposite signs', () => {
    const failure = { ok: false, reason: 'IRR_NO_CONVERGENCE' };
    expect(regZSinglePayment(flows('2026-01-15', '100', '2026-02-15', '10'))).toEqual(failure);
    expect(regZSinglePayment(flows('2026-01-15', '0', '2026-02-15', '-10'))).toEqual(failure);
    expect(regZSinglePayment(flows('2026-01-15', '100', '2026-02-15', '0'))).toEqual(failure);
  });

  it('fails when the year-or-more equation has no root in [−0.99, 1e7]', () => {
    const failure = { ok: false, reason: 'IRR_NO_CONVERGENCE' };
    expect(regZSinglePayment(flows('2025-01-15', '1', '2026-01-15', '-100000000'))).toEqual(
      failure,
    );
    expect(regZSinglePayment(flows('2024-01-15', '1000', '2026-01-15', '-0.01'))).toEqual(failure);
  });

  it('rejects anything but two flows with a later payment', () => {
    const two = flows('2026-01-15', '100', '2026-02-15', '-101');
    expect(() => regZSinglePayment(two.slice(0, 1))).toThrow(RangeError);
    expect(() => regZSinglePayment([...two, ...two])).toThrow(RangeError);
    expect(() => regZSinglePayment(flows('2026-01-15', '100', '2026-01-15', '-101'))).toThrow(
      RangeError,
    );
  });
});

describe('singlePaymentFlows (SPEC v0.2.2 §9.3 a)', () => {
  const at = (day: string, amount: string): CashFlow => ({
    date: date(day),
    amount: parseDecimal(amount),
  });

  it('sums the flows per date and keeps exactly two non-zero dates', () => {
    const pair = singlePaymentFlows([
      at('2026-01-01', '-10'),
      at('2026-01-01', '310'),
      at('2026-01-15', '-345'),
    ]);
    expect(pair?.map((flow) => [flow.date, flow.amount])).toEqual([
      [date('2026-01-01'), parseDecimal('300')],
      [date('2026-01-15'), parseDecimal('-345')],
    ]);
  });

  it('drops dates whose flows sum to zero (zero interim payments, an offsetting fee)', () => {
    expect(
      singlePaymentFlows([
        at('2026-01-01', '1000'),
        at('2026-02-01', '0.00'),
        at('2026-03-01', '25'),
        at('2026-03-01', '-25'),
        at('2026-04-01', '-1100'),
      ])?.map((flow) => flow.date),
    ).toEqual([date('2026-01-01'), date('2026-04-01')]);
  });

  it('returns null unless exactly two dates remain', () => {
    expect(singlePaymentFlows([at('2026-01-01', '1000'), at('2026-01-01', '-1000')])).toBeNull();
    expect(
      singlePaymentFlows([
        at('2026-01-01', '1000'),
        at('2026-02-01', '-500'),
        at('2026-03-01', '-520'),
      ]),
    ).toBeNull();
    expect(singlePaymentFlows([])).toBeNull();
  });
});

describe('regZSinglePayment: ranges (SPEC v0.2.2 §9.3 a, §10)', () => {
  const failure = { ok: false, reason: 'IRR_NO_CONVERGENCE' };

  it('fails when the unit-period rate is below −99 % or above 1e7', () => {
    // 100 → 0.50 after a month: i = −99.5 %, outside [−0.99, 1e7].
    expect(regZSinglePayment(flows('2026-01-15', '100', '2026-02-15', '-0.50'))).toEqual(failure);
    // Exactly −99 % is inside: APR = −0.99 × 12 = −1 188 %.
    expect(
      metric(regZSinglePayment(flows('2026-01-15', '100', '2026-02-15', '-1'))).value,
    ).toBeCloseTo(-1188, 9);
    // i = 1e7 + 1 after a month is outside; 1e7 is the edge.
    expect(regZSinglePayment(flows('2026-01-15', '1', '2026-02-15', '-10000002'))).toEqual(failure);
  });

  it('fails when the APR leaves ±10⁹ % although the unit-period rate is in range', () => {
    // i = 1e6 over one day: APR = 1e6 × 365 = 3.65e8 = 3.65e10 % > 1e9 %.
    expect(regZSinglePayment(flows('2026-01-15', '1', '2026-01-16', '-1000001'))).toEqual(failure);
    // i = 2 000 over 3 days: APR = 2 000 × 365/3 ≈ 2.4e7 % — within range.
    expect(
      metric(regZSinglePayment(flows('2026-01-15', '1', '2026-01-18', '-2001'))).value,
    ).toBeCloseTo((2000 * 365 * 100) / 3, 4);
  });
});
