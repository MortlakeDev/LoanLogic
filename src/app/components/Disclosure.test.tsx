// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disclosure } from './Disclosure';

afterEach(() => {
  cleanup();
});

describe('Disclosure', () => {
  it('is a button that controls its content and reports a toggle', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Disclosure id="advanced" title="Advanced" open={false} onToggle={onToggle}>
        <p>Settings</p>
      </Disclosure>,
    );
    const button = screen.getByRole('button', { name: 'Advanced' });
    expect(button.id).toBe('advanced-button');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('advanced-content');
    expect(document.getElementById('advanced-content')?.textContent).toBe('Settings');
    expect(container.querySelector('.disclosure')?.className).toBe('disclosure');
    expect(container.querySelector('.disclosure__status')).toBeNull();
    expect(button.querySelector('svg')?.getAttribute('class')).toBe('icon disclosure__chevron');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows its open state, status line and class', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Disclosure
        id="more"
        title="Fees and advanced"
        status="Monthly · half up"
        open
        onToggle={onToggle}
        class="inputs__more"
      >
        <p>Settings</p>
      </Disclosure>,
    );
    const button = screen.getByRole('button', { name: /^Fees and advanced/ });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Monthly · half up').className).toBe('disclosure__status');
    expect(container.querySelector('.disclosure')?.className).toBe(
      'disclosure disclosure--open inputs__more',
    );
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
