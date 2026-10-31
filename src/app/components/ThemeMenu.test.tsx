// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../state/i18n';
import {
  setThemePreference,
  THEME_STORAGE_KEY,
  themePreference,
  type ThemePreference,
} from '../state/theme';
import { Icon, type IconName } from './Icon';
import { ThemeMenu, ThemeOptions } from './ThemeMenu';

/** The path data of an icon, to tell which icon an element shows. */
function iconPath(name: IconName): string | null {
  const { container, unmount } = render(<Icon name={name} />);
  const d = container.querySelector('path')?.getAttribute('d') ?? null;
  unmount();
  return d;
}

const CHECK = iconPath('check');

const NAMES: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
};

/** The theme menu button (its accessible name is the "Theme" label). */
function menuButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Theme' });
}

/** The menu the button controls, found through `aria-controls`. */
function menuOf(button: HTMLElement): HTMLElement {
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (menu === null) {
    throw new Error('the theme button controls no element');
  }
  return menu;
}

/** One item of the open menu, by its accessible name. */
function item(preference: ThemePreference): HTMLElement {
  return within(screen.getByRole('menu', { name: 'Theme' })).getByRole('menuitemradio', {
    name: NAMES[preference],
  });
}

/** The items of the open menu, in order. */
function items(): HTMLElement[] {
  return within(screen.getByRole('menu', { name: 'Theme' })).getAllByRole('menuitemradio');
}

/** Whether an item shows the check mark. */
function hasCheckMark(element: HTMLElement): boolean {
  return [...element.querySelectorAll('path')].some((path) => path.getAttribute('d') === CHECK);
}

/** Renders the menu next to an outside button. */
function renderMenu(): { button: HTMLElement; menu: HTMLElement; outside: HTMLElement } {
  render(
    <>
      <ThemeMenu />
      <button type="button">Outside</button>
    </>,
  );
  const button = menuButton();
  return {
    button,
    menu: menuOf(button),
    outside: screen.getByRole('button', { name: 'Outside' }),
  };
}

/**
 * Renders the menu and opens it with a click. Enter and Space on a native button arrive as
 * the same click event (jsdom does not synthesize it from keys; the e2e tests press them).
 */
function renderOpenMenu(): { button: HTMLElement; menu: HTMLElement; outside: HTMLElement } {
  const rendered = renderMenu();
  fireEvent.click(rendered.button);
  return rendered;
}

/** Asserts the menu is closed: the button collapsed and the menu hidden. */
function expectClosed(button: HTMLElement, menu: HTMLElement): void {
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(menu.hidden).toBe(true);
}

