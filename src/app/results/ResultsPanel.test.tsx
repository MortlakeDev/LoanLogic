// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Explain } from '../../engine';
import zhCN from '../../i18n/locales/zh-CN.json';
import { money } from '../state/display';
import { setLanguage } from '../state/i18n';
import {
  type FeeDraft,
  noteInput,
  okResult,
  resetForm,
  setInputInvalid,
  updateForm,
} from '../state/loan';
import type * as UiModule from '../state/ui';
import { explainTarget, focusField } from '../state/ui';
import { rateText } from './figures';
import { fixListShown } from './FixFields';
import { MobileSummary } from './MobileSummary';
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

/** The live region that announces the results or the fix list. */
function liveText(panel: ParentNode): string | null {
  return el(panel, '[aria-live="polite"]').textContent;
}

/** A fixed fee or insurance item charged with every payment. */
function perPayment(kind: 'periodic' | 'insurance', value: string, inApr: boolean): FeeDraft {
  return { uid: `${kind}-1`, name: '', kind, calc: 'fixed', value, financing: 'paid', inApr };
}

/** USD 100,000.00 at 5 % over 12 monthly payments with a $10.00 fee left out of the APR. */
const FEE_LOAN = {
  amount: '100000.00',
  annualRatePct: '5',
  termMode: 'payments',
  termPayments: '12',
  fees: [perPayment('periodic', '10.00', false)],
} as const;

beforeEach(() => {
  setLanguage('en');
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  strips.length = 0;
  fixListShown.value = false;
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
    expect(liveText(panel)).toBe('Monthly payment: $2,299.25. APR: 6.974%.');
    expect(panel.querySelector('[aria-busy]')).toBeNull();
    expect(panel.lastElementChild?.getAttribute('data-testid')).toBe('schedule-card');
    // The chart sits between the overview and the schedule (DESIGN §7).
    const chart = panel.lastElementChild?.previousElementSibling;
    expect(chart?.matches('section.chart')).toBe(true);
    expect(chart?.previousElementSibling?.classList.contains('results__overview')).toBe(true);
  });
});

