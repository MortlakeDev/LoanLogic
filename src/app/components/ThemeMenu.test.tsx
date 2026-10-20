// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../state/i18n';
import { setThemePreference, THEME_STORAGE_KEY, themePreference } from '../state/theme';
import { Icon, type IconName } from './Icon';
import { ThemeMenu, ThemeOptions } from './ThemeMenu';

/** The path data of an icon, to tell which icon a button shows. */
function iconPath(name: IconName): string | null {
  const { container, unmount } = render(<Icon name={name} />);
  const d = container.querySelector('path')?.getAttribute('d') ?? null;
  unmount();
  return d;
}

/** The theme menu button (its accessible name is the "Theme" label). */
function menuButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Theme' });
}

/** The panel the button controls, found through `aria-controls`. */
function panelOf(button: HTMLElement): HTMLElement {
  const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (panel === null) {
    throw new Error('the theme button controls no element');
  }
  return panel;
}

/** Renders the menu next to an outside button and opens it with a click. */
function renderOpenMenu(): { button: HTMLElement; panel: HTMLElement; outside: HTMLElement } {
  render(
    <>
      <ThemeMenu />
      <button type="button">Outside</button>
    </>,
  );
  const button = menuButton();
  fireEvent.click(button);
  return {
    button,
    panel: panelOf(button),
    outside: screen.getByRole('button', { name: 'Outside' }),
  };
}

beforeEach(() => {
  localStorage.clear();
  themePreference.value = 'system';
  setLanguage('en');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ThemeMenu', () => {
  it('is a collapsed icon button that controls a hidden panel', () => {
    render(<ThemeMenu />);
    const button = menuButton();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const panel = panelOf(button);
    expect(panel.hidden).toBe(true);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('opens from the keyboard (a click without a press) and focuses the checked option', () => {
    const { button, panel } = renderOpenMenu();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    const group = within(panel).getByRole('group', { name: 'Theme' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.value)).toEqual(['system', 'dark', 'light']);
    expect(radios.map((radio) => radio.name)).toEqual(['theme', 'theme', 'theme']);
    expect(document.activeElement).toBe(within(group).getByRole('radio', { name: 'System' }));
  });

  it('keeps focus on the button when a pointer opens it', () => {
    render(<ThemeMenu />);
    const button = menuButton();
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
  });

  it('focuses the stored choice when it opens', () => {
    setThemePreference('light');
    renderOpenMenu();
    const light = screen.getByRole<HTMLInputElement>('radio', { name: 'Light' });
    expect(light.checked).toBe(true);
    expect(document.activeElement).toBe(light);
  });

  it('applies a choice at once, remembers it and keeps the panel open', () => {
    const { button } = renderOpenMenu();
    const dark = screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' });
    fireEvent.click(dark);
    expect(themePreference.value).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"dark"');
    expect(dark.checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the icon of the current choice on the button', async () => {
    render(<ThemeMenu />);
    const shown = (): string | null =>
      menuButton().querySelector('path')?.getAttribute('d') ?? null;
    expect(shown()).toBe(iconPath('monitor'));
    await act(() => {
      setThemePreference('dark');
    });
    expect(shown()).toBe(iconPath('moon'));
    await act(() => {
      setThemePreference('light');
    });
    expect(shown()).toBe(iconPath('sun'));
  });

  it('closes on Escape and returns focus to the button', () => {
    const { button, panel } = renderOpenMenu();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('ignores other keys', () => {
    const { button } = renderOpenMenu();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'Enter' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a press outside without moving focus', () => {
    const { button, panel, outside } = renderOpenMenu();
    const focused = document.activeElement;
    fireEvent.pointerDown(outside);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(focused);
  });

  it('stays open on a press inside the panel', () => {
    const { button, panel } = renderOpenMenu();
    fireEvent.pointerDown(panel);
    fireEvent.pointerDown(screen.getByRole('radio', { name: 'Light' }));
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when focus moves outside (Tab away) and leaves focus there', async () => {
    const { button, outside } = renderOpenMenu();
    await act(() => {
      outside.focus();
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  it('stays open while focus moves inside it', async () => {
    const { button } = renderOpenMenu();
    await act(() => {
      button.focus();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when the button is clicked again', () => {
    const { button, panel } = renderOpenMenu();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('stops listening once closed', () => {
    const { button } = renderOpenMenu();
    fireEvent.click(button);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // Escape while closed does not steal focus.
    expect(document.activeElement).not.toBe(button);
  });
});

describe('ThemeOptions', () => {
  it('gives each group its own radio name and follows the shared preference', async () => {
    render(
      <>
        <ThemeOptions name="theme" />
        <ThemeOptions name="menu-theme" />
      </>,
    );
    const groups = screen.getAllByRole('group', { name: 'Theme' });
    expect(groups).toHaveLength(2);
    const names = groups.map((group) =>
      within(group)
        .getAllByRole<HTMLInputElement>('radio')
        .map((radio) => radio.name),
    );
    expect(names).toEqual([
      ['theme', 'theme', 'theme'],
      ['menu-theme', 'menu-theme', 'menu-theme'],
    ]);

    const [first, second] = groups;
    if (first === undefined || second === undefined) {
      throw new Error('two groups expected');
    }
    fireEvent.click(within(second).getByRole('radio', { name: 'Light' }));
    await act(() => undefined);
    expect(within(first).getByRole<HTMLInputElement>('radio', { name: 'Light' }).checked).toBe(
      true,
    );
  });

  it('is translated', async () => {
    render(<ThemeOptions name="theme" />);
    await act(() => {
      setLanguage('ru');
    });
    const group = screen.getByRole('group', { name: 'Тема' });
    expect(within(group).getByRole('radio', { name: 'Тёмная' })).toBeTruthy();
  });
});
