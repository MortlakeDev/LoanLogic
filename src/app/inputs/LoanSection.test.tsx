// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../state/i18n';
import { money } from '../state/display';
import { form, loanInput, okResult, updateForm } from '../state/loan';
import {
  byId,
  change,
  choose,
  descriptionOf,
  input,
  renderPanel,
  resetState,
  select,
  typeInto,
} from './__tests__/panel';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  cleanup();
});

describe('amount and currency', () => {
  it('parses the amount in the UI locale into the engine string', () => {
    setLanguage('ru');
    renderPanel();
    const amount = input('field-amount');
    typeInto(amount, '350 000,50');
    expect(loanInput.value.amount).toBe('350000.50');
    // Reformatted on blur in the locale (NBSP grouping).
    expect(amount.value).toBe('350 000,50');
  });

  it('is a large control with the currency symbol', () => {
    renderPanel();
    const amount = input('field-amount');
    expect(amount.closest('.control')?.classList.contains('control--lg')).toBe(true);
    expect(amount.closest('.control')?.textContent).toContain('$');
    expect(amount.value).toBe('350,000.00');
  });

  it('lists the common currencies first, then every other code A–Z', () => {
    renderPanel();
    const currency = select('field-currency');
    expect(currency.getAttribute('aria-label')).toBe('Currency');
    const [common, all] = [...currency.querySelectorAll('optgroup')];
    expect(common?.label).toBe('Common currencies');
    expect(all?.label).toBe('All currencies');
    const codes = (group: HTMLOptGroupElement | undefined): string[] =>
      [...(group?.querySelectorAll('option') ?? [])].map((option) => option.value);
    expect(codes(common)).toEqual([
      'USD',
      'EUR',
      'GBP',
      'CNY',
      'UAH',
      'JPY',
      'CHF',
      'CAD',
      'AUD',
      'PLN',
    ]);
    const others = codes(all);
    expect(others).toEqual([...others].sort());
    expect(others).not.toContain('USD');
    expect(others).toContain('SEK');
    expect(common?.querySelector('option')?.textContent).toBe('USD · US Dollar');
  });

  it('changes the currency of the loan and of the amount control', () => {
    renderPanel();
    choose(select('field-currency'), 'EUR');
    expect(loanInput.value.currency).toBe('EUR');
    expect(document.querySelector('.currency__face')?.textContent).toBe('EUR');
    expect(input('field-amount').closest('.control')?.textContent).toContain('€');
  });

  it('reformats the amount when the UI language changes', () => {
    renderPanel();
    expect(input('field-amount').value).toBe('350,000.00');
    change(() => {
      setLanguage('ru');
    });
    expect(input('field-amount').value).toBe('350 000,00');
  });

  it('shows an amount that does not parse as a localized error', () => {
    renderPanel();
    const amount = input('field-amount');
    typeInto(amount, '12abc');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(amount)).toContain('350,000.50');
    expect(amount.value).toBe('12abc');
  });
});

describe('rate', () => {
  it('accepts a comma as the decimal separator', () => {
    setLanguage('ru');
    renderPanel();
    const rate = input('field-annualRatePct');
    typeInto(rate, '6,5');
    expect(loanInput.value.annualRatePct).toBe('6.5');
    expect(descriptionOf(rate)).toBe(t('inputs.rateHint'));
  });

  it('shows the engine range error under the field', () => {
    renderPanel();
    const rate = input('field-annualRatePct');
    typeInto(rate, '1001');
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(rate)).toContain('1,000%');
  });
});

