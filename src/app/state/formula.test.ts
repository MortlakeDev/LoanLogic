// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import {
  type Explain,
  type LoanResult,
  type RateMethodId,
  type RateMetric,
  calculateLoan,
} from '../../engine';
import {
  type FormulaModel,
  type FormulaText,
  instalmentFormula,
  rateFormula,
  rateNote,
  stripParts,
  substitutionSeparator,
} from './formula';
import { type LoanForm, defaultForm, toLoanInput } from './loan';

type OkResult = Extract<LoanResult, { readonly ok: true }>;

/** The design scenario (DESIGN.md) disbursed on a fixed date, with changes. */
function loan(patch: Partial<LoanForm> = {}): OkResult {
  const result = calculateLoan(toLoanInput({ ...defaultForm('2026-11-01'), ...patch }));
  if (!result.ok) {
    throw new Error(`Engine errors: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function metricOf(result: OkResult, method: RateMethodId): RateMetric {
  const metric = result.rates[method];
  if (metric === undefined || !('explain' in metric)) {
    throw new Error(`No metric ${method}`);
  }
  return metric;
}

/**
 * Parts as plain text: superscripts as `^(…)`, subscripts as `_(…)`, words as `[id]`;
 * (narrow) no-break spaces of Intl grouping as spaces.
 */
function plain(parts: FormulaText): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return part.text;
        case 'sup':
          return `^(${plain(part.parts)})`;
        case 'sub':
          return `_(${plain(part.parts)})`;
        case 'dayCount':
          return `[${part.id}]`;
        case 'message':
          return `[${part.key}]`;
      }
    })
    .join('')
    .replace(/[\u00a0\u202f]/g, ' ');
}

const strip = (model: FormulaModel): string => plain(stripParts(model));
const lines = (model: FormulaModel): string[] => model.lines.map(plain);
const values = (model: FormulaModel): Record<string, string> =>
  Object.fromEntries(model.values.map((entry) => [entry.name, plain(entry.value)]));

const ANNUITY = 'A = P·i ÷ (1 − (1 + i)^(−N))';
/** The strip's word for the first payment, as `plain` writes a message. */
const FIRST = '[explain.stripFirst]';

describe('instalmentFormula', () => {
  it('reproduces the design scenario with i shown as j ÷ m', () => {
    const model = instalmentFormula(loan().explain, 'en-US', 2);
    expect(model.id).toBe('instalment.annuity');
    expect(strip(model)).toBe(`${ANNUITY}, P = 350,000.00, i = 0.06875 ÷ 12, N = 360 → 2,299.25`);
    expect(lines(model)).toEqual([ANNUITY, 'i = j ÷ m']);
    expect(values(model)).toEqual({
      P: '350,000.00',
      N: '360',
      j: '0.06875',
      m: '12',
      Astar: '2,299.250848',
      A: '2,299.25',
    });
    expect(model.values.map((entry) => entry.label)).toEqual([
      'explain.symP',
      'explain.symN',
      'explain.symJ',
      'explain.symM',
      'explain.symAstar',
      'explain.symA',
    ]);
    expect(plain(model.values[4]?.symbol ?? [])).toBe('A^(*)');
    expect(model.result).toEqual({ raw: '2299.25', text: '2,299.25', symbol: null });
    expect(model.note).toBe('explain.instalmentAnnuity');
    expect(model.separator).toBe(', ');
  });

  it('separates values with "; " and writes decimal commas in ru-RU', () => {
    const model = instalmentFormula(loan().explain, 'ru-RU', 2);
    expect(strip(model)).toBe(`${ANNUITY}; P = 350 000,00; i = 0,06875 ÷ 12; N = 360 → 2 299,25`);
  });

  it('shows the payload i with 10 significant digits when compounding differs', () => {
    const model = instalmentFormula(loan({ compounding: 'quarterly' }).explain, 'en-US', 2);
    expect(strip(model)).toBe(`${ANNUITY}, P = 350,000.00, i = 0.005696653187, N = 360 → 2,290.13`);
    // No `i = j ÷ m` line: this i is not j ÷ m.
    expect(lines(model)).toEqual([ANNUITY]);
    expect(values(model).i).toBe('0.005696653187');
  });

  it('shows an exact payload i with all its digits', () => {
    // Quarterly payments, monthly compounding: i = 1.0051³ − 1 = 0.015378162651 exactly.
    const result = loan({ annualRatePct: '6.12', frequency: 'quarterly', compounding: 'monthly' });
    expect(result.explain.values.i).toBe('0.015378162651');
    const model = instalmentFormula(result.explain, 'en-US', 2);
    expect(strip(model)).toBe(`${ANNUITY}, P = 350,000.00, i = 0.015378162651, N = 120 → 6,409.09`);
    expect(values(model)).toMatchObject({ i: '0.015378162651', Astar: '6,409.091529' });
  });

  it('rounds an irrational exact instalment to 10 significant digits', () => {
    const result = loan({
      amount: '100000.00',
      annualRatePct: '5',
      termMode: 'payments',
      termPayments: '12',
      fees: [],
    });
    expect(result.explain.values.Astar).toBe('8560.7481788467114547');
    expect(values(instalmentFormula(result.explain, 'en-US', 2)).Astar).toBe('8,560.748179');
  });

  it('never shows the exact instalment coarser than the minor units', () => {
    const result = loan({
      amount: '123456789012.34',
      annualRatePct: '6',
      termMode: 'payments',
      termPayments: '1',
      fees: [],
    });
    expect(result.explain.values.Astar).toBe('124074072957.4017');
    const model = instalmentFormula(result.explain, 'en-US', 2);
    expect(values(model)).toMatchObject({ Astar: '124,074,072,957.40', A: '124,074,072,957.40' });
    // An exact instalment with few digits keeps them, padded to the minor units.
    const short = instalmentFormula(
      {
        formulaId: 'instalment.annuity',
        values: { P: '12000.00', N: '12', j: '0', m: '12', Astar: '1000', A: '1000.00' },
      },
      'en-US',
      2,
    );
    expect(values(short).Astar).toBe('1,000.00');
  });

  it('keeps the sign of a negative rate', () => {
    const model = instalmentFormula(loan({ annualRatePct: '-1' }).explain, 'en-US', 2);
    expect(strip(model)).toContain('i = -0.01 ÷ 12');
  });

  it('divides the principal by N at a zero rate', () => {
    const model = instalmentFormula(loan({ annualRatePct: '0' }).explain, 'en-US', 2);
    expect(strip(model)).toBe('A = P ÷ N, P = 350,000.00, N = 360 → 972.22');
    expect(lines(model)).toEqual(['A = P ÷ N']);
  });

  it('names the day-count method of the exact payment basis and has no single i', () => {
    const result = loan({
      amount: '100000.00',
      annualRatePct: '30',
      accrualMode: 'daycount',
      dayCount: 'act-360',
      paymentBasis: 'exact',
      fees: [],
    });
    const model = instalmentFormula(result.explain, 'en-US', 2);
    expect(model.id).toBe('instalment.annuity-exact-basis');
    expect(strip(model)).toBe(
      'A = P·Π(1 + r_(k)) ÷ Σ_(s) Π_(k>s)(1 + r_(k)), P = 100,000.00, r_(k) = 0.3 × YF_(k), ' +
        'YF_(k) = [act-360], N = 360 → 2,535.75',
    );
    expect(lines(model)[1]).toBe('r_(k) = j × YF_(k)');
    expect(model.values.map((entry) => entry.name)).not.toContain('i');
    expect(values(model)).toMatchObject({ dayCount: '[act-360]', Astar: '2,535.754042' });
    expect(model.note).toBe('explain.instalmentExactBasis');
  });

  it('subtracts the discounted balloon', () => {
    const model = instalmentFormula(loan({ repayment: 'balloon' }).explain, 'en-US', 2);
    expect(strip(model)).toBe(
      'A = (P − Bal·(1 + i)^(−N))·i ÷ (1 − (1 + i)^(−N)), P = 350,000.00, Bal = 105,000.00, ' +
        'i = 0.06875 ÷ 12, N = 360 → 2,211.04',
    );
    expect(lines(model)[1]).toBe('i = j ÷ m');
    expect(model.note).toBe('explain.instalmentBalloon');
  });

  it('spreads the principal less the balloon at a zero rate', () => {
    const result = loan({ repayment: 'balloon', annualRatePct: '0' });
    const model = instalmentFormula(result.explain, 'en-US', 2);
    expect(strip(model)).toBe(
      'A = (P − Bal) ÷ N, P = 350,000.00, Bal = 105,000.00, N = 360 → 680.56',
    );
  });

  it('builds the first payment of equal principal from q = R(P ÷ N) and I₁ = R(P × j ÷ m)', () => {
    const model = instalmentFormula(loan({ repayment: 'equal-principal' }).explain, 'en-US', 2);
    expect(model.id).toBe('instalment.equal-principal');
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1), p_(1) = q = R(P ÷ N) = 972.22, I_(1) = R(P × j ÷ m) = 2,005.21, ` +
        'P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,977.43',
    );
    expect(lines(model)).toEqual([
      `${FIRST} = p_(1) + I_(1)`,
      'q = R(P ÷ N)',
      'p_(1) = q',
      'I_(1) = R(P × j ÷ m)',
    ]);
    expect(values(model)).toEqual({
      P: '350,000.00',
      N: '360',
      j: '0.06875',
      m: '12',
      q: '972.22',
      p1: '972.22',
      I1: '2,005.21',
      first: '2,977.43',
    });
    expect(model.values.map((entry) => entry.label)).toEqual([
      'explain.symP',
      'explain.symN',
      'explain.symJ',
      'explain.symM',
      'explain.symQ',
      'explain.symP1',
      'explain.symI1',
      'explain.symFirst',
    ]);
    // The first payment is named in words, so it has no symbol of its own.
    expect(model.values.find((entry) => entry.name === 'first')?.symbol).toEqual([]);
    expect(plain(model.values.find((entry) => entry.name === 'p1')?.symbol ?? [])).toBe('p_(1)');
    // The engine's own first payment, not p₁ + I₁ added up here.
    expect(model.result).toEqual({ raw: '2977.43', text: '2,977.43', symbol: null });
    expect(model.note).toBe('explain.instalmentEqualPrincipal');
  });

  it('shows p₁ = P − (N − 1)·q when the rounding remainder comes first', () => {
    const result = loan({ repayment: 'equal-principal', principalRemainder: 'first' });
    const model = instalmentFormula(result.explain, 'en-US', 2);
    // 350,000.00 − 359 × 972.22 = 973.02.
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1), q = R(P ÷ N) = 972.22, p_(1) = P − (N − 1)·q = 973.02, ` +
        'I_(1) = R(P × j ÷ m) = 2,005.21, P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,978.23',
    );
    expect(lines(model)[2]).toBe('p_(1) = P − (N − 1)·q');
    expect(model.result?.raw).toBe(result.explain.values.first);
  });

  it('shows p₁ = q when the remainder comes first but P divides evenly', () => {
    const result = loan({
      repayment: 'equal-principal',
      principalRemainder: 'first',
      amount: '360000.00',
    });
    expect(result.explain.values).toMatchObject({ q: '1000.00', p1: '1000.00' });
    const model = instalmentFormula(result.explain, 'en-US', 2);
    expect(lines(model)[2]).toBe('p_(1) = q');
  });

  it('shows I₁ = R(P × i) when compounding differs from the payments', () => {
    const model = instalmentFormula(
      loan({ repayment: 'equal-principal', compounding: 'quarterly' }).explain,
      'en-US',
      2,
    );
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1), p_(1) = q = R(P ÷ N) = 972.22, I_(1) = R(P × i) = 1,993.83, ` +
        'P = 350,000.00, N = 360, i = 0.005696653187 → 2,966.05',
    );
    expect(lines(model)[3]).toBe('I_(1) = R(P × i)');
    expect(values(model)).toMatchObject({ j: '0.06875', m: '12', i: '0.005696653187' });

    // An exact i keeps all its digits: quarterly payments, monthly compounding.
    const exact = instalmentFormula(
      loan({
        repayment: 'equal-principal',
        annualRatePct: '6.12',
        frequency: 'quarterly',
        compounding: 'monthly',
      }).explain,
      'en-US',
      2,
    );
    expect(strip(exact)).toBe(
      `${FIRST} = p_(1) + I_(1), p_(1) = q = R(P ÷ N) = 2,916.67, I_(1) = R(P × i) = 5,382.36, ` +
        'P = 350,000.00, N = 120, i = 0.015378162651 → 8,299.03',
    );
  });

  it('shows I₁ = R(P × j × YF₁) in day-count mode, without i or m', () => {
    const result = loan({
      repayment: 'equal-principal',
      accrualMode: 'daycount',
      dayCount: 'act-365f',
    });
    expect(result.explain.values.yf1).toBe('0.082191780821917808219');
    const model = instalmentFormula(result.explain, 'en-US', 2);
    // YF₁ from yf1Parts as day counts (SPEC v0.2.4), not the rounded yf1.
    expect(result.explain.values.yf1Parts).toBe('30/365');
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1), p_(1) = q = R(P ÷ N) = 972.22, ` +
        'I_(1) = R(P × j × YF_(1)) = 1,977.74, P = 350,000.00, N = 360, j = 0.06875, ' +
        'YF_(1) = 30 ÷ 365 → 2,949.96',
    );
    expect(lines(model)[3]).toBe('I_(1) = R(P × j × YF_(1))');
    expect(values(model)).toEqual({
      P: '350,000.00',
      N: '360',
      j: '0.06875',
      dayCount: '[act-365f]',
      // The sheet keeps every digit of yf1; only a payload i (c ≠ m) is rounded.
      yf1: '0.082191780821917808219',
      yf1Parts: '30 ÷ 365',
      q: '972.22',
      p1: '972.22',
      I1: '1,977.74',
      first: '2,949.96',
    });
    const yf1 = model.values.find((entry) => entry.name === 'yf1');
    expect(yf1?.label).toBe('explain.symYf1');
    expect(plain(yf1?.symbol ?? [])).toBe('YF_(1)');
    const parts = model.values.find((entry) => entry.name === 'yf1Parts');
    expect(parts?.label).toBe('explain.symYf1Parts');
    expect(plain(parts?.symbol ?? [])).toBe('YF_(1)');
  });

  it('writes YF₁ as day counts, also when they terminate', () => {
    // 30E/360 over a quarter: 90 ÷ 360 = 0.25.
    const result = loan({
      repayment: 'equal-principal',
      frequency: 'quarterly',
      accrualMode: 'daycount',
      dayCount: '30e-360',
    });
    expect(result.explain.values.yf1).toBe('0.25');
    expect(strip(instalmentFormula(result.explain, 'en-US', 2))).toContain('YF_(1) = 90 ÷ 360 → ');
  });

  it('reproduces the posted interest at a rounding tie (SPEC v0.2.4)', () => {
    // USD 1 001.00 at 6 %, interest-only, monthly, 30E/360, 15 Jan → 15 Feb: interest
    // accrues exactly 1001 × 0.06 × 30/360 = 5.005 and is posted half-up as 5.01. From the
    // rounded yf1 a hand calculation would give 5.00499… → 5.00; from 30 ÷ 360 it gives 5.01.
    const result = loan({
      amount: '1001.00',
      annualRatePct: '6',
      repayment: 'bullet',
      termMode: 'payments',
      termPayments: '12',
      accrualMode: 'daycount',
      dayCount: '30e-360',
      disbursementDate: '2026-01-15',
      fees: [],
    });
    expect(result.explain.values).toMatchObject({
      yf1: '0.083333333333333333333',
      yf1Parts: '30/360',
      I1: '5.01',
      first: '5.01',
    });
    const text = strip(instalmentFormula(result.explain, 'en-US', 2));
    expect(text).toBe(
      `${FIRST} = I_(1) = R(P × j × YF_(1)), P = 1,001.00, N = 12, j = 0.06, ` +
        'YF_(1) = 30 ÷ 360 → 5.01',
    );
  });

  it('shows the raw values of a day-count payload without yf1Parts', () => {
    const withoutParts = Object.fromEntries(
      Object.entries(
        loan({ repayment: 'bullet', accrualMode: 'daycount', dayCount: '30e-360' }).explain.values,
      ).filter(([key]) => key !== 'yf1Parts'),
    );
    const model = instalmentFormula(
      { formulaId: 'instalment.bullet', values: withoutParts },
      'en-US',
      2,
    );
    // No formula is guessed: the strip falls back to the payload's values.
    expect(lines(model)).toEqual([]);
  });

  it('separates the parts with "; " in ru-RU', () => {
    const model = instalmentFormula(loan({ repayment: 'equal-principal' }).explain, 'ru-RU', 2);
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1); p_(1) = q = R(P ÷ N) = 972,22; I_(1) = R(P × j ÷ m) = 2 005,21; ` +
        'P = 350 000,00; N = 360; j = 0,06875; m = 12 → 2 977,43',
    );
  });

  it('shows the first interest payment of an interest-only loan as I₁', () => {
    const model = instalmentFormula(loan({ repayment: 'bullet' }).explain, 'en-US', 2);
    expect(strip(model)).toBe(
      `${FIRST} = I_(1) = R(P × j ÷ m), P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,005.21`,
    );
    expect(lines(model)).toEqual([
      `${FIRST} = I_(1) = R(P × j ÷ m)`,
      'p_(k) = 0 (k < N), p_(N) = P',
    ]);
    expect(values(model)).toEqual({
      P: '350,000.00',
      N: '360',
      j: '0.06875',
      m: '12',
      I1: '2,005.21',
      first: '2,005.21',
    });
    expect(model.result).toEqual({ raw: '2005.21', text: '2,005.21', symbol: null });
    expect(model.note).toBe('explain.instalmentBullet');
  });

  it('adds P to I₁ for an interest-only loan with a single payment', () => {
    const model = instalmentFormula(
      loan({ repayment: 'bullet', termMode: 'payments', termPayments: '1' }).explain,
      'en-US',
      2,
    );
    expect(strip(model)).toBe(
      `${FIRST} = P + I_(1), I_(1) = R(P × j ÷ m) = 2,005.21, P = 350,000.00, N = 1, ` +
        'j = 0.06875, m = 12 → 352,005.21',
    );
    expect(lines(model)).toEqual([
      `${FIRST} = P + I_(1)`,
      'I_(1) = R(P × j ÷ m)',
      'p_(k) = 0 (k < N), p_(N) = P',
    ]);
    expect(model.result?.raw).toBe('352005.21');
  });

  it('shows the rate of an interest-only loan in every accrual mode', () => {
    const quarterly = loan({ repayment: 'bullet', compounding: 'quarterly' });
    expect(strip(instalmentFormula(quarterly.explain, 'en-US', 2))).toBe(
      `${FIRST} = I_(1) = R(P × i), P = 350,000.00, N = 360, i = 0.005696653187 → 1,993.83`,
    );
    const dayCount = loan({ repayment: 'bullet', accrualMode: 'daycount', dayCount: 'act-360' });
    expect(strip(instalmentFormula(dayCount.explain, 'en-US', 2))).toBe(
      `${FIRST} = I_(1) = R(P × j × YF_(1)), P = 350,000.00, N = 360, j = 0.06875, ` +
        'YF_(1) = 30 ÷ 360 → 2,005.21',
    );
    const single = loan({
      repayment: 'bullet',
      accrualMode: 'daycount',
      dayCount: 'act-360',
      termMode: 'payments',
      termPayments: '1',
    });
    expect(strip(instalmentFormula(single.explain, 'en-US', 2))).toBe(
      `${FIRST} = P + I_(1), I_(1) = R(P × j × YF_(1)) = 2,005.21, P = 350,000.00, N = 1, ` +
        'j = 0.06875, YF_(1) = 30 ÷ 360 → 352,005.21',
    );
  });

  it('formats amounts with the minor units of the currency', () => {
    const model = instalmentFormula(
      {
        formulaId: 'instalment.equal-principal',
        values: {
          P: '35000000',
          N: '360',
          j: '0.06875',
          m: '12',
          q: '97222',
          p1: '97222',
          I1: '200521',
          first: '297743',
        },
      },
      'en-US',
      0,
    );
    expect(strip(model)).toBe(
      `${FIRST} = p_(1) + I_(1), p_(1) = q = R(P ÷ N) = 97,222, I_(1) = R(P × j ÷ m) = 200,521, ` +
        'P = 35,000,000, N = 360, j = 0.06875, m = 12 → 297,743',
    );
  });

  it('shows values that follow no equal-principal or interest-only formula as raw values', () => {
    const principal = loan({ repayment: 'equal-principal' }).explain;
    const shown = (explain: Explain, patch: Readonly<Record<string, string>>): FormulaModel =>
      instalmentFormula({ ...explain, values: { ...explain.values, ...patch } }, 'en-US', 2);
    expect(shown(principal, {}).lines).toHaveLength(4);
    // p₁ is neither q nor P − (N − 1)·q.
    expect(shown(principal, { p1: '972.23', first: '2977.44' }).lines).toEqual([]);
    // first is not p₁ + I₁.
    expect(shown(principal, { first: '2977.44' }).lines).toEqual([]);
    // An amount finer than the minor units, or not an amount at all.
    expect(shown(principal, { q: '972.220' }).lines).toEqual([]);
    expect(shown(principal, { I1: '2,005.21' }).lines).toEqual([]);
    expect(shown(principal, { N: 'many' }).lines).toEqual([]);

    const bullet = loan({ repayment: 'bullet' }).explain;
    expect(shown(bullet, {}).lines).toHaveLength(2);
    // first is neither I₁ nor P + I₁.
    const neither = shown(bullet, { first: '2005.22' });
    expect(neither.lines).toEqual([]);
    expect(neither.result).toBeNull();
    expect(strip(neither)).toBe(
      'instalment.bullet, P = 350,000, N = 360, j = 0.06875, m = 12, I1 = 2,005.21, ' +
        'first = 2,005.22',
    );
  });

  it('shows an unknown id with its raw values and no formula', () => {
    const model = instalmentFormula(
      { formulaId: 'instalment.future', values: { P: '1000.5', mode: 'fast' } },
      'en-US',
      2,
    );
    expect(model.lines).toEqual([]);
    expect(model.result).toBeNull();
    expect(model.note).toBeNull();
    expect(model.values.map((entry) => entry.label)).toEqual([null, null]);
    expect(strip(model)).toBe('instalment.future, P = 1,000.5, mode = fast');
  });

  it('shows a payload its formula cannot use as raw values, not another formula', () => {
    const missing = instalmentFormula(
      { formulaId: 'instalment.annuity', values: { P: '1000.00' } },
      'en-US',
      2,
    );
    expect(missing.id).toBe('instalment.annuity');
    expect(missing.lines).toEqual([]);
    expect(strip(missing)).toBe('instalment.annuity, P = 1,000');

    const malformed = instalmentFormula(
      {
        formulaId: 'instalment.equal-principal',
        values: {
          P: 'lots',
          N: '2',
          j: '0',
          m: '12',
          q: '1.00',
          p1: '1.00',
          I1: '0.00',
          first: '1.00',
        },
      },
      'en-US',
      2,
    );
    expect(malformed.lines).toEqual([]);
    expect(values(malformed).P).toBe('lots');
  });

  it('lists a value it does not know with its key as the symbol', () => {
    const model = instalmentFormula(
      {
        formulaId: 'instalment.equal-principal',
        values: {
          P: '2.00',
          N: '2',
          j: '0',
          m: '12',
          q: '1.00',
          p1: '1.00',
          I1: '0.00',
          first: '1.00',
          Z: '0.5',
        },
      },
      'en-US',
      2,
    );
    // The formula is built: a value it does not know does not stop it.
    expect(model.lines).toHaveLength(4);
    expect(model.values[8]).toEqual({
      name: 'Z',
      symbol: [{ kind: 'text', text: 'Z' }],
      label: null,
      value: [{ kind: 'text', text: '0.5' }],
    });
    const regZ = rateFormula(
      'usRegZApr',
      {
        value: 12,
        display: '12.000',
        precision: 3,
        explain: {
          formulaId: 'rate.regz-single-payment',
          values: {
            Af: '100',
            P: '101',
            days: '30',
            months: '1',
            unitPeriodsPerYear: '12',
            i: '0.01',
            Z: '7',
          },
        },
      },
      'en-US',
      2,
    );
    expect(strip(regZ)).toContain(', Z = 7 → 12.000%');
  });

  it('shows a day-count id it does not know as it is', () => {
    const model = instalmentFormula(
      {
        formulaId: 'instalment.annuity-exact-basis',
        values: { P: '1.00', N: '1', j: '0.1', dayCount: 'bus-252', Astar: '1.1', A: '1.10' },
      },
      'en-US',
      2,
    );
    expect(values(model).dayCount).toBe('bus-252');
  });
});

