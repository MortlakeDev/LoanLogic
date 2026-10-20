// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMessage } from '../../i18n';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import type * as I18nState from '../state/i18n';
import { setLanguage, t } from '../state/i18n';
import { Rich } from './Rich';

// `t` passes through to the catalogs unless a test gives it another template.
vi.mock('../state/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nState>();
  return { ...actual, t: vi.fn(actual.t) };
});

const NODES = {
  ratio: <strong class="accent">$2.37</strong>,
  one: <span class="num">$1</span>,
};

/** The tags and texts of the rendered nodes, in document order. */
function nodeOrder(container: Element): string[] {
  return [...container.querySelectorAll('strong, span')].map(
    (element) => `${element.tagName.toLowerCase()}:${element.textContent}`,
  );
}

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('Rich', () => {
  it('renders placeholders as elements inside the translated text', () => {
    const { container } = render(<Rich message="cost.heading" nodes={NODES} />);
    expect(container.textContent).toBe('You repay $2.37 for every $1 borrowed');
    expect(nodeOrder(container)).toEqual(['strong:$2.37', 'span:$1']);
    expect(container.querySelector('strong')?.className).toBe('accent');
  });

  it('follows the UI language', () => {
    setLanguage('ru');
    const { container } = render(<Rich message="cost.heading" nodes={NODES} />);
    expect(container.textContent).toBe(
      ru['cost.heading'].replace('{ratio}', '$2.37').replace('{one}', '$1'),
    );
  });

  it('keeps the word order of the translation', () => {
    vi.mocked(t).mockImplementationOnce(
      (key, params) =>
        formatMessage({ [key]: 'Per {one}: {ratio}' }, 'en', 'en-US', key, params) ?? key,
    );
    const { container } = render(<Rich message="cost.heading" nodes={NODES} />);
    expect(container.textContent).toBe('Per $1: $2.37');
    expect(nodeOrder(container)).toEqual(['span:$1', 'strong:$2.37']);
  });

  it('fills the other placeholders from params', () => {
    const { container } = render(
      <Rich
        message="cost.barPart"
        nodes={{ amount: <span class="num">$477,731.03</span> }}
        params={{ name: 'Interest', share: '57.5%' }}
      />,
    );
    expect(container.textContent).toBe(
      en['cost.barPart']
        .replace('{name}', 'Interest')
        .replace('{amount}', '$477,731.03')
        .replace('{share}', '57.5%'),
    );
    expect(nodeOrder(container)).toEqual(['span:$477,731.03']);
  });

  it('renders a message without nodes as text', () => {
    const { container } = render(
      <Rich message="cost.total" nodes={{}} params={{ amount: '$831,231.03' }} />,
    );
    expect(container.textContent).toBe('$831,231.03 in total, fees included');
    expect(container.children).toHaveLength(0);
  });
});
