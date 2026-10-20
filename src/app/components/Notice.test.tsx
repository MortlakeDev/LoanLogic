// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon, type IconName } from './Icon';
import { Notice } from './Notice';

/** The path data of an icon, as rendered by `Icon`. */
function pathOf(name: IconName): string | null {
  const { container, unmount } = render(<Icon name={name} />);
  const d = container.querySelector('path')?.getAttribute('d') ?? null;
  unmount();
  return d;
}

afterEach(() => {
  cleanup();
});

describe('Notice', () => {
  it.each([
    ['info', 'info'],
    ['warning', 'alert-triangle'],
    ['danger', 'alert-triangle'],
    ['success', 'check'],
  ] as const)('shows the %s tone with the %s icon and its text', (tone, icon) => {
    const expected = pathOf(icon);
    const { container } = render(<Notice tone={tone}>Check the rate.</Notice>);
    const notice = container.querySelector('.notice');
    expect(notice?.className).toBe(`notice notice--${tone}`);
    expect(notice?.querySelector('svg')?.getAttribute('class')).toBe('icon notice__icon');
    expect(notice?.querySelector('path')?.getAttribute('d')).toBe(expected);
    expect(notice?.querySelector('.notice__text')?.textContent).toBe('Check the rate.');
  });

  it('adds its class', () => {
    const { container } = render(
      <Notice tone="info" class="results__notice">
        Text
      </Notice>,
    );
    expect(container.querySelector('.notice')?.className).toBe(
      'notice notice--info results__notice',
    );
  });
});
