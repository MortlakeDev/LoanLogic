// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Explain } from '../../engine';
import { PaymentHero } from '../results/PaymentHero';
import { setLanguage, t } from '../state/i18n';
import { type LoanForm, form, okResult, resetForm, updateForm } from '../state/loan';
import { explainTarget } from '../state/ui';
import { FormulaStrip } from './FormulaStrip';

function currentExplain(): Explain {
  const result = okResult.value;
  if (result === null) {
    throw new Error('The scenario has no result');
  }
  return result.explain;
}

function formulaText(): string {
  // Named in the current UI language.
  const group = screen.getByRole('group', { name: t('hero.formula') });
  return group.textContent.replace(/[\u00a0\u202f]/g, ' ');
}

beforeEach(() => {
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  setLanguage('en');
  explainTarget.value = null;
});

afterEach(() => {
  cleanup();
});

describe('FormulaStrip', () => {
  it('shows the design scenario with its substituted values', () => {
    render(<FormulaStrip explain={currentExplain()} />);
    expect(formulaText()).toBe(
      'A = P·i ÷ (1 − (1 + i)−N), P = 350,000.00, i = 0.06875 ÷ 12, N = 360 → 2,299.25',
    );
    const group = screen.getByRole('group', { name: 'Formula' });
    expect(group.querySelector('sup')?.textContent).toBe('−N');
  });

  it('follows the formatting of the language', () => {
    setLanguage('ru');
    render(<FormulaStrip explain={currentExplain()} />);
    expect(formulaText()).toBe(
      'A = P·i ÷ (1 − (1 + i)−N); P = 350 000,00; i = 0,06875 ÷ 12; N = 360 → 2 299,25',
    );
  });

  it('names the day-count method of the exact payment basis', () => {
    updateForm({
      amount: '100000.00',
      annualRatePct: '30',
      accrualMode: 'daycount',
      dayCount: 'act-360',
      paymentBasis: 'exact',
      fees: [],
    });
    render(<FormulaStrip explain={currentExplain()} />);
    expect(formulaText()).toBe(
      'A = P·Π(1 + rk) ÷ Σs Πk>s(1 + rk), P = 100,000.00, rk = 0.3 × YFk, ' +
        'YFk = ACT/360 (actual days ÷ 360), N = 360 → 2,535.75',
    );
    const group = screen.getByRole('group', { name: 'Formula' });
    expect(Array.from(group.querySelectorAll('sub'), (sub) => sub.textContent)).toContain('k>s');
  });

  it('names the first payment of equal principal in the language of the page', () => {
    updateForm({ repayment: 'equal-principal' });
    setLanguage('ru');
    render(<FormulaStrip explain={currentExplain()} />);
    expect(formulaText()).toBe(
      'первый платёж = p1 + I1; p1 = q = R(P ÷ N) = 972,22; I1 = R(P × j ÷ m) = 2 005,21; ' +
        'P = 350 000,00; N = 360; j = 0,06875; m = 12 → 2 977,43',
    );
    const group = screen.getByRole('group', { name: t('hero.formula') });
    expect(Array.from(group.querySelectorAll('sub'), (sub) => sub.textContent)).toEqual([
      '1',
      '1',
      '1',
      '1',
    ]);
  });

  it('shows an unknown formula id with its values', () => {
    render(<FormulaStrip explain={{ formulaId: 'instalment.future', values: { X: '1' } }} />);
    expect(formulaText()).toBe('instalment.future, X = 1');
  });

  it('opens the Explain sheet for the instalment', () => {
    render(<FormulaStrip explain={currentExplain()} />);
    const button = screen.getByRole('button', { name: "How it's calculated" });
    fireEvent.click(button);
    expect(explainTarget.value).toEqual({ kind: 'instalment' });
  });
});

/** The quarterly compounding of a monthly loan: `c ≠ m`, so the payload carries `i`. */
const C_NOT_M: Partial<LoanForm> = { compounding: 'quarterly' };
/** Day-count interest, ACT/360, with the nominal payment basis. */
const DAY_COUNT: Partial<LoanForm> = { accrualMode: 'daycount', dayCount: 'act-360' };
const SINGLE: Partial<LoanForm> = { termMode: 'payments', termPayments: '1' };
const ANNUITY = 'A = P·i ÷ (1 − (1 + i)−N)';
const BALLOON = 'A = (P − Bal·(1 + i)−N)·i ÷ (1 − (1 + i)−N)';

/**
 * The strip of every repayment type in every accrual mode (DESIGN §8.6), from the design
 * scenario (USD 350,000.00 at 6.875 % over 360 monthly payments) with changes. The text
 * is read from the page, so subscripts run on (`p1` for p₁) and superscripts too (`−N`).
 */
