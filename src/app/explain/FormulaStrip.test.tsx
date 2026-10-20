// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Explain } from '../../engine';
import { setLanguage, t } from '../state/i18n';
import { okResult, resetForm, updateForm } from '../state/loan';
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
