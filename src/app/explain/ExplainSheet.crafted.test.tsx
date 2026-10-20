// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { type Signal, signal } from '@preact/signals';
import { cleanup, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LoanResult, calculateLoan } from '../../engine';
import { setLanguage, t } from '../state/i18n';
import type * as LoanModule from '../state/loan';
import { form, okResult, resetForm, toLoanInput } from '../state/loan';
import { closeExplain, openExplain } from '../state/ui';
import { ExplainSheet } from './ExplainSheet';

type OkResult = Extract<LoanResult, { readonly ok: true }>;

// Results the engine never returns today (an unknown formula id, a metric that was not
// requested), so the sheet's handling of them is tested with a result set by hand.
vi.mock('../state/loan', async (importOriginal) => {
  const actual = await importOriginal<typeof LoanModule>();
  return { ...actual, okResult: signal(null) };
});

const crafted = okResult as Signal<OkResult | null>;

/** The design scenario of the current form, so fee ids match the form's fees. */
function designResult(): OkResult {
  const result = calculateLoan(toLoanInput({ ...form.value, disbursementDate: '2026-11-01' }));
  if (!result.ok) {
    throw new Error('The design scenario failed');
  }
  return result;
}

beforeEach(() => {
  resetForm();
  setLanguage('en');
});

afterEach(() => {
  closeExplain();
  crafted.value = null;
  cleanup();
});

describe('ExplainSheet with crafted results', () => {
  it('shows an unknown instalment formula as its id and raw values only', () => {
    crafted.value = {
      ...designResult(),
      explain: { formulaId: 'instalment.future', values: { P: '1000.00', mode: 'fast' } },
    };
    openExplain({ kind: 'instalment' }, null);
    render(<ExplainSheet />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('instalment.future')).toBeTruthy();
    expect(Array.from(dialog.querySelectorAll('dt'), (dt) => dt.textContent)).toEqual([
      'P',
      'mode',
    ]);
    expect(Array.from(dialog.querySelectorAll('dd'), (dd) => dd.textContent)).toEqual([
      '1,000',
      'fast',
    ]);
    for (const heading of ['Formula', 'Result', 'Note']) {
      expect(within(dialog).queryByRole('heading', { name: heading })).toBeNull();
    }
  });

  it('shows n/a without a reason for a rate that was not computed', () => {
    crafted.value = { ...designResult(), rates: {} };
    openExplain({ kind: 'rate', method: 'ukAprc' }, null);
    render(<ExplainSheet />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(t('rates.na'))).toBeTruthy();
    // Only the cash-flow lines and the note: no failure reason is invented.
    expect(Array.from(dialog.querySelectorAll('.explain__text'), (p) => p.textContent)).toEqual([
      '360 payments totalling $827,731.03',
      'Fees in the rate: $3,500.00',
      t('explain.noteUkAprc'),
    ]);
  });
});
