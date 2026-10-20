// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { JSX } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatNumber } from '../../i18n';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import { setLanguage } from '../state/i18n';
import {
  feeValueField,
  form,
  inputErrors,
  inputRevision,
  resetForm,
  setInputInvalid,
  updateForm,
} from '../state/loan';
import {
  Field,
  FieldError,
  FieldGroup,
  NumberInput,
  describedBy,
  errorIdFor,
  formatInputValue,
  hasError,
} from './Field';

/** Intl separates groups with NBSP or narrow NBSP; compare with plain spaces. */
function spaced(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

function textbox(name: string): HTMLInputElement {
  const element = screen.getByRole('textbox', { name });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${name} is not an <input>`);
  }
  return element;
}

/** The amount field wired to the form state, as the inputs panel wires it. */
function AmountField(): JSX.Element {
  return (
    <Field
      label="Amount"
      inputId="field-amount"
      hint="The loan amount"
      hintId="amount-hint"
      fields={['amount']}
    >
      <NumberInput
        id="field-amount"
        field="amount"
        kind="money"
        value={form.value.amount}
        onValue={(value) => {
          updateForm({ amount: value });
        }}
        fractionDigits={2}
        prefix="$"
        hintId="amount-hint"
      />
    </Field>
  );
}

beforeEach(() => {
  resetForm();
  setLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('error helpers', () => {
  it('derive the error id from the input id', () => {
    expect(errorIdFor('amount')).toBe('field-amount-error');
    expect(errorIdFor('term.years')).toBe('field-term-years-error');
    expect(errorIdFor(feeValueField('fee-2'))).toBe('fee-fee-2-value-error');
  });

  it('tell whether a field has a typing or engine error', () => {
    expect(hasError('amount')).toBe(false);
    setInputInvalid('amount', true);
    expect(hasError('amount')).toBe(true);
    setInputInvalid('amount', false);
    updateForm({ annualRatePct: '2000' });
    expect(hasError('annualRatePct')).toBe(true);
  });

  it('join the hint and the error id for aria-describedby', () => {
    expect(describedBy('amount')).toBeUndefined();
    expect(describedBy('amount', 'amount-hint')).toBe('amount-hint');
    setInputInvalid('amount', true);
    expect(describedBy('amount')).toBe('field-amount-error');
    expect(describedBy('amount', 'amount-hint')).toBe('amount-hint field-amount-error');
  });
});

describe('formatInputValue', () => {
  it('shows money with grouping and at least the minor units', () => {
    expect(formatInputValue('350000.5', 'money', 'en-US', 2)).toBe('350,000.50');
    expect(formatInputValue('1234', 'money', 'en-US')).toBe('1,234');
    expect(spaced(formatInputValue('350000', 'money', 'ru-RU', 2))).toBe('350 000,00');
  });

  it('keeps every digit entered, even beyond the minor units', () => {
    expect(formatInputValue('100.005', 'money', 'en-US', 2)).toBe('100.005');
    expect(formatInputValue('6.50', 'percent', 'en-US')).toBe('6.50');
  });

  it('shows percentages and counts without grouping', () => {
    expect(formatInputValue('1000.5', 'percent', 'en-US')).toBe('1000.5');
    expect(formatInputValue('6.875', 'percent', 'ru-RU')).toBe('6,875');
    expect(formatInputValue('1200', 'integer', 'en-US')).toBe('1200');
  });

  it('leaves an empty value empty', () => {
    expect(formatInputValue('', 'money', 'en-US', 2)).toBe('');
  });
});

describe('Field, FieldGroup and FieldError', () => {
  it('labels its control and shows the hint with its id', () => {
    render(
      <Field label="Rate" inputId="rate" hint="Nominal, per year" hintId="rate-hint" fields={[]}>
        <input id="rate" />
      </Field>,
    );
    const input = textbox('Rate');
    expect(input.id).toBe('rate');
    const hint = screen.getByText('Nominal, per year');
    expect(hint.id).toBe('rate-hint');
    expect(hint.className).toBe('field__hint');
    expect(input.closest('.field')?.className).toBe('field');
  });

  it('adds its class and renders no hint when none is given', () => {
    const { container } = render(
      <Field label="Rate" inputId="rate" fields={[]} class="field--wide">
        <input id="rate" />
      </Field>,
    );
    expect(container.querySelector('.field')?.className).toBe('field field--wide');
    expect(container.querySelector('.field__hint')).toBeNull();
  });

  it('shows the errors of its fields with the error id', () => {
    setInputInvalid('term.years', true);
    setInputInvalid('term.months', true);
    render(
      <Field label="Years" inputId="field-term-years" fields={['term.years', 'term.months']}>
        <input id="field-term-years" />
      </Field>,
    );
    const errors = document.querySelectorAll('.field__error');
    expect([...errors].map((error) => error.id)).toEqual([
      'field-term-years-error',
      'field-term-months-error',
    ]);
    expect(errors[0]?.textContent).toBe(en['errors.inputInvalidInteger']);
    expect(errors[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('groups several controls under a legend', () => {
    render(
      <FieldGroup
        label="Term"
        hint="360 payments"
        hintId="term-hint"
        fields={['term.years']}
        class="field--term"
      >
        <input aria-label="Years" />
        <input aria-label="Months" />
      </FieldGroup>,
    );
    const group = screen.getByRole('group', { name: 'Term' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.className).toBe('field field--term');
    expect(screen.getByText('360 payments').id).toBe('term-hint');
    expect(group.querySelector('.field__error')).toBeNull();
  });

  it('renders a group without class or hint', () => {
    setInputInvalid('term.years', true);
    render(
      <FieldGroup label="Term" fields={['term.years']}>
        <input aria-label="Years" />
      </FieldGroup>,
    );
    const group = screen.getByRole('group', { name: 'Term' });
    expect(group.className).toBe('field');
    expect(group.querySelector('.field__hint')).toBeNull();
    expect(group.querySelector('#field-term-years-error')).not.toBeNull();
  });

  it('shows an engine error in the UI language', async () => {
    updateForm({ amount: '0' });
    render(<FieldError field="amount" />);
    expect(
      screen.getByText('Enter an amount above zero, up to 1,000,000,000,000,000.'),
    ).toBeTruthy();
    await act(() => {
      setLanguage('ru');
    });
    expect(document.getElementById('field-amount-error')?.textContent).toBe(
      ru['errors.amountRange'].replace('{max}', formatNumber('1000000000000000', 'ru-RU')),
    );
  });

  it('renders nothing for a field without an error', () => {
    const { container } = render(<FieldError field="amount" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('NumberInput', () => {
  it('parses Russian formatting into the engine string', () => {
    setLanguage('ru');
    const onValue = vi.fn();
    render(
      <NumberInput
        id="amount"
        field="amount"
        kind="money"
        value="350000.00"
        onValue={onValue}
        fractionDigits={2}
        ariaLabel="Сумма"
      />,
    );
    const input = textbox('Сумма');
    expect(spaced(input.value)).toBe('350 000,00');
    fireEvent.input(input, { target: { value: '350 000,50' } });
    expect(onValue).toHaveBeenCalledWith('350000.50');
    expect(inputErrors.value.size).toBe(0);
  });

  it('parses US formatting into the engine string', () => {
    const onValue = vi.fn();
    render(
      <NumberInput
        id="amount"
        field="amount"
        kind="money"
        value="350000.00"
        onValue={onValue}
        ariaLabel="Amount"
      />,
    );
    fireEvent.input(textbox('Amount'), { target: { value: '350,000.50' } });
    expect(onValue).toHaveBeenCalledWith('350000.50');
  });

  it('does not report a value equal to the state', () => {
    const onValue = vi.fn();
    render(
      <NumberInput
        id="amount"
        field="amount"
        kind="money"
        value="350000.00"
        onValue={onValue}
        ariaLabel="Amount"
      />,
    );
    fireEvent.input(textbox('Amount'), { target: { value: '350,000.00' } });
    expect(onValue).not.toHaveBeenCalled();
  });

  it('marks text that does not parse, shows the error and blanks nothing else', () => {
    render(<AmountField />);
    const input = textbox('Amount');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBe('amount-hint');
    fireEvent.input(input, { target: { value: '12,34,567' } });
    expect(inputErrors.value.has('amount')).toBe(true);
    expect(form.value.amount).toBe('350000.00');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('amount-hint field-amount-error');
    expect(input.closest('.control')?.className).toBe('control control--invalid');
    expect(document.getElementById('field-amount-error')?.textContent).toBe(
      'Enter an amount such as 350,000.50.',
    );
    // Fixing the text clears the mark.
    fireEvent.input(input, { target: { value: '1,234,567' } });
    expect(inputErrors.value.has('amount')).toBe(false);
    expect(form.value.amount).toBe('1234567');
    expect(document.getElementById('field-amount-error')).toBeNull();
  });

  it('reformats a valid value on blur and keeps an invalid one as typed', () => {
    render(<AmountField />);
    const input = textbox('Amount');
    fireEvent.input(input, { target: { value: '350000.5' } });
    expect(form.value.amount).toBe('350000.5');
    expect(input.value).toBe('350000.5');
    fireEvent.blur(input);
    expect(input.value).toBe('350,000.50');

    fireEvent.input(input, { target: { value: '12,34,567' } });
    fireEvent.blur(input);
    expect(input.value).toBe('12,34,567');
    expect(inputErrors.value.has('amount')).toBe(true);
  });

  it('keeps the value on blur without an edit', () => {
    render(<AmountField />);
    const input = textbox('Amount');
    fireEvent.blur(input);
    expect(input.value).toBe('350,000.00');
  });

  it('follows a language change when not editing', async () => {
    render(<AmountField />);
    const input = textbox('Amount');
    expect(input.value).toBe('350,000.00');
    await act(() => {
      setLanguage('ru');
    });
    expect(spaced(input.value)).toBe('350 000,00');
  });

  it('keeps the text being edited through a language change', async () => {
    render(<AmountField />);
    const input = textbox('Amount');
    fireEvent.input(input, { target: { value: '12,34,567' } });
    await act(() => {
      setLanguage('uk');
    });
    expect(input.value).toBe('12,34,567');
  });

  it('shows units, a large size and the keyboard of the kind', () => {
    const { container } = render(
      <>
        <NumberInput
          id="rate"
          field="annualRatePct"
          kind="percent"
          value="6.875"
          onValue={() => undefined}
          suffix="%"
          size="lg"
          ariaLabel="Rate"
        />
        <NumberInput
          id="years"
          field="term.years"
          kind="integer"
          value="30"
          onValue={() => undefined}
          ariaLabel="Years"
        />
      </>,
    );
    const rate = textbox('Rate');
    expect(rate.value).toBe('6.875');
    expect(rate.getAttribute('inputmode')).toBe('decimal');
    expect(rate.getAttribute('autocomplete')).toBe('off');
    expect(rate.hasAttribute('aria-describedby')).toBe(false);
    expect(rate.closest('.control')?.className).toBe('control control--lg');
    const affixes = container.querySelectorAll('.control__affix');
    expect([...affixes].map((affix) => affix.textContent)).toEqual(['%']);
    expect(affixes[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(textbox('Years').getAttribute('inputmode')).toBe('numeric');
  });

  it('shows a prefix before the input', () => {
    render(<AmountField />);
    const input = textbox('Amount');
    const prefix = input.previousElementSibling;
    expect(prefix?.className).toBe('control__affix');
    expect(prefix?.textContent).toBe('$');
    expect(input.nextElementSibling).toBeNull();
  });

  it('parses integers and percentages by their kind', () => {
    const onYears = vi.fn();
    const onRate = vi.fn();
    render(
      <>
        <NumberInput
          id="years"
          field="term.years"
          kind="integer"
          value="30"
          onValue={onYears}
          ariaLabel="Years"
        />
        <NumberInput
          id="rate"
          field="annualRatePct"
          kind="percent"
          value="6.875"
          onValue={onRate}
          ariaLabel="Rate"
        />
      </>,
    );
    fireEvent.input(textbox('Years'), { target: { value: '25' } });
    expect(onYears).toHaveBeenCalledWith('25');
    fireEvent.input(textbox('Years'), { target: { value: '2.5' } });
    expect(inputErrors.value.has('term.years')).toBe(true);
    fireEvent.input(textbox('Rate'), { target: { value: '7,25' } });
    expect(onRate).toHaveBeenCalledWith('7.25');
  });
});

describe('NumberInput: review fixes', () => {
  it('clears its typing error when it goes away, so the results can come back', () => {
    const view = render(
      <NumberInput
        id="balloon"
        field="balloon.value"
        kind="money"
        value="1.00"
        onValue={vi.fn()}
        ariaLabel="Balloon"
      />,
    );
    fireEvent.input(textbox('Balloon'), { target: { value: 'abc' } });
    expect(inputErrors.value.has('balloon.value')).toBe(true);
    view.unmount();
    expect(inputErrors.value.has('balloon.value')).toBe(false);
  });

  it('applies text typed before a language change when it parses in the new locale', async () => {
    const onValue = vi.fn();
    render(
      <NumberInput
        id="amount"
        field="amount"
        kind="money"
        value="350000.00"
        onValue={onValue}
        fractionDigits={2}
        ariaLabel="Amount"
      />,
    );
    const input = textbox('Amount');
    // A space does not group digits in en-US …
    fireEvent.input(input, { target: { value: '1 000 000' } });
    expect(inputErrors.value.has('amount')).toBe(true);
    // … but it does in ru-RU: leaving the field applies the value instead of dropping it.
    await act(() => {
      setLanguage('ru');
    });
    fireEvent.blur(input);
    expect(onValue).toHaveBeenCalledWith('1000000');
    expect(inputErrors.value.has('amount')).toBe(false);
  });

  it('shows a value with more than 20 decimals instead of crashing', () => {
    expect(formatInputValue('6.5000000000000000000000', 'percent', 'en-US')).toBe(
      '6.5000000000000000000000',
    );
    expect(formatInputValue('1.0000000000000000000001', 'money', 'en-US', 2)).toBe(
      '1.0000000000000000000001',
    );
  });

  it('counts every keystroke, valid or not', () => {
    render(
      <NumberInput
        id="rate"
        field="annualRatePct"
        kind="percent"
        value="6.875"
        onValue={vi.fn()}
        ariaLabel="Rate"
      />,
    );
    const before = inputRevision.value;
    fireEvent.input(textbox('Rate'), { target: { value: '6,' } });
    fireEvent.input(textbox('Rate'), { target: { value: 'x' } });
    expect(inputRevision.value).toBe(before + 2);
  });
});