/** Asserts that `focused` has focus and holds the menu's only tab stop. */
function expectRovingFocus(focused: HTMLElement): void {
  expect(document.activeElement).toBe(focused);
  expect(items().map((element) => element.tabIndex)).toEqual(
    items().map((element) => (element === focused ? 0 : -1)),
  );
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
  it('is a collapsed menu button that controls a hidden menu named Theme', () => {
    const { button, menu } = renderMenu();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.hidden).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('opens on a click with System, Dark and Light and focuses the checked item', () => {
    const { button, menu } = renderOpenMenu();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    expect(screen.getByRole('menu', { name: 'Theme' })).toBe(menu);
    expect(items().map((element) => element.textContent)).toEqual(['System', 'Dark', 'Light']);
    expect(items().map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expectRovingFocus(item('system'));
  });

  it('focuses the stored choice when it opens', () => {
    setThemePreference('light');
    renderOpenMenu();
    expect(item('light').getAttribute('aria-checked')).toBe('true');
    expectRovingFocus(item('light'));
  });

  it('opens on ArrowDown at the checked item', () => {
    setThemePreference('dark');
    const { button } = renderMenu();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expectRovingFocus(item('dark'));
  });

  it('opens on ArrowUp at the last item', () => {
    const { button } = renderMenu();
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expectRovingFocus(item('light'));
    expect(themePreference.value).toBe('system');
  });

  it('ignores other keys on the closed button', () => {
    const { button, menu } = renderMenu();
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    expectClosed(button, menu);
  });

  it('marks only the checked item with the check mark', async () => {
    renderOpenMenu();
    expect(items().map(hasCheckMark)).toEqual([true, false, false]);
    await act(() => {
      setThemePreference('dark');
    });
    expect(items().map(hasCheckMark)).toEqual([false, true, false]);
  });

  it('moves focus with the arrow keys, wrapping, without changing the theme', () => {
    renderOpenMenu();
    const steps: [string, ThemePreference][] = [
      ['ArrowDown', 'dark'],
      ['ArrowDown', 'light'],
      ['ArrowDown', 'system'],
      ['ArrowUp', 'light'],
      ['ArrowUp', 'dark'],
    ];
    for (const [key, expected] of steps) {
      const event = fireEvent.keyDown(document.activeElement ?? document.body, { key });
      expect(event, `${key} is prevented so the page does not scroll`).toBe(false);
      expectRovingFocus(item(expected));
    }
    expect(themePreference.value).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(item('system').getAttribute('aria-checked')).toBe('true');
    expect(item('dark').getAttribute('aria-checked')).toBe('false');
  });

  it('moves focus to the first and last items with Home and End', () => {
    renderOpenMenu();
    fireEvent.keyDown(item('system'), { key: 'End' });
    expectRovingFocus(item('light'));
    fireEvent.keyDown(item('light'), { key: 'Home' });
    expectRovingFocus(item('system'));
    expect(themePreference.value).toBe('system');
  });

  it('ignores other keys on an item', () => {
    const { button } = renderOpenMenu();
    for (const key of ['ArrowRight', 'ArrowLeft', 'a']) {
      fireEvent.keyDown(item('system'), { key });
    }
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expectRovingFocus(item('system'));
    expect(themePreference.value).toBe('system');
  });

  it('applies a clicked item, remembers it, closes and returns focus to the button', () => {
    const { button, menu } = renderOpenMenu();
    fireEvent.click(item('dark'));
    expect(themePreference.value).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"dark"');
    expectClosed(button, menu);
    expect(document.activeElement).toBe(button);
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('applies the focused item on %s, closes and returns focus to the button', (_, key) => {
    const { button, menu } = renderOpenMenu();
    fireEvent.keyDown(item('system'), { key: 'ArrowDown' });
    fireEvent.keyDown(item('dark'), { key: 'ArrowDown' });
    const event = fireEvent.keyDown(item('light'), { key });
    expect(event, 'the key is prevented').toBe(false);
    expect(themePreference.value).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"light"');
    expectClosed(button, menu);
    expect(document.activeElement).toBe(button);
  });

  it('opens again at the new choice', () => {
    const { button } = renderOpenMenu();
    fireEvent.click(item('light'));
    fireEvent.click(button);
    expectRovingFocus(item('light'));
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

  it('closes on Escape, returns focus to the button and keeps the theme', () => {
    const { button, menu } = renderOpenMenu();
    fireEvent.keyDown(item('system'), { key: 'ArrowDown' });
    fireEvent.keyDown(item('dark'), { key: 'Escape' });
    expectClosed(button, menu);
    expect(document.activeElement).toBe(button);
    expect(themePreference.value).toBe('system');
  });

  it('closes on Escape when focus has left the items for the body', () => {
    const { button, menu } = renderOpenMenu();
    item('system').blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expectClosed(button, menu);
    expect(document.activeElement).toBe(button);
  });

  it('closes on Tab without moving focus itself, so the browser moves it on', () => {
    const { button, menu } = renderOpenMenu();
    const event = fireEvent.keyDown(item('system'), { key: 'Tab' });
    expect(event, 'Tab is not prevented').toBe(true);
    expectClosed(button, menu);
    expect(document.activeElement).not.toBe(button);
    expect(themePreference.value).toBe('system');
  });

  it('closes on Shift+Tab, which the browser moves to the button', () => {
    const { button, menu } = renderOpenMenu();
    const event = fireEvent.keyDown(item('system'), { key: 'Tab', shiftKey: true });
    expect(event).toBe(true);
    expectClosed(button, menu);
  });

  it('closes on a press outside without moving focus', () => {
    const { button, menu, outside } = renderOpenMenu();
    const focused = document.activeElement;
    fireEvent.pointerDown(outside);
    expectClosed(button, menu);
    expect(document.activeElement).toBe(focused);
    expect(themePreference.value).toBe('system');
  });

  it('stays open on a press inside the menu', () => {
    const { button, menu } = renderOpenMenu();
    fireEvent.pointerDown(menu);
    fireEvent.pointerDown(item('light'));
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps focus on the item when the menu padding is pressed', () => {
    const { menu } = renderOpenMenu();
    const focused = document.activeElement;
    // The browser's default for a press on a non-focusable area is to blur to the body.
    expect(fireEvent.mouseDown(menu)).toBe(false);
    expect(document.activeElement).toBe(focused);
  });

  it('closes when focus moves outside and leaves focus there', async () => {
    const { button, outside } = renderOpenMenu();
    await act(() => {
      outside.focus();
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  it('keeps the tab stop on an item focused by a press', async () => {
    const { button } = renderOpenMenu();
    await act(() => {
      item('dark').focus();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expectRovingFocus(item('dark'));
  });

  it('closes when the button is clicked again and focuses the button', () => {
    const { button, menu } = renderOpenMenu();
    fireEvent.click(button);
    expectClosed(button, menu);
    expect(document.activeElement).toBe(button);
  });

  it('stops listening once closed', () => {
    const { button, outside } = renderOpenMenu();
    fireEvent.click(button);
    outside.focus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // Escape while closed does not steal focus.
    expect(document.activeElement).toBe(outside);
  });

  it('is translated', async () => {
    renderOpenMenu();
    await act(() => {
      setLanguage('ru');
    });
    const menu = screen.getByRole('menu', { name: 'Тема' });
    expect(within(menu).getByRole('menuitemradio', { name: 'Тёмная' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Тема' })).toBeTruthy();
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
