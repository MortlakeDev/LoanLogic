// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { language, setLanguage } from '../state/i18n';
import { themePreference } from '../state/theme';
import { MobileMenu } from './MobileMenu';

/** Renders the menu and opens its sheet; returns the button and the dialog. */
function openMenu(): { button: HTMLElement; dialog: HTMLElement } {
  render(<MobileMenu />);
  const button = screen.getByRole('button', { name: 'Menu' });
  fireEvent.click(button);
  return { button, dialog: screen.getByRole('dialog', { name: 'Settings' }) };
}

beforeEach(() => {
  themePreference.value = 'system';
  setLanguage('en');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('MobileMenu', () => {
  it('is a menu button for a dialog, with no sheet until it is pressed', () => {
    render(<MobileMenu />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a modal sheet with the language select and the theme radios', () => {
    const { button, dialog } = openMenu();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Settings' })).toBeTruthy();

    const select = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    expect(select.id).toBe('menu-language-select');
    expect(select.value).toBe('en');

    const group = within(dialog).getByRole('group', { name: 'Theme' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.value)).toEqual(['system', 'dark', 'light']);
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['menu-theme']));
    // Focus starts inside the sheet, on its close button.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('puts the theme radios before the language select, so the focus trap wraps', () => {
    const { dialog } = openMenu();
    const group = within(dialog).getByRole('group', { name: 'Theme' });
    const select = within(dialog).getByRole('combobox', { name: 'Language' });
    expect(group.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('changes the theme and the language from the sheet', () => {
    const { dialog } = openMenu();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light' }));
    expect(themePreference.value).toBe('light');

    const select = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    select.value = 'uk';
    fireEvent.change(select);
    expect(language.value).toBe('uk');
    // The sheet stays open and is now in Ukrainian.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Мова' })).toBeTruthy();
  });

  it('closes with its close button and returns focus to the menu button', () => {
    const { button, dialog } = openMenu();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape and returns focus to the menu button', () => {
    const { button, dialog } = openMenu();
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Language' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
