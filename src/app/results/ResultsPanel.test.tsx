// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Explain } from '../../engine';
import zhCN from '../../i18n/locales/zh-CN.json';
import { money } from '../state/display';
import { setLanguage } from '../state/i18n';
import { okResult, resetForm, setInputInvalid, updateForm } from '../state/loan';
import type * as UiModule from '../state/ui';
import { explainTarget, focusField } from '../state/ui';
import { ResultsPanel } from './ResultsPanel';

const strips = vi.hoisted(() => [] as Explain[]);

vi.mock('../explain/FormulaStrip', () => ({
  FormulaStrip: (props: { readonly explain: Explain }): null => {
    strips.push(props.explain);
    return null;
  },
}));

vi.mock('../schedule/ScheduleCard', async () => {
  const { h } = await import('preact');
  return { ScheduleCard: () => h('div', { 'data-testid': 'schedule-card' }) };
});

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

function texts(root: ParentNode, selector: string): (string | null)[] {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

function renderPanel(): HTMLElement {
  const { container } = render(<ResultsPanel />);
  return el(container, 'section.results') as HTMLElement;
}

beforeEach(() => {
  setLanguage('en');
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  strips.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(focusField).mockClear();
  explainTarget.value = null;
});

describe('ResultsPanel: the design scenario', () => {
  it('shows the payment hero with the hero number split into parts', () => {
    const panel = renderPanel();
    const hero = el(panel, '.hero');
    expect(within(hero as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe(
      'Monthly payment',
    );
    const amount = el(hero, '.hero-amount');
    expect(el(amount, '.visually-hidden').textContent).toBe('$2,299.25');
    const visible = el(amount, '[aria-hidden="true"]');
    expect(visible.textContent).toBe('$2,299.25');
    expect(texts(visible, '.hero-amount__currency')).toEqual(['$']);
    expect(texts(visible, '.hero-amount__minor')).toEqual(['.', '25']);
    expect(el(hero, '.hero-meta').textContent).toBe(
      '360 payments · final payment $2,300.28 · paid off Nov 1, 2056',
    );
    expect(texts(hero, '.hero-meta__amount')).toEqual(['$2,300.28']);
    expect(strips.at(-1)?.formulaId).toBe('instalment.annuity');
  });

  it('shows the rate card with the APR, its source, what it includes and the other rates', () => {
    const panel = renderPanel();
    const card = el(panel, '.rate-card') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe('APR');
    expect(el(card, '.badge').textContent).toBe('Reg Z · US');
    expect(el(card, '.rate-card__rate').textContent).toBe('6.974%');
    expect(el(card, '.rate-card__includes').textContent).toBe(
      'Includes the $3,500.00 origination fee',
    );
    expect(
      within(card)
        .getAllByRole('term')
        .map((node) => node.textContent),
    ).toEqual(['Contract rate', 'Effective rate (without fees)']);
    expect(texts(card, '.rate-card__minor')).toEqual(['6.875%', '7.10%']);
  });

  it('opens the explanation of every displayed rate', () => {
    const panel = renderPanel();
    const cases = [
      ["How it's calculated: APR", 'usRegZApr'],
      ["How it's calculated: Nominal rate", 'nominal'],
      ["How it's calculated: Effective rate (without fees)", 'effective'],
    ] as const;
    for (const [name, method] of cases) {
      fireEvent.click(within(panel).getByRole('button', { name }));
      expect(explainTarget.value).toEqual({ kind: 'rate', method });
    }
  });

  it('shows the KPI tiles with their captions', () => {
    const panel = renderPanel();
    const tiles = [...panel.querySelectorAll('.kpi')].map((tile) =>
      [...tile.children].map((child) => child.textContent),
    );
    expect(tiles).toEqual([
      ['Total interest', '$477,731.03', 'Over 30 years'],
      ['Total cost of credit', '$481,231.03', 'Interest, fees and insurance'],
      ['Total of payments', '$827,731.03', 'Principal + interest'],
    ]);
    expect(el(panel, '.kpi__value--accent').textContent).toBe('$477,731.03');
  });

  it('shows the cost structure with the ratio, the bar and the legend', () => {
    const panel = renderPanel();
    const cost = el(panel, '.cost');
    expect(el(cost, '.cost__heading').textContent).toBe('You repay $2.37 for every $1 borrowed');
    expect(el(cost, '.cost__heading .accent').textContent).toBe('$2.37');
    expect(el(cost, '.cost__total').textContent).toBe('$831,231.03 in total, fees included');
    const bar = within(panel).getByRole('img', {
      name: 'Cost structure: Principal $350,000.00, 42.1%, Interest $477,731.03, 57.5%, and Fees $3,500.00, 0.4%',
    });
    const segments = bar.querySelectorAll('g > rect');
    expect(segments).toHaveLength(3);
    expect(segments[1]?.getAttribute('fill')).toMatch(/^url\(#.+-hatch\)$/);
    expect(bar.querySelectorAll('mask > rect')).toHaveLength(3);
    expect(
      [...cost.querySelectorAll('.cost__item')].map((item) =>
        [...item.querySelectorAll('span')].map((span) => span.textContent),
      ),
    ).toEqual([
      ['Principal', '$350,000.00', '42.1%'],
      ['Interest', '$477,731.03', '57.5%'],
      ['Fees', '$3,500.00', '0.4%'],
    ]);
  });

  it('announces the payment and the headline rate and renders the schedule last', () => {
    const panel = renderPanel();
    expect(screen.getByRole('region', { name: 'Results' })).toBe(panel);
    expect(el(panel, '[aria-live="polite"]').textContent).toBe(
      'Monthly payment: $2,299.25. APR: 6.974%.',
    );
    expect(panel.getAttribute('aria-busy')).toBeNull();
    expect(panel.lastElementChild?.getAttribute('data-testid')).toBe('schedule-card');
  });
});

describe('ResultsPanel: other loans', () => {
  it('labels an equal-principal loan by its first payment with the range to the last', () => {
    updateForm({ repayment: 'equal-principal' });
    const panel = renderPanel();
    const last = okResult.value?.summary.lastPayment ?? '';
    expect(el(panel, '.hero__label').textContent).toBe('First payment');
    expect(el(panel, '.hero__range').textContent).toBe(`→ last ${money(last)}`);
    expect(el(panel, '[aria-live="polite"]').textContent).toMatch(/^First payment: /);
  });

  it('shows the balloon in the meta line', () => {
    updateForm({ repayment: 'balloon' });
    const panel = renderPanel();
    expect(el(panel, '.hero-meta').textContent).toBe(
      '360 payments · final payment $107,208.63 · balloon $104,997.59 · paid off Nov 1, 2056',
    );
  });

  it('keeps the minus sign of a negative payment and negative interest', () => {
    updateForm({ repayment: 'equal-principal', annualRatePct: '-5' });
    const panel = renderPanel();
    const amount = el(panel, '.hero-amount');
    expect(el(amount, '.visually-hidden').textContent).toBe('-$486.11');
    expect(el(amount, '[aria-hidden="true"]').textContent).toBe('-$486.11');
    expect(el(panel, '.kpi__value--accent').textContent).toBe('-$263,229.78');
    // Negative interest has no width in the bar but keeps its sign in the legend.
    expect(panel.querySelectorAll('.cost-bar g > rect')).toHaveLength(2);
    expect(texts(panel, '.cost__amount')).toContain('-$263,229.78');
    expect(el(panel, '.notice--info').textContent).toBe(
      'The interest rate is negative (-5%): the lender pays you interest.',
    );
  });

  it('shows engine warnings under the hero', () => {
    updateForm({ annualRatePct: '150' });
    const panel = renderPanel();
    const notice = el(panel, '.results-warnings .notice--warning');
    expect(notice.textContent).toBe(
      'The interest rate is above 100% a year (150%). Check that it is an annual rate.',
    );
    expect(el(panel, '.hero-card').nextElementSibling?.className).toBe('results-warnings');
  });

  it('shows the CN scenario in Chinese with the PBOC rates', () => {
    setLanguage('zh-CN');
    updateForm({
      currency: 'CNY',
      amount: '1000000.00',
      annualRatePct: '3.10',
      fees: [],
      disbursementDate: '2026-11-15',
    });
    const panel = renderPanel();
    expect(el(panel, '.hero-amount .visually-hidden').textContent).toBe('¥4,270.16');
    const card = el(panel, '.rate-card') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe(
      zhCN['rateMethod.cnAnnualized'],
    );
    expect(el(card, '.badge').textContent).toBe(zhCN['rateSource.pboc']);
    expect(el(card, '.rate-card__rate').textContent).toBe('3.10%');
    expect(el(card, '.rate-card__includes').textContent).toBe(zhCN['rates.includesNone']);
    expect(
      within(card)
        .getAllByRole('term')
        .map((node) => node.textContent),
    ).toEqual([zhCN['rates.contract'], zhCN['rateMethod.irrEffective']]);
    expect(texts(card, '.rate-card__minor')).toEqual(['3.10%', '3.14%']);
    // No fees: the cost structure has two parts and the captions say so.
    expect(panel.querySelectorAll('.cost__item')).toHaveLength(2);
    expect(el(panel, '.cost__total').textContent).toBe(
      zhCN['cost.totalNoFees'].replace('{amount}', '¥1,537,260.03'),
    );
    expect(texts(panel, '.kpi__caption')[1]).toBe(zhCN['kpi.costCaptionInterest']);
  });
});

describe('ResultsPanel: invalid input', () => {
  it('blanks every figure at once and lists the errors after 300 ms', async () => {
    vi.useFakeTimers();
    const panel = renderPanel();
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(el(panel, '[aria-live="polite"]').textContent).toBe('');
    expect(panel.textContent).not.toMatch(/\d/);
    await act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    await act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('heading', { name: 'Fix the highlighted fields' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Loan amount: Enter an amount such as 350,000.50.' }),
    );
    expect(focusField).toHaveBeenCalledWith('amount');
    // Fixing the field restores the results.
    await act(() => {
      setInputInvalid('amount', false);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    expect(el(panel, '.hero-amount .visually-hidden').textContent).toBe('$2,299.25');
  });

  it('restarts the pause on every change', async () => {
    vi.useFakeTimers();
    renderPanel();
    await act(() => {
      setInputInvalid('term.years', true);
      vi.advanceTimersByTime(200);
    });
    await act(() => {
      updateForm({ annualRatePct: '7' });
    });
    await act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    await act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Years: Enter a whole number.' }));
    expect(focusField).toHaveBeenCalledWith('term.years');
  });

  it('lists engine errors with the field they belong to', async () => {
    vi.useFakeTimers();
    updateForm({ amount: '0.00' });
    const panel = renderPanel();
    expect(panel.getAttribute('aria-busy')).toBe('true');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Loan amount: Enter an amount above zero, up to 1,000,000,000,000,000.',
      }),
    );
    expect(focusField).toHaveBeenCalledWith('amount');
  });

  it('explains negative amortization and leads to the fix', async () => {
    vi.useFakeTimers();
    updateForm({
      accrualMode: 'daycount',
      dayCount: 'act-360',
      annualRatePct: '30',
      amount: '100000.00',
      fees: [],
    });
    renderPanel();
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(
      screen.getByText(
        "From payment 2, the payment doesn't cover the interest and the balance would grow.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch the payment basis to exact amortization.' }),
    );
    expect(focusField).toHaveBeenCalledWith('accrual.paymentBasis');
  });
});
