// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { feeValueField, form, inputIdFor, type LoanForm, updateForm } from '../state/loan';
import { focusField, moreOpen } from '../state/ui';
import { change, input, renderPanel, resetState } from './__tests__/panel';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  cleanup();
});

/** The status line of the "Fees and advanced settings" disclosure. */
function moreStatusLine(): string {
  return document.querySelector('#more-button .disclosure__status')?.textContent ?? '';
}

describe('InputsPanel', () => {
  it('is the "Loan parameters" card with the loan section first', () => {
    renderPanel();
    const panel = screen.getByRole('region', { name: 'Loan parameters' });
    expect(panel.tagName).toBe('SECTION');
    expect(panel.classList.contains('card')).toBe(true);
    expect(panel.classList.contains('inputs')).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: 'Loan parameters' }).id).toBe(
      'inputs-title',
    );
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Loan', 'Fees & insurance']);
  });

  it('puts fees and Advanced behind one disclosure with a status line', () => {
    renderPanel();
    const button = screen.getByRole('button', { name: /^Fees and advanced settings/ });
    expect(button.getAttribute('aria-controls')).toBe('more-content');
    expect(
      document.getElementById('more-content')?.contains(document.getElementById('field-fees')),
    ).toBe(true);
    expect(moreStatusLine()).toBe('1 fee or insurance item');
    fireEvent.click(button);
    expect(moreOpen.value).toBe(true);

    change(() => {
      updateForm({ roundingInterest: 'floor' });
    });
    expect(moreStatusLine()).toBe('1 fee or insurance item · custom settings');
    change(() => {
      updateForm({ fees: [] });
    });
    expect(moreStatusLine()).toBe('Custom settings');
    change(() => {
      updateForm({ roundingInterest: 'half-up' });
    });
    expect(moreStatusLine()).toBe('Not set');
  });
});

/** Every input `focusField` can target, with a form that shows it. */
const FOCUS_TARGETS: readonly (readonly [string, Partial<LoanForm>])[] = [
  ['amount', {}],
  ['currency', {}],
  ['annualRatePct', {}],
  ['term', {}],
  ['term.years', {}],
  ['term.months', {}],
  ['term.payments', { termMode: 'payments' }],
  ['term.endDate', { termMode: 'endDate' }],
  ['frequency', {}],
  ['repayment', {}],
  ['balloon.kind', { repayment: 'balloon' }],
  ['balloon.value', { repayment: 'balloon' }],
  ['disbursementDate', {}],
  ['fees', {}],
  ['accrual.mode', {}],
  ['accrual.compounding', {}],
  ['accrual.method', { accrualMode: 'daycount' }],
  ['accrual.paymentBasis', { accrualMode: 'daycount' }],
  ['rounding.interest', {}],
  ['rounding.payment', {}],
  ['rounding.fees', {}],
  ['rounding.principalRemainder', { repayment: 'equal-principal' }],
  ['endOfMonth', { disbursementDate: '2026-11-30' }],
  ['rateMethods', {}],
];

describe('focus targets', () => {
  it.each(FOCUS_TARGETS)('has the element of %s', (field, patch) => {
    change(() => {
      updateForm(patch);
    });
    renderPanel();
    expect(document.getElementById(inputIdFor(field))).not.toBeNull();
  });

  it('has the value input of every fee', () => {
    renderPanel();
    for (const fee of form.value.fees) {
      expect(document.getElementById(inputIdFor(feeValueField(fee.uid)))).not.toBeNull();
    }
  });

  it('focuses an advanced field after opening its containers', async () => {
    renderPanel();
    change(() => {
      focusField('rounding.fees');
    });
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('field-rounding-fees');
    });
    expect(screen.getByRole('button', { name: /^Advanced/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('focuses the term group for an error on the whole term', async () => {
    change(() => {
      updateForm({ termYears: '0', termMonths: '0' });
    });
    renderPanel();
    focusField('term');
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('field-term');
    });
    expect(input('field-term-years').getAttribute('aria-describedby')).toBe('field-term-error');
  });
});