describe('term', () => {
  it('takes years and months with the scheduled payments as the hint', () => {
    renderPanel();
    const years = input('field-term-years');
    const months = input('field-term-months');
    expect(years.getAttribute('aria-label')).toBe('Years');
    expect(months.getAttribute('aria-label')).toBe('Months');
    expect(descriptionOf(years)).toBe('360 payments');
    typeInto(years, '15');
    typeInto(months, '6');
    expect(loanInput.value.term).toEqual({ years: 15, months: 6 });
    expect(descriptionOf(months)).toBe('186 payments');
  });

  it('shows a term that does not parse and one that is too short', () => {
    renderPanel();
    const years = input('field-term-years');
    typeInto(years, 'abc');
    expect(years.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(years)).toBe(t('errors.inputInvalidInteger'));
    expect(document.querySelector('.term__box--invalid')).not.toBeNull();

    typeInto(years, '0');
    typeInto(input('field-term-months'), '0');
    const term = byId('field-term', HTMLFieldSetElement);
    expect(term.tabIndex).toBe(-1);
    expect(descriptionOf(term)).toBe(t('errors.termTooShort'));
    expect(descriptionOf(years)).toBe(t('errors.termTooShort'));
    // The whole term is wrong, so both of its inputs say so.
    expect(years.getAttribute('aria-invalid')).toBe('true');
    expect(input('field-term-months').getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.term__box--invalid')).not.toBeNull();
  });

  it('shows a years value out of range on the years input', () => {
    renderPanel();
    const years = input('field-term-years');
    typeInto(years, '101');
    expect(years.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(years)).toContain('100');
  });

  it('takes a number of payments', () => {
    change(() => {
      updateForm({ termMode: 'payments' });
    });
    renderPanel();
    const payments = input('field-term-payments');
    expect(byId('field-term', HTMLFieldSetElement).querySelector('legend')?.textContent).toBe(
      'Number of payments',
    );
    expect(payments.getAttribute('aria-label')).toBe('Number of payments');
    typeInto(payments, '240');
    expect(loanInput.value.term).toEqual({ payments: 240 });
    expect(descriptionOf(payments)).toBe('240 payments');
    typeInto(payments, '1201');
    expect(payments.getAttribute('aria-invalid')).toBe('true');
  });

  it('takes the date of the last payment', () => {
    change(() => {
      updateForm({ termMode: 'endDate', termEndDate: '' });
    });
    renderPanel();
    const end = input('field-term-endDate');
    expect(end.type).toBe('date');
    expect(end.getAttribute('aria-labelledby')).toBe('field-term-legend');
    expect(document.getElementById('field-term-legend')?.textContent).toBe('Last payment by');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(end)).toBe(t('errors.endDateInvalid'));
    expect(document.querySelector('.inputs__pair--wide')).not.toBeNull();

    typeInto(end, '2036-11-01');
    expect(loanInput.value.term).toEqual({ endDate: '2036-11-01' });
    expect(end.getAttribute('aria-invalid')).toBe('false');
    expect(descriptionOf(end)).toBe('120 payments');
  });
});

/** The engine's balloon amount, formatted. */
function balloonShown(): string {
  const balloon = okResult.value?.summary.balloon;
  if (balloon === undefined || balloon === null) {
    throw new Error('no balloon in the result');
  }
  return money(balloon);
}

describe('frequency and repayment', () => {
  it('offers six frequencies in a solid 3-column control', () => {
    renderPanel();
    const first = input('field-frequency');
    expect(first.name).toBe('frequency');
    expect(first.closest('.segmented--solid')).not.toBeNull();
    expect(screen.getAllByRole('radio', { name: /weekly|monthly|quarterly|annual/i })).toHaveLength(
      6,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Bi-weekly' }));
    expect(loanInput.value.frequency).toBe('biweekly');
  });

  it('picks a repayment type from the cards', () => {
    renderPanel();
    expect(byId('field-repayment', HTMLDivElement).tabIndex).toBe(-1);
    fireEvent.click(screen.getByRole('radio', { name: /^Equal principal/ }));
    expect(loanInput.value.repayment).toBe('equal-principal');
    expect(document.getElementById('field-balloon-value')).toBeNull();
  });

  it('reveals the balloon residual as a percentage or an amount', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /^Balloon/ }));
    expect(loanInput.value.balloon).toEqual({ kind: 'percent', value: '30' });
    const value = input('field-balloon-value');
    expect(value.closest('.control')?.textContent).toContain('%');
    // The engine's balloon part of the last payment (SPEC §5.5), not the 30 % as entered.
    expect(descriptionOf(value)).toBe(`${balloonShown()} with the final payment`);
    expect(balloonShown()).toMatch(/^\$104,\d{3}\.\d{2}$/);

    typeInto(value, '25.5');
    expect(loanInput.value.balloon).toEqual({ kind: 'percent', value: '25.5' });

    fireEvent.click(screen.getByRole('radio', { name: 'Amount' }));
    expect(input('field-balloon-kind').value).toBe('amount');
    const amount = input('field-balloon-value');
    expect(amount.closest('.control')?.textContent).toContain('$');
    typeInto(amount, '100,000');
    expect(loanInput.value.balloon).toEqual({ kind: 'amount', value: '100000' });
    expect(descriptionOf(amount)).toBe(`${balloonShown()} with the final payment`);
  });

  it('shows a balloon out of range under the balloon field', () => {
    change(() => {
      updateForm({ repayment: 'balloon', balloonKind: 'percent', balloonValue: '100' });
    });
    renderPanel();
    const value = input('field-balloon-value');
    expect(value.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(value)).toBe(t('errors.balloonRange'));
  });
});

describe('disbursement date', () => {
  it('is a native date input with the first payment as the hint', () => {
    renderPanel();
    const date = input('field-disbursementDate');
    expect(date.type).toBe('date');
    expect(date.value).toBe('2026-11-01');
    expect(descriptionOf(date)).toBe('First payment Dec 1, 2026');
    typeInto(date, '2027-01-15');
    expect(loanInput.value.disbursementDate).toBe('2027-01-15');
    expect(descriptionOf(date)).toBe('First payment Feb 15, 2027');
  });

  it('reports a cleared date under the field', () => {
    renderPanel();
    const date = input('field-disbursementDate');
    typeInto(date, '');
    expect(form.value.disbursementDate).toBe('');
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(date.closest('.control')?.classList.contains('control--invalid')).toBe(true);
    expect(descriptionOf(date)).toContain('9999');
  });
});
