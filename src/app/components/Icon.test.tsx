// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon, type IconName } from './Icon';

/** The set of DESIGN §10. */
const NAMES: readonly IconName[] = [
  'globe',
  'chevron-down',
  'sun',
  'moon',
  'monitor',
  'share',
  'download',
  'calendar',
  'plus',
  'check',
  'alert-triangle',
  'x',
  'info',
  'menu',
  'arrow-right',
];

afterEach(() => {
  cleanup();
});

describe('Icon', () => {
  it.each(NAMES)('draws %s as a decorative path', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('class')).toBe('icon');
    expect(svg?.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.\s,a-zA-Z-]+$/);
  });

  it('draws every icon differently', () => {
    const paths = NAMES.map((name) => {
      const { container, unmount } = render(<Icon name={name} />);
      const d = container.querySelector('path')?.getAttribute('d');
      unmount();
      return d;
    });
    expect(new Set(paths).size).toBe(NAMES.length);
  });

  it('adds its class', () => {
    const { container } = render(<Icon name="plus" class="btn__icon" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('icon btn__icon');
  });
});