describe('rateFormula', () => {
  const design = loan();

  it('annualizes the periodic IRR as r × m for the US APR', () => {
    const model = rateFormula('usRegZApr', metricOf(design, 'usRegZApr'), 'en-US', 2);
    expect(model.id).toBe('rate.periodic-irr');
    expect(lines(model)).toEqual(['r × m', 'Σ CF_(k)·(1 + r)^(−k) = 0']);
    expect(values(model)).toEqual({ r: '0.005811756069', m: '12' });
    expect(model.result).toEqual({ raw: '6.974', text: '6.974%', symbol: null });
    expect(model.note).toBe('explain.noteUsRegZApr');
  });

  it('compounds the periodic IRR for irrEffective', () => {
    const model = rateFormula('irrEffective', metricOf(design, 'irrEffective'), 'en-US', 2);
    expect(lines(model)[0]).toBe('(1 + r)^(m) − 1');
    expect(model.result?.text).toBe('7.20%');
  });

  it('shows the CN annualized rate (simple) of the CN scenario', () => {
    const result = loan({
      currency: 'CNY',
      amount: '1000000.00',
      annualRatePct: '3.10',
      fees: [],
      disbursementDate: '2026-11-15',
    });
    expect(instalmentFormula(result.explain, 'zh-CN', 2).result?.text).toBe('4,270.16');
    const model = rateFormula('cnAnnualized', metricOf(result, 'cnAnnualized'), 'zh-CN', 2);
    expect(lines(model)[0]).toBe('r × m');
    expect(values(model)).toEqual({ r: '0.002583333502', m: '12' });
    expect(model.result?.text).toBe('3.10%');
    expect(model.note).toBe('explain.noteCnAnnualized');
  });

  it('shows the nominal rate with all its digits', () => {
    const model = rateFormula('nominal', metricOf(design, 'nominal'), 'ru-RU', 2);
    expect(lines(model)).toEqual(['j']);
    expect(values(model)).toEqual({ j: '0,06875' });
    expect(model.result?.text.replace(/[\u00a0\u202f]/g, ' ')).toBe('6,875 %');
  });

  it('compounds the effective rate periodically, continuously or by day count', () => {
    const periodic = rateFormula('effective', metricOf(design, 'effective'), 'en-US', 2);
    expect(lines(periodic)).toEqual(['(1 + j ÷ c)^(c) − 1']);
    expect(values(periodic)).toEqual({ j: '0.06875', c: '12' });
    expect(periodic.result?.text).toBe('7.10%');

    const continuous = loan({ compounding: 'continuous' });
    const model = rateFormula('effective', metricOf(continuous, 'effective'), 'en-US', 2);
    expect(lines(model)).toEqual(['e^(j) − 1']);
    expect(values(model).c).toBe('[compounding.continuous]');

    const dayCount = loan({ accrualMode: 'daycount', dayCount: 'act-360' });
    const daily = rateFormula('effective', metricOf(dayCount, 'effective'), 'en-US', 2);
    expect(lines(daily)).toEqual(['(1 + j·k ÷ m)^(m) − 1']);
    expect(values(daily)).toEqual({ j: '0.06875', m: '12', k: '1.013888889' });
    expect(plain(stripParts(daily))).toBe(
      '(1 + j·k ÷ m)^(m) − 1, j = 0.06875, k = 1.013888889, m = 12 → 7.20%',
    );
  });

  it('explains the Reg Z single-payment rule in whole months', () => {
    const result = loan({ termMode: 'payments', termPayments: '1' });
    const model = rateFormula('usRegZApr', metricOf(result, 'usRegZApr'), 'en-US', 2);
    expect(model.id).toBe('rate.regz-single-payment');
    expect(lines(model)).toEqual(['i × U', 'i = P ÷ A_(f) − 1', 'U = 12 ÷ M']);
    expect(values(model)).toEqual({
      Af: '346,500.00',
      P: '352,005.21',
      days: '30',
      months: '1',
      unitPeriodsPerYear: '12',
      i: '0.01588805195',
    });
    // P is the single payment here, not the principal financed.
    expect(model.values.find((entry) => entry.name === 'P')?.label).toBe('explain.symPayment');
    expect(model.result?.text).toBe('19.066%');
  });

  it('explains the Reg Z single-payment rule in days', () => {
    const result = loan({ termMode: 'payments', termPayments: '1', frequency: 'weekly' });
    const model = rateFormula('usRegZApr', metricOf(result, 'usRegZApr'), 'en-US', 2);
    expect(lines(model)[2]).toBe('U = 365 ÷ D');
    expect(values(model)).toMatchObject({
      days: '7',
      months: '0',
      unitPeriodsPerYear: '52.14285714',
    });
  });

  it('explains the Reg Z single-payment rule for a term of a year', () => {
    const result = loan({ termMode: 'payments', termPayments: '1', frequency: 'annual' });
    const model = rateFormula('usRegZApr', metricOf(result, 'usRegZApr'), 'en-US', 2);
    expect(lines(model)).toEqual(['A_(f)·(1 + f·i)·(1 + i)^(t) = P']);
    expect(values(model)).toMatchObject({ t: '1', f: '0', unitPeriodsPerYear: '1' });
  });

  it('shows the annual IRR of the APRC and the XIRR family with its time basis', () => {
    const aprc = rateFormula('euAprc', metricOf(design, 'euAprc'), 'en-US', 2);
    expect(aprc.id).toBe('rate.annual-irr');
    expect(lines(aprc)).toEqual(['Σ CF_(k)·(1 + X)^(−t_(k)) = 0']);
    expect(values(aprc)).toEqual({ X: '0.07201407859', timeBasis: '[explain.timeBasisPeriods]' });
    expect(aprc.result?.text).toBe('7.2%');
    expect(aprc.note).toBe('explain.noteEuAprc');

    const xirr = rateFormula('xirr', metricOf(design, 'xirr'), 'en-US', 2);
    expect(values(xirr).timeBasis).toBe('[explain.timeBasisDays365]');
  });

  it('names every time basis and shows one it does not know as it is', () => {
    const metric = (timeBasis: string): RateMetric => ({
      value: 5,
      display: '5.0',
      precision: 1,
      explain: { formulaId: 'rate.annual-irr', values: { X: '0.05', timeBasis } },
    });
    const basis = (timeBasis: string): string | undefined =>
      values(rateFormula('ukAprc', metric(timeBasis), 'en-US', 2)).timeBasis;
    expect(basis('counted-back')).toBe('[explain.timeBasisCountedBack]');
    expect(basis('fortnights')).toBe('fortnights');
  });

  it('shows an unknown or incomplete payload as raw values with the result', () => {
    const unknown = rateFormula(
      'xirr',
      {
        value: 1,
        display: '1.00',
        precision: 2,
        explain: { formulaId: 'rate.future', values: { Y: '0.5' } },
      },
      'en-US',
      2,
    );
    expect(unknown.lines).toEqual([]);
    expect(unknown.note).toBeNull();
    expect(strip(unknown)).toBe('rate.future, Y = 0.5 → 1.00%');

    const incomplete = rateFormula(
      'irrNominal',
      {
        value: 1,
        display: '1.00',
        precision: 2,
        explain: { formulaId: 'rate.periodic-irr', values: { r: '0.01' } },
      },
      'en-US',
      2,
    );
    expect(incomplete.lines).toEqual([]);
    expect(values(incomplete)).toEqual({ r: '0.01' });
  });
});

describe('rateNote', () => {
  it('names the note of every method', () => {
    const methods: RateMethodId[] = [
      'nominal',
      'effective',
      'irrNominal',
      'irrEffective',
      'xirr',
      'usRegZApr',
      'ukAprc',
      'euAprc',
      'cnAnnualized',
      'uaRealAnnual',
      'international',
    ];
    expect(methods.map(rateNote)).toEqual([
      'explain.noteNominal',
      'explain.noteEffective',
      'explain.noteIrrNominal',
      'explain.noteIrrEffective',
      'explain.noteXirr',
      'explain.noteUsRegZApr',
      'explain.noteUkAprc',
      'explain.noteEuAprc',
      'explain.noteCnAnnualized',
      'explain.noteUaRealAnnual',
      'explain.noteInternational',
    ]);
  });
});

describe('substitutionSeparator', () => {
  it('avoids a comma where the decimal separator is a comma', () => {
    expect(substitutionSeparator('en-US')).toBe(', ');
    expect(substitutionSeparator('zh-CN')).toBe(', ');
    expect(substitutionSeparator('ru-RU')).toBe('; ');
    expect(substitutionSeparator('uk-UA')).toBe('; ');
    expect(substitutionSeparator('de-DE')).toBe('; ');
  });
});
