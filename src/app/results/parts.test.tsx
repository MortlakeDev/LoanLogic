// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calculateLoan, type RateMethodId } from '../../engine';
import { setLanguage, t } from '../state/i18n';
import {
  defaultForm,
  type FeeDraft,
  form,
  type LoanForm,
  resetForm,
  toLoanInput,
  updateForm,
} from '../state/loan';
import { fieldErrorMessage } from '../state/messages';
import { Changing, HeroAmount, type OkLoanResult } from './figures';
import { fixItems, fixListText } from './FixFields';
import { KpiTiles, overText } from './KpiTiles';
import { includesText, RateCard } from './RateCard';
import { summaryText } from './ResultsPanel';
import { Warnings } from './Warnings';

function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`No element matches ${selector}`);
  }
  return found;
}

/** The engine result of the design scenario with some fields changed. */
function compute(patch: Partial<LoanForm> = {}): OkLoanResult {
  const result = calculateLoan(toLoanInput({ ...defaultForm('2026-11-01'), ...patch }));
  if (!result.ok) {
    throw new Error(`Scenario does not compute: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function fee(patch: Partial<FeeDraft> & Pick<FeeDraft, 'uid'>): FeeDraft {
  return {
    name: '',
    kind: 'upfront',
    calc: 'fixed',
    value: '0',
    financing: 'paid',
    inApr: true,
    ...patch,
  };
}

const FAILED = { ok: false, reason: 'IRR_NO_CONVERGENCE' } as const;
const REASON =
  "Can't be computed: no rate from -99% to 1,000,000,000% balances the cash flows, or the result lies beyond ±1,000,000,000%.";

beforeEach(() => {
  setLanguage('en');
  resetForm();
});

afterEach(() => {
  cleanup();
});

describe('RateCard', () => {
  it('shows n/a with the reason for a rate that failed, without an explain trigger', () => {
    const computed = compute();
    const result: OkLoanResult = {
      ...computed,
      rates: { ...computed.rates, usRegZApr: FAILED, effective: FAILED },
    };
    render(
      <RateCard
        result={result}
        headline="usRegZApr"
        secondary="effective"
        fees={form.value.fees}
      />,
    );
    expect(el(document, '.rate-card__rate').textContent).toBe('n/a');
    expect(
      [...document.querySelectorAll('.rate-line__reason')].map((node) => node.textContent),
    ).toEqual([REASON, REASON]);
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(["How it's calculated: Nominal rate"]);
    expect(summaryText(result, 'monthly', 'usRegZApr')).toBe(
      'Monthly payment: $2,299.25. APR: n/a.',
    );
  });

  it('shows n/a without a reason for a rate the engine did not return', () => {
    const computed = compute();
    const rates = Object.fromEntries(
      Object.entries(computed.rates).filter(([method]) => method !== 'xirr'),
    );
    render(
      <RateCard
        result={{ ...computed, rates }}
        headline="xirr"
        secondary="effective"
        fees={form.value.fees}
      />,
    );
    expect(el(document, '.rate-card__rate').textContent).toBe('n/a');
    expect(document.querySelector('.rate-line__reason')).toBeNull();
    expect(document.querySelector('.badge')).toBeNull();
  });

  it('does not repeat the contract rate when it is the headline', () => {
    render(
      <RateCard
        result={compute()}
        headline="nominal"
        secondary="effective"
        fees={form.value.fees}
      />,
    );
    expect(screen.getAllByRole('term').map((node) => node.textContent)).toEqual([
      'Effective rate (without fees)',
    ]);
    expect(el(document, '.rate-card__includes').textContent).toBe('No fees included');
  });
});

describe('includesText', () => {
  const cases: readonly [string, readonly FeeDraft[], string][] = [
    ['no fees', [], 'No fees included'],
    [
      'a fee outside the rate',
      [fee({ uid: 'a', value: '1000.00', inApr: false })],
      'No fees included',
    ],
    [
      'a named fee',
      [fee({ uid: 'a', name: ' Broker fee ', value: '1000.00' })],
      'Includes Broker fee: $1,000.00',
    ],
    [
      'a periodic fee',
      [fee({ uid: 'a', kind: 'periodic', value: '10.00' })],
      'Includes $3,600.00 of periodic fees',
    ],
    [
      'insurance',
      [fee({ uid: 'a', kind: 'insurance', value: '20.00' })],
      'Includes $7,200.00 of insurance',
    ],
    [
      'several items',
      [
        fee({ uid: 'a', kind: 'periodic', value: '10.00' }),
        fee({ uid: 'b', kind: 'insurance', value: '20.00' }),
      ],
      'Includes 2 fees and insurance items: $10,800.00',
    ],
    [
      'an empty row next to a fee',
      [fee({ uid: 'a', value: '1000.00' }), fee({ uid: 'b', kind: 'insurance', value: '0' })],
      'Includes the $1,000.00 origination fee',
    ],
  ];

  it.each(cases)('describes %s', (_name, fees, expected) => {
    expect(includesText(compute({ fees }), 'usRegZApr', fees)).toBe(expected);
  });

  it.each<RateMethodId>(['nominal', 'effective'])('includes no fees in the %s rate', (method) => {
    expect(includesText(compute(), method, form.value.fees)).toBe('No fees included');
  });
});

describe('KPI tiles', () => {
  it.each([
    [360, 'monthly', 'Over 30 years'],
    [30, 'monthly', 'Over 2 years 6 months'],
    [1, 'monthly', 'Over 1 month'],
    [1560, 'weekly', 'Over 30 years'],
    [100, 'weekly', 'Over 100 payments'],
    [1, 'annual', 'Over 1 year'],
  ] as const)('describes %i %s payments as "%s"', (payments, frequency, expected) => {
    expect(overText(payments, frequency)).toBe(expected);
  });

  it('names periodic fees in the payments caption and interest alone in the cost caption', () => {
    const periodic = compute({ fees: [fee({ uid: 'a', kind: 'periodic', value: '10.00' })] });
    render(<KpiTiles result={periodic} frequency="monthly" />);
    expect([...document.querySelectorAll('.kpi__caption')].map((node) => node.textContent)).toEqual(
      ['Over 30 years', 'Interest, fees and insurance', 'Principal, interest and periodic fees'],
    );
    cleanup();
    render(<KpiTiles result={compute({ fees: [] })} frequency="monthly" />);
    expect([...document.querySelectorAll('.kpi__caption')].map((node) => node.textContent)).toEqual(
      ['Over 30 years', 'Interest only, no fees', 'Principal + interest'],
    );
  });

  it.each([
    [
      'insurance alone',
      [fee({ uid: 'a', kind: 'insurance', value: '20.00' })],
      'Principal, interest and insurance',
    ],
    [
      'periodic fees and insurance',
      [
        fee({ uid: 'a', kind: 'periodic', value: '10.00', inApr: false }),
        fee({ uid: 'b', kind: 'insurance', value: '20.00' }),
      ],
      'Principal, interest, fees and insurance',
    ],
    [
      'an insurance row that costs nothing',
      [fee({ uid: 'a', kind: 'insurance', value: '0' })],
      'Principal + interest',
    ],
  ] as const)('names %s in the payments caption', (_name, fees, caption) => {
    render(<KpiTiles result={compute({ fees: [...fees] })} frequency="monthly" />);
    expect(document.querySelectorAll('.kpi__caption')[2]?.textContent).toBe(caption);
  });
});

describe('figures', () => {
  it('replays the change animation only when the value changes', () => {
    const { container, rerender } = render(<Changing value="1">1</Changing>);
    const first = el(container, 'span');
    expect(first.getAttribute('class')).toBeNull();
    rerender(<Changing value="1">1</Changing>);
    expect(el(container, 'span')).toBe(first);
    rerender(<Changing value="2">2</Changing>);
    const second = el(container, 'span');
    expect(second).not.toBe(first);
    expect(second.getAttribute('class')).toBe('figure-changed');
  });

  it('puts the currency symbol where the locale does', () => {
    setLanguage('uk');
    updateForm({ currency: 'UAH' });
    const { container } = render(<HeroAmount value="12345.67" />);
    const visible = el(container, '[aria-hidden="true"]');
    expect(visible.lastElementChild?.className).toBe('hero-amount__currency');
    expect(visible.lastElementChild?.textContent).toBe('₴');
    expect(el(container, '.visually-hidden').textContent).toBe(visible.textContent);
    expect(visible.textContent).toMatch(/^12\s345,67\s₴$/u);
  });
});

describe('Warnings', () => {
  it('renders nothing without warnings', () => {
    const { container } = render(<Warnings warnings={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows each warning with its tone', () => {
    render(
      <Warnings
        warnings={[
          { code: 'EARLY_CLOSE', params: { paymentsCount: '242', scheduled: '360' } },
          { code: 'IRR_MULTIPLE', params: { methods: 'xirr,ukAprc' } },
        ]}
      />,
    );
    const notices = [...document.querySelectorAll('.notice')];
    expect(notices.map((notice) => notice.className)).toEqual([
      'notice notice--info',
      'notice notice--warning',
    ]);
    expect(within(notices[0] as HTMLElement).getByText(/242 of 360 payments/)).toBeTruthy();
    expect(notices[1]?.textContent).toBe(
      'More than one rate balances the cash flows of XIRR and APR. The one closest to zero is shown.',
    );
  });
});

describe('fixItems', () => {
  it('shows an error no single input causes without a link', () => {
    expect(fixItems(new Set(), [{ code: 'TERM_TOO_SHORT', field: null }])).toEqual([
      { key: 'engine:0', field: null, message: 'The term is shorter than one payment period.' },
    ]);
  });
});

describe('fixListText', () => {
  it('announces the title and every item as sentences', () => {
    expect(fixListText(new Set(), [{ code: 'TERM_TOO_SHORT', field: null }])).toBe(
      'Fix the highlighted fields. The term is shorter than one payment period.',
    );
  });

  it('ends the title with the full stop of the language', () => {
    setLanguage('zh-CN');
    const item = t('results.fixItem', {
      field: t('inputs.amount'),
      message: fieldErrorMessage('amount', { code: 'INPUT_INVALID', field: 'amount' }),
    });
    expect(fixListText(new Set(['amount']), [])).toBe(`${t('results.fixFields')}。${item}`);
    expect(item).toMatch(/。$/u);
  });
});
