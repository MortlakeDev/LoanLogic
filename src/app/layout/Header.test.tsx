// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../state/i18n';
import { themePreference } from '../state/theme';
import { Header } from './Header';

beforeEach(() => {
  themePreference.value = 'system';
  setLanguage('en');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Header', () => {
  it('shows the wordmark as the only h1, named LoanLogic, and the byline', () => {
    render(<Header />);
    const banner = screen.getByRole('banner');
    const headings = within(banner).getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    const [heading] = headings;
    expect(within(banner).getByRole('heading', { level: 1, name: 'LoanLogic' })).toBe(heading);
    expect(heading?.querySelector('svg.wordmark')).not.toBeNull();
    expect(within(banner).getByText('by Mortlake')).toBeTruthy();
  });

  it('groups the language pill and the theme button as display settings', () => {
    render(<Header />);
    const group = screen.getByRole('group', { name: 'Display settings' });
    const select = within(group).getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    expect(select.id).toBe('language-select');
    expect(select.classList.contains('select--pill')).toBe(true);
    expect(within(group).getByRole('button', { name: 'Theme' })).toBeTruthy();
    // No placeholders for the region pill or Share (T05, T15).
    expect(within(group).getAllByRole('button')).toHaveLength(1);
  });

  it('has the mobile menu button outside the desktop group', () => {
    render(<Header />);
    const menu = screen.getByRole('button', { name: 'Menu' });
    const group = screen.getByRole('group', { name: 'Display settings' });
    expect(group.contains(menu)).toBe(false);
    expect(screen.getByRole('banner').contains(menu)).toBe(true);
  });

  it('keeps ids and radio names unique with the theme menu and the menu sheet open', () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    // Focus moved into the sheet, which closes the theme menu; its radios stay in the DOM.
    expect(screen.getByRole('button', { name: 'Theme' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.querySelectorAll('fieldset')).toHaveLength(2);
    const names = new Set(
      [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
        (radio) => radio.name,
      ),
    );
    expect(names).toEqual(new Set(['theme', 'menu-theme']));
    expect(document.querySelectorAll('select')).toHaveLength(2);
  });

  it('translates the byline and the control names', async () => {
    render(<Header />);
    await act(() => {
      setLanguage('uk');
    });
    expect(screen.getByText('від Mortlake')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Налаштування відображення' });
    expect(within(group).getByRole('combobox', { name: 'Мова' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Тема' })).toBeTruthy();
    // The wordmark is a proper noun and stays untranslated.
    expect(screen.getByRole('heading', { level: 1, name: 'LoanLogic' })).toBeTruthy();
  });
});
