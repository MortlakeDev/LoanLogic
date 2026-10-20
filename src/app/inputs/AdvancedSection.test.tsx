// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { form, headlineMethod, loanInput, updateForm } from '../state/loan';
import { advancedOpen } from '../state/ui';
import {
  change,
  choose,
  descriptionOf,
  input,
  renderPanel,
  resetState,
  select,
} from './__tests__/panel';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  cleanup();
});

/** The status line of the Advanced disclosure. */
function status(): string {
  return document.querySelector('#advanced-button .disclosure__status')?.textContent ?? '';
}

describe('Advanced disclosure', () => {
  it('opens and closes with its button', () => {
    renderPanel();
    const button = screen.getByRole('button', { name: /^Advanced/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(advancedOpen.value).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('sums up the settings in its status line', () => {
    renderPanel();
    expect(status()).toBe('Periodic interest · payment half up to $0.01');
    choose(select('field-rounding-payment'), 'unit-ceil');
    expect(status()).toBe('Periodic interest · payment up to $1');
    choose(select('field-termMode'), 'payments');
    choose(select('field-rateMethods'), 'ukAprc');
    expect(status()).toBe(
      'Periodic interest · payment up to $1 · term in payments · headline: APR · FCA · UK',
    );
    choose(select('field-termMode'), 'endDate');
    fireEvent.click(screen.getByRole('radio', { name: 'Day count' }));
    expect(status()).toContain('Day-count interest');
    expect(status()).toContain('term to an end date');
  });

  it('labels the payment rounding with the currency unit', () => {
    change(() => {
      updateForm({ currency: 'JPY', amount: '35000000' });
    });
    renderPanel();
    expect([...select('field-rounding-payment').options].map((option) => option.text)).toEqual([
      'Half up to ¥1',
      'Up to ¥1',
      'Half up to ¥1',
      'Up to ¥1',
    ]);
  });
});

describe('term mode', () => {
  it('starts each mode from the current term', () => {
    renderPanel();
    choose(select('field-termMode'), 'payments');
    expect(form.value.termPayments).toBe('360');
    expect(loanInput.value.term).toEqual({ payments: 360 });
    expect(input('field-term-payments').value).toBe('360');

    choose(select('field-termMode'), 'endDate');
    expect(loanInput.value.term).toEqual({ endDate: '2056-11-01' });
    expect(input('field-term-endDate').value).toBe('2056-11-01');

    choose(select('field-termMode'), 'years');
    expect(loanInput.value.term).toEqual({ years: 30, months: 0 });
  });
});

describe('interest model', () => {
  it('compounds with the payment by default and can compound otherwise', () => {
    renderPanel();
    expect(loanInput.value.accrual).toEqual({ mode: 'periodic' });
    const compounding = select('field-accrual-compounding');
    expect([...compounding.options].map((option) => option.value)).toEqual([
      'payment',
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'semiannual',
      'annual',
      'continuous',
    ]);
    choose(compounding, 'continuous');
    expect(loanInput.value.accrual).toEqual({ mode: 'periodic', compounding: 'continuous' });
    expect(document.getElementById('field-accrual-method')).toBeNull();
  });

  it('switches to day count with a method and a payment basis', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Day count' }));
    expect(input('field-accrual-mode').checked).toBe(false);
    expect(document.getElementById('field-accrual-compounding')).toBeNull();
    choose(select('field-accrual-method'), 'act-360');
    choose(select('field-accrual-paymentBasis'), 'exact');
    expect(loanInput.value.accrual).toEqual({
      mode: 'daycount',
      method: 'act-360',
      paymentBasis: 'exact',
    });
  });

  it('shows an unsupported payment basis under its select', () => {
    change(() => {
      updateForm({ accrualMode: 'daycount', paymentBasis: 'exact', repayment: 'balloon' });
    });
    renderPanel();
    const basis = select('field-accrual-paymentBasis');
    expect(basis.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(basis)).not.toBe('');
  });
});

describe('rounding', () => {
  it('sends the rounding modes to the engine', () => {
    renderPanel();
    choose(select('field-rounding-interest'), 'half-even');
    choose(select('field-rounding-fees'), 'floor');
    choose(select('field-rounding-payment'), 'minor-ceil');
    expect(loanInput.value.rounding).toEqual({
      interest: 'half-even',
      fees: 'floor',
      payment: 'minor-ceil',
      principalRemainder: 'last',
    });
  });

  it('offers the principal remainder for equal principal only', () => {
    renderPanel();
    expect(document.getElementById('field-rounding-principalRemainder')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Equal principal/ }));
    choose(select('field-rounding-principalRemainder'), 'first');
    expect(loanInput.value.rounding?.principalRemainder).toBe('first');
  });
});

describe('end-of-month rule', () => {
  it('is offered only when the loan starts on the last day of a month', () => {
    renderPanel();
    expect(document.getElementById('field-endOfMonth')).toBeNull();
    change(() => {
      updateForm({ disbursementDate: '2026-11-30' });
    });
    const rule = input('field-endOfMonth');
    expect(rule.checked).toBe(true);
    expect(descriptionOf(rule)).toBe('The loan starts on the last day of a month');
    fireEvent.click(rule);
    expect(loanInput.value.endOfMonth).toBe(false);
  });
});

describe('headline rate', () => {
  it('follows the currency until the user picks a method', () => {
    renderPanel();
    const headline = select('field-rateMethods');
    expect(headline.options[0]?.text).toBe('Automatic: APR');
    expect([...headline.options].map((option) => option.text)).toContain('APR · Reg Z · US');
    expect(headline.options).toHaveLength(12);
    choose(headline, 'xirr');
    expect(form.value.headlineMethod).toBe('xirr');
    expect(headlineMethod.value).toBe('xirr');
    expect(screen.getByRole('checkbox', { name: 'In XIRR' })).toBeTruthy();
  });
});
