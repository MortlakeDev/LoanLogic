// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../state/i18n';
import { type FeeDraft, form, loanInput, updateForm } from '../state/loan';
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

/** The only fee of the form (the design scenario's origination fee). */
function onlyFee(): FeeDraft {
  const [fee] = form.value.fees;
  if (fee === undefined || form.value.fees.length !== 1) {
    throw new Error('expected exactly one fee');
  }
  return fee;
}

/** The engine input of the only fee. */
function feeInput(): unknown {
  return loanInput.value.fees?.[0];
}

describe('fee rows', () => {
  it('shows the design scenario fee with its amounts from the engine', () => {
    renderPanel();
    const { uid } = onlyFee();
    expect(document.getElementById(`fee-${uid}-summary`)?.textContent).toBe(
      '$3,500.00 · paid at closing · in APR',
    );
    const value = input(`fee-${uid}-value`);
    expect(value.value).toBe('1');
    expect(value.closest('.control')?.textContent).toContain('%');
    expect(descriptionOf(value)).toBe('$3,500.00 · paid at closing · in APR');
    expect(input(`fee-${uid}-name`).placeholder).toBe('Origination fee');
    expect(screen.getByRole('button', { name: 'Remove Origination fee' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'In APR' })).toBeTruthy();
  });

  it('sends every edit of a row to the engine input', () => {
    renderPanel();
    const { uid } = onlyFee();
    typeInto(input(`fee-${uid}-name`), 'Arrangement fee', false);
    expect(onlyFee().name).toBe('Arrangement fee');
    expect(screen.getByRole('button', { name: 'Remove Arrangement fee' })).toBeTruthy();

    choose(select(`fee-${uid}-calc`), 'fixed');
    const value = input(`fee-${uid}-value`);
    expect(value.closest('.control')?.textContent).toContain('$');
    typeInto(value, '1,250.50');
    choose(select(`fee-${uid}-financing`), 'financed');
    fireEvent.click(screen.getByRole('checkbox', { name: 'In APR' }));
    expect(feeInput()).toEqual({
      id: uid,
      kind: 'upfront',
      calc: 'fixed',
      value: '1250.50',
      financing: 'financed',
      inApr: false,
    });
    expect(document.getElementById(`fee-${uid}-summary`)?.textContent).toBe(
      '$1,250.50 · added to the loan · not in APR',
    );
  });

  it('maps the calculation when the kind changes and shows periodic amounts', () => {
    renderPanel();
    const { uid } = onlyFee();
    choose(select(`fee-${uid}-kind`), 'periodic');
    expect(feeInput()).toEqual({
      id: uid,
      kind: 'periodic',
      calc: 'pct-original',
      value: '1',
      inApr: true,
    });
    expect([...select(`fee-${uid}-calc`).options].map((option) => option.value)).toEqual([
      'fixed',
      'pct-original',
      'pct-balance',
    ]);
    expect(document.getElementById(`fee-${uid}-financing`)).toBeNull();
    expect(input(`fee-${uid}-name`).placeholder).toBe('Periodic fee');
    const value = input(`fee-${uid}-value`);
    expect(descriptionOf(value)).toBe(
      `${t('fees.valuePerPeriod')} | $3,500.00 per payment · $1,260,000.00 in total · in APR`,
    );

    choose(select(`fee-${uid}-calc`), 'pct-balance');
    expect(document.getElementById(`fee-${uid}-summary`)?.textContent).toMatch(
      /^\$3,500\.00 in the first period · \$[\d,]+\.\d{2} in total · in APR$/,
    );

    choose(select(`fee-${uid}-kind`), 'insurance');
    expect(feeInput()).toMatchObject({ kind: 'insurance', calc: 'pct-balance' });
    expect(input(`fee-${uid}-name`).placeholder).toBe('Insurance');

    choose(select(`fee-${uid}-kind`), 'upfront');
    expect(feeInput()).toMatchObject({ kind: 'upfront', calc: 'percent' });
  });

  it('shows a fixed periodic fee per payment', () => {
    renderPanel();
    const { uid } = onlyFee();
    choose(select(`fee-${uid}-kind`), 'insurance');
    choose(select(`fee-${uid}-calc`), 'fixed');
    typeInto(input(`fee-${uid}-value`), '25');
    expect(document.getElementById(`fee-${uid}-summary`)?.textContent).toBe(
      '$25.00 per payment · $9,000.00 in total · in APR',
    );
    expect(descriptionOf(input(`fee-${uid}-value`))).not.toContain(t('fees.valuePerPeriod'));
  });

  it('shows no amounts while there is no result', () => {
    renderPanel();
    const { uid } = onlyFee();
    typeInto(input('field-amount'), 'abc');
    expect(document.getElementById(`fee-${uid}-summary`)).toBeNull();
  });
});

describe('adding and removing', () => {
  it('adds a row and moves focus to its name', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a fee' }));
    const added = form.value.fees[1];
    expect(added).toBeDefined();
    const uid = added?.uid ?? '';
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`fee-${uid}-name`);
    });
    expect(loanInput.value.fees?.[1]).toEqual({
      id: uid,
      kind: 'upfront',
      calc: 'fixed',
      value: '0',
      financing: 'paid',
      inApr: true,
    });
    expect(screen.getByRole('button', { name: 'Add a fee' }).textContent).toBe('Fee');
  });

  it('removes a row, says when the list is empty and keeps focus on the add button', () => {
    renderPanel();
    const { uid } = onlyFee();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Origination fee' }));
    expect(form.value.fees).toEqual([]);
    expect(document.getElementById(`fee-${uid}-value`)).toBeNull();
    expect(screen.getByText(t('fees.none'))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a fee' }));
  });
});

describe('fee errors', () => {
  it('shows upfront fees that reach the amount on the section', () => {
    renderPanel();
    const { uid } = onlyFee();
    choose(select(`fee-${uid}-calc`), 'fixed');
    typeInto(input(`fee-${uid}-value`), '350000');
    const section = byId('field-fees', HTMLElement);
    expect(section.tabIndex).toBe(-1);
    expect(descriptionOf(section)).toBe(t('errors.feeRangeTotal'));
    expect(input(`fee-${uid}-value`).getAttribute('aria-invalid')).toBe('false');
  });

  it('shows a fee value out of range under the value', () => {
    renderPanel();
    const { uid } = onlyFee();
    const value = input(`fee-${uid}-value`);
    typeInto(value, '150');
    expect(value.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(value)).toContain('100%');
    expect(byId('field-fees', HTMLElement).getAttribute('aria-describedby')).toBeNull();
  });

  it('names the rate of the headline method', () => {
    change(() => {
      updateForm({ currency: 'EUR' });
    });
    renderPanel();
    expect(screen.getByRole('checkbox', { name: 'In APRC' })).toBeTruthy();
  });
});
