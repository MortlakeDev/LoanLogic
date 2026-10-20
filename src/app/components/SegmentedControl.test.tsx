// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SegmentOption, SegmentedControl } from './SegmentedControl';

type Frequency = 'weekly' | 'monthly' | 'annual';

const OPTIONS: readonly SegmentOption<Frequency>[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

function radio(name: string): HTMLInputElement {
  const element = screen.getByRole('radio', { name });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${name} is not an <input>`);
  }
  return element;
}

afterEach(() => {
  cleanup();
});

describe('SegmentedControl', () => {
  it('renders named native radios with the value checked', () => {
    render(
      <SegmentedControl
        name="frequency"
        legend="Payment frequency"
        options={OPTIONS}
        value="monthly"
        onChange={() => undefined}
      />,
    );
    const group = screen.getByRole('group', { name: 'Payment frequency' });
    expect(group.className).toBe('segmented segmented--solid');
    expect(group.getAttribute('style')).toBeNull();
    expect(group.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByText('Payment frequency').className).toBe('field__label');
    expect(screen.getAllByRole('radio').map((item) => (item as HTMLInputElement).name)).toEqual([
      'frequency',
      'frequency',
      'frequency',
    ]);
    expect(radio('Monthly').checked).toBe(true);
    expect(radio('Weekly').checked).toBe(false);
    expect(radio('Weekly').value).toBe('weekly');
    expect(radio('Weekly').id).toBe('');
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        name="frequency"
        legend="Payment frequency"
        options={OPTIONS}
        value="monthly"
        onChange={onChange}
      />,
    );
    fireEvent.click(radio('Annual'));
    expect(onChange).toHaveBeenCalledWith('annual');
  });

  it('takes the quiet variant, a column count, a first radio id and a description', () => {
    render(
      <SegmentedControl
        name="view"
        legend="View"
        hideLegend
        options={OPTIONS}
        value="weekly"
        onChange={() => undefined}
        variant="quiet"
        columns={3}
        id="field-frequency"
        describedBy="frequency-hint"
      />,
    );
    const group = screen.getByRole('group', { name: 'View' });
    expect(group.className).toBe('segmented segmented--quiet');
    expect(group.style.getPropertyValue('--segment-columns')).toBe('3');
    expect(group.getAttribute('aria-describedby')).toBe('frequency-hint');
    expect(screen.getByText('View').className).toBe('visually-hidden');
    expect(radio('Weekly').id).toBe('field-frequency');
    expect(radio('Monthly').id).toBe('');
  });
});
