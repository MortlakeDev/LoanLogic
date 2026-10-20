// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNavigatorLanguages } from '../__tests__/fakes';
import type * as I18nModule from '../state/i18n';

const LANGUAGE_KEY = 'loanlogic:language:v1';

const cleanups: (() => void)[] = [];

interface Rendered {
  readonly i18n: typeof I18nModule;
  readonly select: HTMLSelectElement;
}

/**
 * Renders the switcher with freshly imported modules, because the state module reads
 * storage and navigator at import time. Returns that state module and the `<select>`;
 * throws if the control is not a `<select>`.
 */
async function renderSwitcher(): Promise<Rendered> {
  vi.resetModules();
  const { LanguageSwitcher } = await import('./LanguageSwitcher');
  const i18n = await import('../state/i18n');
  render(<LanguageSwitcher id="language-select" variant="pill" />);
  const select = screen.getByRole('combobox', { name: 'Language' });
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('the language control is not a <select>');
  }
  return { i18n, select };
}

/** What a browser does when an arrow key moves a closed select: keydown, then change. */
function keyboardStep(select: HTMLSelectElement, key: string, value: string): void {
  fireEvent.keyDown(select, { key });
  select.value = value;
  fireEvent.change(select);
}

beforeEach(() => {
  localStorage.clear();
  cleanups.push(setNavigatorLanguages(['en-US', 'en']));
});

afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((stop) => {
    stop();
  });
});

describe('LanguageSwitcher', () => {
  it('applies a pointer or list pick at once and remembers it', async () => {
    const { i18n, select } = await renderSwitcher();
    select.value = 'uk';
    fireEvent.change(select);
    expect(i18n.language.value).toBe('uk');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('"uk"');
  });

  it('holds keyboard steps on the closed select instead of switching at every step', async () => {
    const { i18n, select } = await renderSwitcher();
    keyboardStep(select, 'ArrowDown', 'zh-CN');
    keyboardStep(select, 'ArrowDown', 'ru');
    expect(i18n.language.value).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBeNull();
    // The select itself shows where the user has moved to.
    expect(select.value).toBe('ru');
  });

  it('applies the held choice when focus leaves', async () => {
    const { i18n, select } = await renderSwitcher();
    keyboardStep(select, 'ArrowDown', 'ru');
    fireEvent.blur(select);
    expect(i18n.language.value).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('"ru"');
  });

  it('applies the held choice on Enter', async () => {
    const { i18n, select } = await renderSwitcher();
    keyboardStep(select, 'End', 'uk');
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(i18n.language.value).toBe('uk');
  });

  it('reverts the held choice on Escape', async () => {
    const { i18n, select } = await renderSwitcher();
    keyboardStep(select, 'ArrowDown', 'zh-CN');
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(select.value).toBe('en');
    fireEvent.blur(select);
    expect(i18n.language.value).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBeNull();
  });

  it('treats type-ahead letters as keyboard steps too', async () => {
    const { i18n, select } = await renderSwitcher();
    keyboardStep(select, 'р', 'ru');
    expect(i18n.language.value).toBe('en');
    fireEvent.blur(select);
    expect(i18n.language.value).toBe('ru');
  });

  it('applies a later change at once, e.g. a pick from a list that a key opened', async () => {
    vi.useFakeTimers();
    try {
      const { i18n, select } = await renderSwitcher();
      fireEvent.keyDown(select, { key: 'ArrowDown' });
      // The list stays open; the pick comes after the key's own task has finished.
      vi.runAllTimers();
      select.value = 'ru';
      fireEvent.change(select);
      expect(i18n.language.value).toBe('ru');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat Space (which opens the list) or shortcuts as steps', async () => {
    const { i18n, select } = await renderSwitcher();
    fireEvent.keyDown(select, { key: ' ' });
    select.value = 'uk';
    fireEvent.change(select);
    expect(i18n.language.value).toBe('uk');

    fireEvent.keyDown(select, { key: 'c', ctrlKey: true });
    select.value = 'ru';
    fireEvent.change(select);
    expect(i18n.language.value).toBe('ru');
  });

  it('does nothing on blur when there is no held choice', async () => {
    const { i18n, select } = await renderSwitcher();
    fireEvent.blur(select);
    expect(i18n.language.value).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBeNull();
  });

  it('uses the given id, so two pickers on one page keep their own labels', async () => {
    vi.resetModules();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(
      <>
        <LanguageSwitcher id="language-select" variant="pill" />
        <LanguageSwitcher id="menu-language-select" variant="field" />
      </>,
    );
    const selects = screen.getAllByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    expect(selects.map((select) => select.id)).toEqual(['language-select', 'menu-language-select']);
    for (const select of selects) {
      expect(select.labels[0]?.textContent).toBe('Language');
    }
  });

  it('draws the pill with a chevron and a visually hidden label, without the globe', async () => {
    const { select } = await renderSwitcher();
    expect(select.classList.contains('select--pill')).toBe(true);
    expect(select.labels[0]?.classList.contains('visually-hidden')).toBe(true);
    const icons = select.parentElement?.querySelectorAll('svg.icon') ?? [];
    expect(icons).toHaveLength(1);
    expect(icons[0]?.classList.contains('select-wrap__chevron')).toBe(true);
    expect(icons[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a visible label above a plain select in the field variant', async () => {
    vi.resetModules();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher id="menu-language-select" variant="field" />);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    expect(select.classList.contains('select--pill')).toBe(false);
    expect(select.labels[0]?.className).toBe('field__label');
    expect(
      select.parentElement?.querySelector('svg')?.classList.contains('select-wrap__chevron'),
    ).toBe(true);
  });

  it('ignores a value that is not a supported language', async () => {
    const { i18n, select } = await renderSwitcher();
    const option = document.createElement('option');
    option.value = 'fr';
    select.append(option);
    select.value = 'fr';
    fireEvent.change(select);
    expect(i18n.language.value).toBe('en');
  });
});
