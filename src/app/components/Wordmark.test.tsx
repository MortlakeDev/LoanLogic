// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Wordmark } from './Wordmark';

afterEach(() => {
  cleanup();
});

describe('Wordmark', () => {
  it('is an image named LoanLogic with "Logic" in the accent', () => {
    render(<Wordmark />);
    const svg = screen.getByRole('img', { name: 'LoanLogic' });
    expect(svg.getAttribute('class')).toBe('wordmark');
    expect(svg.getAttribute('focusable')).toBe('false');
    const [loan, logic] = svg.querySelectorAll('path');
    expect(loan?.getAttribute('fill')).toBe('currentColor');
    expect(loan?.getAttribute('class')).toBeNull();
    expect(logic?.getAttribute('class')).toBe('wordmark__accent');
    expect(logic?.getAttribute('fill')).toBeNull();
    expect(logic?.getAttribute('d')).toMatch(/^M/);
  });

  it('adds its class', () => {
    render(<Wordmark class="header__wordmark" />);
    expect(screen.getByRole('img', { name: 'LoanLogic' }).getAttribute('class')).toBe(
      'wordmark header__wordmark',
    );
  });
});
