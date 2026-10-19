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
  it('reports IRR_MULTIPLE at the top level and on the affected metric', () => {
    // A paid fee above the amount makes the inflow at D0 negative; the negative rate then
    // gives the periodic flows several sign changes.
    const result = okResult({
      ...BASE,
      annualRatePct: '-20',
      repayment: 'bullet',
      term: { payments: 600 },
      fees: [
        {
          id: 'f',
          kind: 'upfront',
          calc: 'fixed',
          value: '1000.01',
          financing: 'paid',
          inApr: true,
        },
      ],
      rateMethods: ['irrNominal', 'xirr'],
    });
    expect(result.warnings).toEqual([
      { code: 'RATE_NEGATIVE', params: { annualRatePct: '-20' } },
      { code: 'IRR_MULTIPLE', params: { methods: 'irrNominal' } },
    ]);
    expect(metric(result.rates.irrNominal).warnings).toEqual(['IRR_MULTIPLE']);
    expect(metric(result.rates.xirr).warnings).toBeUndefined();
  });

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
  it('does not throw for a fee value beyond the double range, and still solves the rates', () => {
    const fee = `1${'0'.repeat(400)}.00`;
    // A financed fee that is not a finance charge is credit received: the IRR is the contract rate.
    const financed = okResult({
      ...BASE,
      fees: [
        {
          id: 'f',
          kind: 'upfront',
          calc: 'fixed',
          value: fee,
          financing: 'financed',
          inApr: false,
        },
      ],
    });
    expect(metric(financed.rates.irrNominal).display).toBe('6.00');
    expect(metric(financed.rates.usRegZApr).display).toBe('6.000');
    // A paid finance charge larger than the amount leaves no sign change: no rate, no throw.
    const paid = okResult({
      ...BASE,
      fees: [
        { id: 'f', kind: 'upfront', calc: 'fixed', value: fee, financing: 'paid', inApr: true },
      ],
    });
    expect(paid.rates.irrNominal).toEqual({ ok: false, reason: 'IRR_NO_CONVERGENCE' });
  });

  it('posts exact interest and instalment for an irrational rate on a huge principal', () => {
    // Continuous compounding: i = e^(0.06/12) − 1. A financed fee of 1e60 makes P 61 digits long.
    const result = okResult({
      ...BASE,
      term: { payments: 2 },
      accrual: { mode: 'periodic', compounding: 'continuous' },
      fees: [
        {
          id: 'f',
          kind: 'upfront',
          calc: 'fixed',
          value: `1${'0'.repeat(60)}.00`,
          financing: 'financed',
          inApr: false,
        },
      ],
    });
    const i = new Reference('0.005').exp().minus(1);
    const principal = new Reference(`1${'0'.repeat(60)}`).plus(1000);
    const interest = principal.times(i).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const astar = principal.times(i).div(new Reference(1).minus(i.plus(1).pow(-2)));
    expect(result.rows[0]?.interestAccrued).toBe(interest.toFixed(2));
    expect(result.summary.regularInstalment).toBe(
      astar.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    );
  });

  it('keeps at least 40 significant digits of a tiny irrational rate, and never makes it 0', () => {
    for (const compounding of ['continuous', 'semiannual'] as const) {
      // j = 1e−40 (1e−38 %): i ≈ j/12 = 8.333…e−42.
      const tiny = okResult({
        ...BASE,
        annualRatePct: `0.${'0'.repeat(37)}1`,
        accrual: { mode: 'periodic', compounding },
      });
      const j = new Reference('1e-40');
      const reference =
        compounding === 'continuous'
          ? j.div(12).exp().minus(1)
          : j.div(2).plus(1).pow(new Reference(2).div(12)).minus(1);
      const shown = tiny.explain.values.i ?? '0';
      // The explanation carries 20 significant digits, all of them correct.
      expect(significantDigits(shown)).toHaveLength(20);
      expect(new Reference(shown).minus(reference).abs().div(reference).lt('1e-19')).toBe(true);
      // j = 1e−50 (1e−48 %): still a non-zero rate, not the j = 0 shortcut.
      const tinier = okResult({
        ...BASE,
        annualRatePct: `0.${'0'.repeat(47)}1`,
        accrual: { mode: 'periodic', compounding },
      });
      expect(tinier.explain.values.i).not.toBe('0');
      expect(Number(tinier.explain.values.i)).toBeGreaterThan(0);
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