describe('ResultsPanel: other loans', () => {
  it('labels an equal-principal loan by its first payment with the range to the last', () => {
    updateForm({ repayment: 'equal-principal' });
    const panel = renderPanel();
    // No periodic fees: the summary's payments are the instalments.
    const { firstPayment, lastPayment } = okResult.value?.summary ?? {};
    expect(el(panel, '.hero__label').textContent).toBe('First payment');
    expect(el(panel, '.hero-amount .visually-hidden').textContent).toBe(money(firstPayment ?? ''));
    expect(el(panel, '.hero__range').textContent).toBe(`→ last ${money(lastPayment ?? '')}`);
    expect(liveText(panel)).toMatch(/^First payment: /);
  });

  it('shows principal + interest in the hero and the payment with its fees in the meta line', () => {
    updateForm(FEE_LOAN);
    const panel = renderPanel();
    const result = okResult.value;
    const last = result?.rows.at(-1);
    // The engine's figures: payments carry the $10.00 fee on top of the instalment.
    expect([
      result?.summary.regularInstalment,
      result?.rows[0]?.payment,
      result?.summary.lastPayment,
    ]).toEqual(['8560.75', '8570.75', '8570.73']);
    expect([last?.principal, last?.interestPaid]).toEqual(['8525.21', '35.52']);
    expect(el(panel, '.hero-amount .visually-hidden').textContent).toBe('$8,560.75');
    expect(el(panel, '.hero-meta').textContent).toBe(
      '12 payments · first payment $8,570.75 with periodic fees · final payment $8,560.73 · ' +
        'paid off Nov 1, 2027',
    );
    expect(texts(panel, '.hero-meta__amount')).toEqual(['$8,570.75', '$8,560.73']);
    expect(liveText(panel)).toBe('Monthly payment: $8,560.75. APR: 5.000%.');
  });

  it('puts every equal-principal figure on the instalment basis when payments carry insurance', () => {
    updateForm({
      ...FEE_LOAN,
      repayment: 'equal-principal',
      fees: [perPayment('insurance', '10.00', true)],
    });
    const panel = renderPanel();
    const rows = okResult.value?.rows ?? [];
    expect([rows[0]?.principal, rows[0]?.interestPaid, rows[0]?.payment]).toEqual([
      '8333.33',
      '416.67',
      '8760.00',
    ]);
    expect([rows.at(-1)?.principal, rows.at(-1)?.interestPaid]).toEqual(['8333.37', '34.72']);
    expect(el(panel, '.hero-amount .visually-hidden').textContent).toBe('$8,750.00');
    expect(el(panel, '.hero__range').textContent).toBe('→ last $8,368.09');
    expect(el(panel, '.hero-meta').textContent).toBe(
      '12 payments · first payment $8,760.00 with insurance · final payment $8,368.09 · ' +
        'paid off Nov 1, 2027',
    );
  });

  it('names both kinds when payments carry periodic fees and insurance', () => {
    updateForm({
      ...FEE_LOAN,
      fees: [perPayment('periodic', '10.00', false), perPayment('insurance', '5.00', true)],
    });
    const panel = renderPanel();
    const first = okResult.value?.rows[0]?.payment ?? '';
    expect(el(panel, '.hero-meta').textContent).toContain(
      `first payment ${money(first)} with periodic fees and insurance`,
    );
    // Lines break between the meta items only.
    expect(panel.querySelectorAll('.hero-meta__item').length).toBe(4);
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
  it('blanks every figure at once and lists and announces the errors after 300 ms', async () => {
    vi.useFakeTimers();
    const panel = renderPanel();
    const overview = el(panel, '.results__overview');
    await act(() => {
      setInputInvalid('amount', true);
    });
    // The figures are busy; the live region is outside them, so it is never held back.
    expect(overview.getAttribute('aria-busy')).toBe('true');
    expect(panel.getAttribute('aria-busy')).toBeNull();
    expect(overview.contains(el(panel, '[aria-live="polite"]'))).toBe(false);
    expect(liveText(panel)).toBe('');
    expect(panel.textContent).not.toMatch(/\d/);
    await act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    expect(liveText(panel)).toBe('');
    await act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('heading', { name: 'Fix the highlighted fields' })).toBeTruthy();
    expect(overview.getAttribute('aria-busy')).toBeNull();
    expect(liveText(panel)).toBe(
      'Fix the highlighted fields. Loan amount: Enter an amount such as 350,000.50.',
    );
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
    expect(fixListShown.value).toBe(false);
    // The figures are back at once; the summary is spoken after the pause.
    expect(liveText(panel)).toBe('');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(liveText(panel)).toBe('Monthly payment: $2,299.25. APR: 6.974%.');
  });

  it('speaks the summary once typing pauses, not at every keystroke', async () => {
    vi.useFakeTimers();
    const panel = renderPanel();
    // The opening summary is already there: nothing is announced on load.
    expect(liveText(panel)).toBe('Monthly payment: $2,299.25. APR: 6.974%.');
    for (const amount of ['1', '12', '123', '1234']) {
      await act(() => {
        updateForm({ amount: `${amount}00.00` });
        vi.advanceTimersByTime(150);
      });
      // The figures follow every keystroke; the spoken text waits.
      expect(liveText(panel)).toBe('Monthly payment: $2,299.25. APR: 6.974%.');
    }
    const payment = el(panel, '.hero-amount .visually-hidden').textContent;
    expect(payment).not.toBe('$2,299.25');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    const apr = rateText(okResult.value?.rates.usRegZApr) ?? '';
    expect(liveText(panel)).toBe(`Monthly payment: ${payment}. APR: ${apr}.`);
  });

  it('keeps the list shown and announced while the errors change, until the input is valid', async () => {
    vi.useFakeTimers();
    const panel = renderPanel();
    await act(() => {
      setInputInvalid('amount', true);
    });
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    await act(() => {
      noteInput();
      setInputInvalid('term.years', true);
    });
    expect(liveText(panel)).toBe(
      'Fix the highlighted fields. Loan amount: Enter an amount such as 350,000.50. ' +
        'Years: Enter a whole number.',
    );
    await act(() => {
      setInputInvalid('amount', false);
      setInputInvalid('term.years', false);
    });
    // Invalid again: a new pause before the list returns.
    await act(() => {
      setInputInvalid('amount', true);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    expect(liveText(panel)).toBe('');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('heading', { name: 'Fix the highlighted fields' })).toBeTruthy();
  });

  it('waits for a pause in keystrokes that leave the text invalid', async () => {
    vi.useFakeTimers();
    const panel = renderPanel();
    // Three keystrokes 200 ms apart, each leaving the amount unparseable: after the first
    // one neither the form nor the set of errors changes, only the keystroke count.
    for (let keystroke = 0; keystroke < 3; keystroke += 1) {
      await act(() => {
        noteInput();
        setInputInvalid('amount', true);
      });
      await act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    }
    await act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByText('Fix the highlighted fields')).toBeNull();
    expect(liveText(panel)).toBe('');
    await act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('heading', { name: 'Fix the highlighted fields' })).toBeTruthy();
  });

  it('shows the desktop and mobile lists at the same moment', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <>
        <MobileSummary />
        <ResultsPanel />
      </>,
    );
    await act(() => {
      setInputInvalid('annualRatePct', true);
    });
    expect(el(container, '.mobile-summary__body').getAttribute('aria-busy')).toBe('true');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByRole('heading', { name: 'Fix the highlighted fields' })).toHaveLength(2);
    expect(el(container, '.mobile-summary__body').getAttribute('aria-busy')).toBeNull();
    // One announcement for both.
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
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
    expect(el(panel, '.results__overview').getAttribute('aria-busy')).toBe('true');
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(liveText(panel)).toBe(
      'Fix the highlighted fields. ' +
        'Loan amount: Enter an amount above zero, up to 1,000,000,000,000,000.',
    );
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
    const panel = renderPanel();
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    const message =
      'From payment 2, the principal part would be negative and the balance would grow.';
    expect(screen.getByText(message)).toBeTruthy();
    // The error and its fix are announced as the list shows them.
    expect(liveText(panel)).toBe(
      `Fix the highlighted fields. ${message} Switch the payment basis to exact amortization.`,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch the payment basis to exact amortization.' }),
    );
    expect(focusField).toHaveBeenCalledWith('accrual.paymentBasis');
  });
});
