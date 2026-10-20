// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateLoan } from '../../engine';
import { setLanguage } from '../state/i18n';
import { defaultForm, resetForm, setInputInvalid, toLoanInput, updateForm } from '../state/loan';
import type * as UiModule from '../state/ui';
import { explainTarget, focusField } from '../state/ui';
import { CompactBar } from './CompactBar';
import type { OkLoanResult } from './figures';
import { FixListDelay, fixListShown } from './FixFields';
import { MobileSummary } from './MobileSummary';

vi.mock('../state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  focusField: vi.fn(),
}));

function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`No element matches ${selector}`);
  }
  return found;
}

/** A stand-in for `IntersectionObserver`, which jsdom lacks, driven by the test. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(readonly callback: (entries: readonly Partial<IntersectionObserverEntry>[]) => void) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Reports the observed card as visible or scrolled `bottom` px from the viewport top. */
  async report(isIntersecting: boolean, bottom: number): Promise<void> {
    await act(() => {
      this.callback([{ isIntersecting, boundingClientRect: { bottom } as DOMRectReadOnly }]);
    });
  }
}

/** The card, with the fix list's delay that the results panel drives in the app. */
function renderSummary(): HTMLElement {
  const { container } = render(
    <>
      <MobileSummary />
      <FixListDelay />
    </>,
  );
  return el(container, 'section.mobile-summary') as HTMLElement;
}

beforeEach(() => {
  setLanguage('en');
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  fixListShown.value = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(focusField).mockClear();
  explainTarget.value = null;
  FakeObserver.instances = [];
});

describe('MobileSummary', () => {
  it('summarizes the payment, the two rates and the totals', () => {
    const card = renderSummary();
    expect(screen.getByRole('region', { name: 'Summary' })).toBe(card);
    expect(el(card, '.hero__label').textContent).toBe('Monthly payment');
    expect(el(card, '.badge').textContent).toBe('Equal payments');
    expect(el(card, '.hero-amount .visually-hidden').textContent).toBe('$2,299.25');
    expect(el(card, '.hero-meta').textContent).toBe(
      '360 payments · final payment $2,300.28 · paid off Nov 1, 2056',
    );
    const items = [...card.querySelectorAll('.mobile-summary__item')].map((item) => [
      el(item, 'dt').textContent,
      el(item, 'dd').textContent,
    ]);
    expect(items).toEqual([
      ['APR', '6.974%'],
      ['Effective rate (without fees)', '7.10%'],
      ['Total interest', '$477,731.03'],
      ['Total of payments', '$827,731.03'],
    ]);
    expect(el(card, '.mobile-summary__rate--headline').textContent).toBe('6.974%');
    fireEvent.click(
      within(card).getByRole('button', {
        name: "How it's calculated: Effective rate (without fees)",
      }),
    );
    expect(explainTarget.value).toEqual({ kind: 'rate', method: 'effective' });
    fireEvent.click(within(card).getByRole('button', { name: "How it's calculated" }));
    expect(explainTarget.value).toEqual({ kind: 'instalment' });
  });

  it('shows the instalment with the payment as paid when payments carry a periodic fee', () => {
    updateForm({
      amount: '100000.00',
      annualRatePct: '5',
      termMode: 'payments',
      termPayments: '12',
      fees: [
        {
          uid: 'service',
          name: '',
          kind: 'periodic',
          calc: 'fixed',
          value: '10.00',
          financing: 'paid',
          inApr: false,
        },
      ],
    });
    const card = renderSummary();
    expect(el(card, '.hero-amount .visually-hidden').textContent).toBe('$8,560.75');
    expect(el(card, '.hero-meta').textContent).toBe(
      '12 payments · first payment $8,570.75 with periodic fees · final payment $8,560.73 · ' +
        'paid off Nov 1, 2027',
    );
  });

  it('does not repeat a headline rate that is also the secondary one', () => {
    updateForm({ headlineMethod: 'effective' });
    const card = renderSummary();
    expect(card.querySelectorAll('.mobile-summary__item')).toHaveLength(3);
  });

  it('shows the warnings', () => {
    updateForm({ annualRatePct: '150' });
    const card = renderSummary();
    expect(el(card, '.notice--warning').textContent).toMatch(/above 100% a year/);
  });

  it('blanks at once and shows the same fix list after 300 ms', async () => {
    vi.useFakeTimers();
    const card = renderSummary();
    const body = el(card, '.mobile-summary__body');
    expect(body.getAttribute('aria-busy')).toBeNull();
    await act(() => {
      setInputInvalid('annualRatePct', true);
    });
    // Only the figures are busy, not the card with its heading.
    expect(body.getAttribute('aria-busy')).toBe('true');
    expect(card.getAttribute('aria-busy')).toBeNull();
    expect(card.textContent).toBe('Summary');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(body.getAttribute('aria-busy')).toBeNull();
    expect(within(card).getByRole('heading', { name: 'Fix the highlighted fields' })).toBeTruthy();
    fireEvent.click(
      within(card).getByRole('button', { name: 'Interest rate: Enter a number such as 6.875.' }),
    );
    expect(focusField).toHaveBeenCalledWith('annualRatePct');
  });
});

