// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoanResult } from '../../engine';
import { money } from '../state/display';
import { setLanguage, t } from '../state/i18n';
import { okResult, resetForm, setInputInvalid, updateForm } from '../state/loan';
import { methodName, rateFailureReason } from '../state/messages';
import { closeExplain, explainTarget, openExplain } from '../state/ui';
import { ExplainSheet } from './ExplainSheet';
import { FormulaStrip } from './FormulaStrip';

type OkResult = Extract<LoanResult, { readonly ok: true }>;

function current(): OkResult {
  const result = okResult.value;
  if (result === null) {
    throw new Error('The scenario has no result');
  }
  return result;
}

/** Renders the strip and the sheet, as the app does, and returns the strip's action. */
function renderWithStrip(): HTMLElement {
  render(
    <>
      <FormulaStrip explain={current().explain} />
      <ExplainSheet />
    </>,
  );
  return screen.getByRole('button', { name: "How it's calculated" });
}

/** Clicks a trigger the way a browser does: focus first, then the click. */
function activate(trigger: HTMLElement): HTMLElement {
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog');
}

/** The text of the `<dd>` whose `<dt>` starts with `label`. */
function valueOf(dialog: HTMLElement, label: string): string {
  const term = Array.from(dialog.querySelectorAll('dt')).find((dt) =>
    dt.textContent.startsWith(label),
  );
  if (term === undefined) {
    throw new Error(`No value labelled "${label}"`);
  }
  return (term.nextElementSibling?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ');
}

function renderRate(method: Parameters<typeof methodName>[0]): HTMLElement {
  // Opened before rendering: a signal set outside `act` would re-render too late.
  openExplain({ kind: 'rate', method }, null);
  render(<ExplainSheet />);
  return screen.getByRole('dialog');
}

beforeEach(() => {
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  setLanguage('en');
  explainTarget.value = null;
});

afterEach(() => {
  closeExplain();
  cleanup();
});

describe('ExplainSheet', () => {
  it('is closed until something is explained', () => {
    render(<ExplainSheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains the instalment with every value of the payload', () => {
    const dialog = activate(renderWithStrip());
    expect(screen.getByRole('dialog', { name: 'How the payment is calculated' })).toBe(dialog);
    expect(within(dialog).getByText('instalment.annuity')).toBeTruthy();
    const formula = dialog.querySelector('.explain__formula');
    expect(Array.from(formula?.querySelectorAll('p') ?? [], (p) => p.textContent)).toEqual([
      'A = P·i ÷ (1 − (1 + i)−N)',
      'i = j ÷ m',
    ]);
    expect(valueOf(dialog, 'Principal financed')).toBe('350,000.00');
    expect(valueOf(dialog, 'Number of payments')).toBe('360');
    expect(valueOf(dialog, 'Nominal annual rate')).toBe('0.06875');
    expect(valueOf(dialog, 'Payments per year')).toBe('12');
    expect(valueOf(dialog, 'Exact instalment')).toBe('2,299.250848');
    expect(valueOf(dialog, 'Instalment, rounded')).toBe('2,299.25');
    expect(within(dialog).getByRole('heading', { name: 'Result' })).toBeTruthy();
    expect(within(dialog).getByText('$2,299.25')).toBeTruthy();
    expect(within(dialog).getByText(t('explain.instalmentAnnuity'))).toBeTruthy();
    // The instalment has no cash-flow summary.
    expect(within(dialog).queryByRole('heading', { name: 'Cash flows' })).toBeNull();
  });

  it('closes with Esc and returns focus to the trigger', () => {
    const trigger = renderWithStrip();
    const dialog = activate(trigger);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(explainTarget.value).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes with the close button and returns focus to the trigger', () => {
    const trigger = renderWithStrip();
    const dialog = activate(trigger);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab inside the sheet', () => {
    const dialog = activate(renderWithStrip());
    const close = within(dialog).getByRole('button', { name: 'Close' });
    // The default action (leaving the sheet) is prevented and focus stays inside.
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(close);
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('explains the US APR with its cash flows and the Reg Z tolerance', () => {
    const dialog = renderRate('usRegZApr');
    expect(screen.getByRole('dialog', { name: "How it's calculated: APR" })).toBe(dialog);
    expect(within(dialog).getByText('rate.periodic-irr')).toBeTruthy();
    expect(valueOf(dialog, 'Rate per period (IRR)')).toBe('0.005811756069');
    expect(valueOf(dialog, 'Payments per year')).toBe('12');
    expect(within(dialog).getByText('6.974%')).toBeTruthy();
    expect(valueOf(dialog, 'Amount financed')).toBe('$346,500.00');
    expect(within(dialog).getByText('360 payments totalling $827,731.03')).toBeTruthy();
    expect(within(dialog).getByText('Fees in the rate: $3,500.00')).toBeTruthy();
    expect(within(dialog).getByText(/±1\/8 percentage point/)).toBeTruthy();
  });

  it('names the time basis of an annual rate', () => {
    const dialog = renderRate('euAprc');
    expect(valueOf(dialog, 'Time measured in')).toBe('whole payment periods');
    expect(within(dialog).getByText('7.2%')).toBeTruthy();
  });

  it('explains the CN annualized rate (simple) of the CN scenario', () => {
    updateForm({
      currency: 'CNY',
      amount: '1000000.00',
      annualRatePct: '3.10',
      fees: [],
      disbursementDate: '2026-11-15',
    });
    setLanguage('zh-CN');
    const dialog = renderRate('cnAnnualized');
    const title = t('explain.rateTitle', { method: methodName('cnAnnualized') });
    expect(screen.getByRole('dialog', { name: title })).toBe(dialog);
    expect(valueOf(dialog, t('explain.symR'))).toBe('0.002583333502');
    expect(within(dialog).getByText('3.10%')).toBeTruthy();
    const { summary } = current();
    expect(
      within(dialog).getByText(
        t('explain.paymentsTotal', {
          count: summary.paymentsCount,
          amount: money(summary.totalPayments),
        }),
      ),
    ).toBeTruthy();
    // No fee is included in this loan's rate.
    expect(within(dialog).queryByText(t('explain.feesInRate', { amount: money('0') }))).toBeNull();
    expect(dialog.querySelectorAll('.explain__text')).toHaveLength(2);
    expect(within(dialog).getByText(t('explain.noteCnAnnualized'))).toBeTruthy();
  });

  it('shows n/a with the reason for a rate that cannot be computed', () => {
    updateForm({
      amount: '1000.00',
      termMode: 'payments',
      termPayments: '12',
      fees: [
        {
          uid: 'fee-x',
          name: '',
          kind: 'upfront',
          calc: 'fixed',
          value: '999.99',
          financing: 'paid',
          inApr: true,
        },
      ],
    });
    expect(current().rates.xirr).toEqual({ ok: false, reason: 'IRR_NO_CONVERGENCE' });
    const dialog = renderRate('xirr');
    expect(within(dialog).getByText(t('rates.na'))).toBeTruthy();
    expect(within(dialog).getByText(rateFailureReason())).toBeTruthy();
    expect(within(dialog).queryByRole('heading', { name: 'Values' })).toBeNull();
    expect(valueOf(dialog, 'Amount financed')).toBe('$0.01');
    expect(within(dialog).getByText(t('explain.noteXirr'))).toBeTruthy();
  });

  it('gives the contract rate no cash-flow summary', () => {
    const dialog = renderRate('nominal');
    expect(within(dialog).getByText('6.875%')).toBeTruthy();
    expect(within(dialog).queryByRole('heading', { name: 'Cash flows' })).toBeNull();
  });

  it('shows no figures while the input is invalid', () => {
    setInputInvalid('amount', true);
    openExplain({ kind: 'instalment' }, null);
    render(<ExplainSheet />);
    const dialog = screen.getByRole('dialog', { name: 'How the payment is calculated' });
    expect(within(dialog).getByText('Fix the highlighted fields')).toBeTruthy();
    expect(dialog.querySelector('dl')).toBeNull();
  });
});