const STRIPS: readonly (readonly [string, Partial<LoanForm>, string])[] = [
  ['annuity, c = m', {}, `${ANNUITY}, P = 350,000.00, i = 0.06875 ÷ 12, N = 360 → 2,299.25`],
  ['annuity, c ≠ m', C_NOT_M, `${ANNUITY}, P = 350,000.00, i = 0.005696653187, N = 360 → 2,290.13`],
  [
    'annuity, day count (nominal basis)',
    DAY_COUNT,
    `${ANNUITY}, P = 350,000.00, i = 0.06875 ÷ 12, N = 360 → 2,299.25`,
  ],
  [
    'annuity, day count (exact basis)',
    { ...DAY_COUNT, paymentBasis: 'exact', amount: '100000.00', annualRatePct: '30', fees: [] },
    'A = P·Π(1 + rk) ÷ Σs Πk>s(1 + rk), P = 100,000.00, rk = 0.3 × YFk, ' +
      'YFk = ACT/360 (actual days ÷ 360), N = 360 → 2,535.75',
  ],
  [
    'balloon, c = m',
    { repayment: 'balloon' },
    `${BALLOON}, P = 350,000.00, Bal = 105,000.00, i = 0.06875 ÷ 12, N = 360 → 2,211.04`,
  ],
  [
    'balloon, c ≠ m',
    { repayment: 'balloon', ...C_NOT_M },
    `${BALLOON}, P = 350,000.00, Bal = 105,000.00, i = 0.005696653187, N = 360 → 2,201.24`,
  ],
  [
    'balloon, day count',
    { repayment: 'balloon', ...DAY_COUNT },
    `${BALLOON}, P = 350,000.00, Bal = 105,000.00, i = 0.06875 ÷ 12, N = 360 → 2,211.04`,
  ],
  [
    'equal principal, remainder last, c = m',
    { repayment: 'equal-principal' },
    'first payment = p1 + I1, p1 = q = R(P ÷ N) = 972.22, I1 = R(P × j ÷ m) = 2,005.21, ' +
      'P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,977.43',
  ],
  [
    'equal principal, remainder first, c = m',
    { repayment: 'equal-principal', principalRemainder: 'first' },
    'first payment = p1 + I1, q = R(P ÷ N) = 972.22, p1 = P − (N − 1)·q = 973.02, ' +
      'I1 = R(P × j ÷ m) = 2,005.21, P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,978.23',
  ],
  [
    'equal principal, c ≠ m',
    { repayment: 'equal-principal', ...C_NOT_M },
    'first payment = p1 + I1, p1 = q = R(P ÷ N) = 972.22, I1 = R(P × i) = 1,993.83, ' +
      'P = 350,000.00, N = 360, i = 0.005696653187 → 2,966.05',
  ],
  [
    'equal principal, day count',
    { repayment: 'equal-principal', ...DAY_COUNT },
    'first payment = p1 + I1, p1 = q = R(P ÷ N) = 972.22, I1 = R(P × j × YF1) = 2,005.21, ' +
      'P = 350,000.00, N = 360, j = 0.06875, YF1 = 30 ÷ 360 → 2,977.43',
  ],
  [
    'equal principal, day count, remainder first',
    { repayment: 'equal-principal', principalRemainder: 'first', ...DAY_COUNT },
    'first payment = p1 + I1, q = R(P ÷ N) = 972.22, p1 = P − (N − 1)·q = 973.02, ' +
      'I1 = R(P × j × YF1) = 2,005.21, P = 350,000.00, N = 360, j = 0.06875, ' +
      'YF1 = 30 ÷ 360 → 2,978.23',
  ],
  [
    'interest-only, N > 1, c = m',
    { repayment: 'bullet' },
    'first payment = I1 = R(P × j ÷ m), P = 350,000.00, N = 360, j = 0.06875, m = 12 → 2,005.21',
  ],
  [
    'interest-only, N = 1, c = m',
    { repayment: 'bullet', ...SINGLE },
    'first payment = P + I1, I1 = R(P × j ÷ m) = 2,005.21, P = 350,000.00, N = 1, ' +
      'j = 0.06875, m = 12 → 352,005.21',
  ],
  [
    'interest-only, N > 1, c ≠ m',
    { repayment: 'bullet', ...C_NOT_M },
    'first payment = I1 = R(P × i), P = 350,000.00, N = 360, i = 0.005696653187 → 1,993.83',
  ],
  [
    'interest-only, N = 1, c ≠ m',
    { repayment: 'bullet', ...C_NOT_M, ...SINGLE },
    'first payment = P + I1, I1 = R(P × i) = 1,993.83, P = 350,000.00, N = 1, ' +
      'i = 0.005696653187 → 351,993.83',
  ],
  [
    'interest-only, N > 1, day count',
    { repayment: 'bullet', ...DAY_COUNT },
    'first payment = I1 = R(P × j × YF1), P = 350,000.00, N = 360, j = 0.06875, ' +
      'YF1 = 30 ÷ 360 → 2,005.21',
  ],
  [
    'interest-only, N = 1, day count',
    { repayment: 'bullet', ...DAY_COUNT, ...SINGLE },
    'first payment = P + I1, I1 = R(P × j × YF1) = 2,005.21, P = 350,000.00, N = 1, ' +
      'j = 0.06875, YF1 = 30 ÷ 360 → 352,005.21',
  ],
];

describe('FormulaStrip in the payment hero', () => {
  it.each(STRIPS)('%s: reproduces the hero figure', (_name, patch, expected) => {
    updateForm(patch);
    const result = okResult.value;
    if (result === null) {
      throw new Error('The scenario has no result');
    }
    const { container } = render(<PaymentHero result={result} frequency={form.value.frequency} />);
    const strip = formulaText();
    expect(strip).toBe(expected);
    // The last number of the strip is the hero figure (the hero adds the currency symbol).
    const hero = container.querySelector('.hero-amount .visually-hidden')?.textContent ?? '';
    expect(hero).toBe(`$${strip.slice(strip.lastIndexOf('→ ') + 2)}`);
  });
});
