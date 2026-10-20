// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * The public API end to end: how calculateLoan assembles warnings and the instalment's
 * explanation, and inputs at the edges of the number ranges (huge fees, tiny rates) that
 * must neither throw nor lose exactness. The golden vectors are in vectors.test.ts.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { type LoanInput, type RateMetric, calculateLoan, computeRateMetrics } from './index';
import { parseDecimal } from './rational';
import { periodicRate } from './rates';

const BASE: LoanInput = {
  currency: 'USD',
  amount: '1000.00',
  annualRatePct: '6',
  repayment: 'annuity',
  frequency: 'monthly',
  term: { payments: 12 },
  disbursementDate: '2026-01-15',
};

/** A decimal.js constructor far wider than the engine's, for independent references. */
const Reference = Decimal.clone({ defaults: true, precision: 200 });

function okResult(input: LoanInput): Extract<ReturnType<typeof calculateLoan>, { ok: true }> {
  const result = calculateLoan(input);
  if (!result.ok) {
    throw new Error(`expected a schedule, got ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function metric(value: unknown): RateMetric {
  if (typeof value !== 'object' || value === null || 'ok' in value) {
    throw new Error(`expected a rate, got ${JSON.stringify(value)}`);
  }
  return value as RateMetric;
}

/** The significant digits of a plain decimal string ("0.0000083333" → "83333"). */
function significantDigits(text: string): string {
  return text.replace('-', '').replace('.', '').replace(/^0+/, '');
}

describe('calculateLoan: warnings', () => {
  it('reports EARLY_CLOSE with the actual and the scheduled number of payments', () => {
    const result = okResult({
      ...BASE,
      annualRatePct: '12',
      term: { payments: 360 },
      rounding: { payment: 'unit-ceil' },
    });
    expect(result.warnings).toEqual([
      { code: 'EARLY_CLOSE', params: { paymentsCount: '242', scheduled: '360' } },
    ]);
    expect(result.rows).toHaveLength(242);
  });

  it('reports RATE_HIGH above 100 % and nothing for an ordinary loan', () => {
    expect(okResult({ ...BASE, annualRatePct: '100.01' }).warnings).toEqual([
      { code: 'RATE_HIGH', params: { annualRatePct: '100.01' } },
    ]);
    expect(okResult({ ...BASE, annualRatePct: '100' }).warnings).toEqual([]);
    expect(okResult(BASE).warnings).toEqual([]);
  });
});

describe('calculateLoan: the instalment explanation (SPEC §9.6)', () => {
  it('E6: annuity of 1 500.00 at 6.5 %, N = 1 — A* = 1508.125 exactly', () => {
    expect(
      okResult({ ...BASE, amount: '1500.00', annualRatePct: '6.5', term: { payments: 1 } }).explain,
    ).toEqual({
      formulaId: 'instalment.annuity',
      values: { P: '1500.00', N: '1', j: '0.065', m: '12', Astar: '1508.125', A: '1508.13' },
    });
  });

  it('adds i when the compounding differs from the payment frequency', () => {
    const { values } = okResult({
      ...BASE,
      accrual: { mode: 'periodic', compounding: 'semiannual' },
    }).explain;
    // (1 + 0.06/2)^(2/12) − 1, checked against a 200-digit reference.
    const i = new Reference('1.03').pow(new Reference(1).div(6)).minus(1);
    expect(values.i).toBeDefined();
    expect(new Reference(values.i ?? '0').minus(i).abs().lt('1e-19')).toBe(true);
  });

  it('balloon, equal principal and bullet use their own formula ids and keys', () => {
    expect(
      okResult({ ...BASE, repayment: 'balloon', balloon: { kind: 'percent', value: '30' } })
        .explain,
    ).toMatchObject({
      formulaId: 'instalment.balloon',
      values: { P: '1000.00', N: '12', Bal: '300.00' },
    });
    expect(okResult({ ...BASE, repayment: 'equal-principal' }).explain).toEqual({
      formulaId: 'instalment.equal-principal',
      values: { P: '1000.00', N: '12', q: '83.33' },
    });
    expect(okResult({ ...BASE, repayment: 'bullet' }).explain).toEqual({
      formulaId: 'instalment.bullet',
      values: { P: '1000.00', N: '12', I1: '5.00' },
    });
  });
});

describe('calculateLoan at the edges of the number ranges', () => {
  it('rejects a fixed fee above 1e15 and computes one at the limit (SPEC §13)', () => {
    const fee = (value: string) => [
      {
        id: 'f',
        kind: 'upfront' as const,
        calc: 'fixed' as const,
        value,
        financing: 'financed' as const,
        inApr: false,
      },
    ];
    expect(calculateLoan({ ...BASE, fees: fee('1000000000000000.01') })).toEqual({
      ok: false,
      errors: [{ code: 'FEE_RANGE', field: 'fees[0].value' }],
    });
    // A financed fee that is not a finance charge is credit received: the IRR is the contract rate.
    const atLimit = okResult({ ...BASE, fees: fee('1000000000000000.00') });
    expect(metric(atLimit.rates.irrNominal).display).toBe('6.00');
    expect(metric(atLimit.rates.usRegZApr).display).toBe('6.000');
  });

  it('rejects upfront fees paid at closing that take the whole amount (SPEC §6.1)', () => {
    const paid = (value: string) => [
      {
        id: 'f',
        kind: 'upfront' as const,
        calc: 'fixed' as const,
        value,
        financing: 'paid' as const,
      },
    ];
    expect(calculateLoan({ ...BASE, fees: paid('1000.00') })).toEqual({
      ok: false,
      errors: [{ code: 'FEE_RANGE', field: 'fees' }],
    });
    expect(okResult({ ...BASE, fees: paid('999.99') }).summary.netProceeds).toBe('0.01');
  });

  it('posts exact interest and instalment for an irrational rate at the largest principal', () => {
    // Continuous compounding, i = e^(0.06/12) − 1, on P = 1e15 + a financed fee of 1e15.
    const result = okResult({
      ...BASE,
      amount: '1000000000000000.00',
      term: { payments: 2 },
      accrual: { mode: 'periodic', compounding: 'continuous' },
      fees: [
        {
          id: 'f',
          kind: 'upfront',
          calc: 'fixed',
          value: '1000000000000000.00',
          financing: 'financed',
          inApr: false,
        },
      ],
    });
    const i = new Reference('0.005').exp().minus(1);
    const principal = new Reference('2e15');
    const interest = principal.times(i).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const astar = principal.times(i).div(new Reference(1).minus(i.plus(1).pow(-2)));
    expect(result.rows[0]?.interestAccrued).toBe(interest.toFixed(2));
    expect(result.summary.regularInstalment).toBe(
      astar.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    );
  });

  it('keeps at least 40 significant digits of the smallest irrational rate (SPEC §1.6)', () => {
    // 1e−10 % is the smallest rate SPEC §13 allows: j = 1e−12, i ≈ j/12 ≈ 8.3e−14. The
    // subtraction in e^x − 1 cancels 13 digits, which a fixed 50 digits could not spare.
    for (const sign of ['', '-'] as const) {
      const j = new Reference(`${sign}1e-12`);
      for (const compounding of ['continuous', 'semiannual'] as const) {
        const reference =
          compounding === 'continuous'
            ? j.div(12).exp().minus(1)
            : j.div(2).plus(1).pow(new Reference(2).div(12)).minus(1);
        const i = periodicRate(parseDecimal(`${sign}0.000000000001`), 'monthly', compounding);
        if (i.kind !== 'decimal') {
          throw new Error('expected an irrational rate');
        }
        const relative = new Reference(i.value.toString())
          .minus(reference)
          .abs()
          .div(reference.abs());
        expect(relative.lt('1e-40')).toBe(true);
        // Through the API, the explanation shows 20 correct significant digits.
        const shown =
          okResult({
            ...BASE,
            annualRatePct: `${sign}0.0000000001`,
            accrual: { mode: 'periodic', compounding },
          }).explain.values.i ?? '0';
        expect(significantDigits(shown)).toHaveLength(20);
        expect(new Reference(shown).minus(reference).abs().div(reference.abs()).lt('1e-19')).toBe(
          true,
        );
      }
    }
  });
});

describe('calculateLoan and computeRateMetrics: errors', () => {
  it('reports NEG_AMORTIZATION alone (phase 3)', () => {
    const result = calculateLoan({
      ...BASE,
      amount: '100000.00',
      annualRatePct: '30',
      term: { payments: 360 },
      accrual: { mode: 'daycount', method: 'act-360' },
    });
    expect(result).toEqual({
      ok: false,
      errors: [{ code: 'NEG_AMORTIZATION', field: null, params: { period: '1' } }],
    });
  });

  it('rejects input that is not an object, and accepts any value without throwing', () => {
    for (const input of [null, undefined, 42, 'loan', [], true]) {
      expect(calculateLoan(input)).toEqual({
        ok: false,
        errors: [{ code: 'INPUT_INVALID', field: null }],
      });
      expect(computeRateMetrics(input)).toEqual({
        ok: false,
        errors: [{ code: 'INPUT_INVALID', field: null }],
      });
    }
  });

  it('computes explicit cash flows and rejects malformed ones', () => {
    const ok = computeRateMetrics({
      flows: [
        { date: '2026-01-15', amount: '1000' },
        { date: '2027-01-15', amount: '-1100' },
      ],
    });
    expect(ok.ok && metric(ok.rates.xirr).display).toBe('10.00');
    expect(ok.ok && Object.keys(ok.rates)).toEqual(['xirr', 'uaRealAnnual', 'international']);
    expect(computeRateMetrics({ flows: [{ date: '2026-01-15', amount: '1000' }] })).toEqual({
      ok: false,
      errors: [{ code: 'INPUT_INVALID', field: 'flows' }],
    });
  });
});
