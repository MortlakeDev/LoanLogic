// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { JSX } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

function ExplainSheet(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly class?: string;
}): JSX.Element {
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      labelledBy="sheet-title"
      closeLabel="Close"
      {...(props.class === undefined ? {} : { class: props.class })}
    >
      <h2 id="sheet-title">How it's calculated</h2>
      <button type="button">Copy</button>
      <a href="#formula">Formula</a>
    </Sheet>
  );
}

/** A button outside the sheet that has focus when the sheet opens. */
function addOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.textContent = 'Explain';
  document.body.append(opener);
  opener.focus();
  return opener;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ExplainSheet open={false} onClose={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('is a modal dialog named by its heading, with focus on its first control', () => {
    addOpener();
    render(<ExplainSheet open onClose={() => undefined} class="sheet--explain" />);
    const dialog = screen.getByRole('dialog', { name: "How it's calculated" });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(dialog.className).toBe('sheet sheet--explain');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('.sheet-backdrop')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has the plain sheet class without an extra one', () => {
    render(<ExplainSheet open onClose={() => undefined} />);
    expect(screen.getByRole('dialog').className).toBe('sheet');
  });

  it('keeps Tab and Shift+Tab inside when the panel itself has focus', () => {
    render(<ExplainSheet open onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Formula' }));
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('treats a radio group as one tab stop when it is last or first', () => {
    render(
      <Sheet open onClose={() => undefined} labelledBy="radio-title" closeLabel="Close">
        <h2 id="radio-title">Settings</h2>
        <fieldset>
          <legend>Theme</legend>
          <input type="radio" name="theme" value="system" aria-label="System" />
          <input type="radio" name="theme" value="dark" aria-label="Dark" checked />
          <input type="radio" name="theme" value="light" aria-label="Light" />
        </fieldset>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const dark = screen.getByRole('radio', { name: 'Dark' });
    const light = screen.getByRole('radio', { name: 'Light' });

    // Tab from any radio of the last group wraps to the first stop.
    light.focus();
    expect(fireEvent.keyDown(light, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first stop enters the group at its checked radio.
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(dark);
  });

  it('wraps Tab and Shift+Tab inside the sheet', () => {
    render(<ExplainSheet open onClose={() => undefined} />);
    const close = screen.getByRole('button', { name: 'Close' });
    const copy = screen.getByRole('button', { name: 'Copy' });
    const link = screen.getByRole('link', { name: 'Formula' });

    link.focus();
    expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(close);

    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(link);

    // Inside the sheet the browser moves focus itself.
    copy.focus();
    expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(copy, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(copy);
  });

  it('keeps focus in a sheet with nothing focusable', () => {
    render(<ExplainSheet open onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    dialog.querySelectorAll('button, a').forEach((element) => {
      element.remove();
    });
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
  });

  it('closes with Esc without letting the key reach the page', () => {
    const onClose = vi.fn();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    render(<ExplainSheet open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Copy' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageKeys).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Copy' }), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageKeys).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', pageKeys);
  });

  it('closes from the backdrop and the close button', () => {
    const onClose = vi.fn();
    render(<ExplainSheet open onClose={onClose} />);
    const backdrop = document.querySelector('.sheet-backdrop');
    if (backdrop === null) {
      throw new Error('no backdrop');
    }
    fireEvent.click(backdrop);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the element that had it after closing', () => {
    const opener = addOpener();
    const { rerender } = render(<ExplainSheet open onClose={() => undefined} />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<ExplainSheet open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus where the caller moved it on close', () => {
    addOpener();
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    const { rerender } = render(<ExplainSheet open onClose={() => undefined} />);
    elsewhere.focus();
    rerender(<ExplainSheet open={false} onClose={() => undefined} />);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('has nothing to return focus to when an SVG element had it', () => {
    const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chart.setAttribute('tabindex', '0');
    document.body.append(chart);
    chart.focus();
    expect(document.activeElement).toBe(chart);
    const { rerender } = render(<ExplainSheet open onClose={() => undefined} />);
    rerender(<ExplainSheet open={false} onClose={() => undefined} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not focus an opener that left the page', () => {
    const opener = addOpener();
    const focusSpy = vi.spyOn(opener, 'focus');
    const { rerender } = render(<ExplainSheet open onClose={() => undefined} />);
    opener.remove();
    rerender(<ExplainSheet open={false} onClose={() => undefined} />);
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
