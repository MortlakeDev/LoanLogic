// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChoiceOption, ChoiceCards } from './ChoiceCards';

type Repayment = 'annuity' | 'bullet';

const OPTIONS: readonly ChoiceOption<Repayment>[] = [
  { value: 'annuity', title: 'Equal payments', description: 'Same amount every period' },
  { value: 'bullet', title: 'Interest-only', description: 'Principal at the end' },
];

function radio(name: RegExp): HTMLInputElement {
  const element = screen.getByRole('radio', { name });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${String(name)} is not an <input>`);
  }
  return element;
}

afterEach(() => {
  cleanup();
});

describe('ChoiceCards', () => {
  it('renders a radio per option, described by its line of text', () => {
    render(
      <ChoiceCards
        name="repayment"
        legend="Repayment"
        options={OPTIONS}
        value="annuity"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'Repayment' }).className).toBe('choices');
    const annuity = radio(/^Equal payments/);
    expect(annuity.checked).toBe(true);
    expect(annuity.name).toBe('repayment');
    expect(annuity.value).toBe('annuity');
    const descriptionId = annuity.getAttribute('aria-describedby');
    expect(descriptionId).toBe('repayment-annuity-text');
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'Same amount every period',
    );
    expect(radio(/^Interest-only/).checked).toBe(false);
    expect(radio(/^Interest-only/).getAttribute('aria-describedby')).toBe('repayment-bullet-text');
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    render(
      <ChoiceCards
        name="repayment"
        legend="Repayment"
        options={OPTIONS}
        value="annuity"
        onChange={onChange}
      />,
    );
    fireEvent.click(radio(/^Interest-only/));
    expect(onChange).toHaveBeenCalledWith('bullet');
  });
});