describe('CompactBar', () => {
  it('never shows without IntersectionObserver', () => {
    expect('IntersectionObserver' in window).toBe(false);
    renderSummary();
    expect(screen.queryByRole('region', { name: 'Payment summary' })).toBeNull();
  });

  it('shows the payment and the headline rate once the card has scrolled away', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const card = renderSummary();
    const observer = FakeObserver.instances[0];
    expect(observer?.observed).toEqual([card]);
    await observer?.report(false, 120);
    expect(screen.queryByRole('region', { name: 'Payment summary' })).toBeNull();
    await observer?.report(false, -4);
    const bar = screen.getByRole('region', { name: 'Payment summary' });
    expect([...bar.querySelectorAll('span')].map((span) => span.textContent)).toEqual([
      'Monthly payment',
      '$2,299.25',
      'APR',
      '6.974%',
    ]);
    await observer?.report(true, 300);
    expect(screen.queryByRole('region', { name: 'Payment summary' })).toBeNull();
    cleanup();
    expect(observer?.disconnected).toBe(true);
  });

  it('hides while the input is invalid', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    renderSummary();
    await FakeObserver.instances[0]?.report(false, -4);
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(screen.queryByRole('region', { name: 'Payment summary' })).toBeNull();
  });

  it('shows the same instalment as the hero when payments carry a periodic fee', () => {
    const computed = calculateLoan(
      toLoanInput({
        ...defaultForm('2026-11-01'),
        amount: '100000.00',
        annualRatePct: '5',
        termMode: 'payments',
        termPayments: '12',
        fees: [
          {
            uid: 'service',
            name: '',
            kind: 'periodic',
            calc: 'fixed',
            value: '10.00',
            financing: 'paid',
            inApr: false,
          },
        ],
      }),
    );
    if (!computed.ok) {
      throw new Error('The fee scenario must compute');
    }
    render(<CompactBar result={computed} frequency="monthly" headline="usRegZApr" />);
    expect(el(document, '.compact-bar__value').textContent).toBe('$8,560.75');
  });

  it('shows n/a for a rate that failed', () => {
    const computed = calculateLoan(toLoanInput(defaultForm('2026-11-01')));
    if (!computed.ok) {
      throw new Error('The design scenario must compute');
    }
    const result: OkLoanResult = {
      ...computed,
      rates: { ...computed.rates, usRegZApr: { ok: false, reason: 'IRR_NO_CONVERGENCE' } },
    };
    render(<CompactBar result={result} frequency="monthly" headline="usRegZApr" />);
    expect(el(document, '.compact-bar__rate').textContent).toBe('n/a');
  });
});
