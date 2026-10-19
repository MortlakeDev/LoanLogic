// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY_COUNT_IDS } from './daycount';
import { FREQUENCY_IDS } from './frequency';
import { formatMinor } from './money';
import { parseDecimal, rational } from './rational';
import { type LoanTerms, RATE_METHOD_IDS } from './types';
import { type LoanValidation, validateCashFlowInput, validateLoanInput } from './validate';

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

type Input = Record<string, unknown>;

/** A valid loan input; tests override or remove single fields. */
const BASE: Readonly<Input> = Object.freeze({
  currency: 'USD',
  amount: '1000.00',
  annualRatePct: '5',
  repayment: 'annuity',
  frequency: 'monthly',
  term: { payments: 12 },
  disbursementDate: '2026-01-15',
});

function input(overrides: Input = {}): Input {
  return { ...BASE, ...overrides };
}

function without(key: string, overrides: Input = {}): Input {
  const copy = input(overrides);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- building test inputs
  delete copy[key];
  return copy;
}

/** The errors as sorted `CODE@field` keys; fails the test if the input validated. */
function errorsOf(value: unknown): string[] {
  const result = validateLoanInput(value);
  if (result.ok) {
    throw new Error(`expected errors, got terms for ${JSON.stringify(value)}`);
  }
  return result.errors.map((error) => `${error.code}@${String(error.field)}`).sort();
}

function validated(value: unknown): Extract<LoanValidation, { ok: true }> {
  const result = validateLoanInput(value);
  if (!result.ok) {
    throw new Error(`expected terms, got ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function termsOf(value: unknown): LoanTerms {
  return validated(value).terms;
}

// ---------------------------------------------------------------------------------------
// Shape and defaults
// ---------------------------------------------------------------------------------------

describe('validateLoanInput — input shape', () => {
  it.each([null, undefined, 42, 'loan', true, [], [BASE]])(
    'rejects a non-object input (%j) with one error on field null',
    (value) => {
      expect(validateLoanInput(value)).toEqual({
        ok: false,
        errors: [{ code: 'INPUT_INVALID', field: null }],
      });
    },
  );

  it('reports every missing required field', () => {
    expect(errorsOf({})).toEqual(
      [
        'INPUT_INVALID@amount',
        'INPUT_INVALID@annualRatePct',
        'INPUT_INVALID@currency',
        'INPUT_INVALID@disbursementDate',
        'INPUT_INVALID@frequency',
        'INPUT_INVALID@repayment',
        'INPUT_INVALID@term',
      ].sort(),
    );
  });

  it('reads own properties only: inherited fields count as missing', () => {
    expect(errorsOf(Object.create(BASE))).toEqual(errorsOf({}));
  });

  it('accepts an object without a prototype', () => {
    const bare = Object.assign(Object.create(null) as Input, BASE);
    expect(termsOf(bare).amount).toBe(100000n);
  });

  it('ignores unknown keys', () => {
    expect(termsOf(input({ colour: 'blue', notes: { a: 1 } }))).toEqual(termsOf(input()));
  });

  it('never writes to the input (a deeply frozen input validates)', () => {
    const frozen = deepFreeze(
      input({
        repayment: 'balloon',
        balloon: { kind: 'percent', value: '25' },
        accrual: { mode: 'daycount', method: 'act-365f' },
        rounding: { interest: 'half-even' },
        fees: [{ id: 'f', kind: 'upfront', calc: 'percent', value: '1', financing: 'financed' }],
        rateMethods: ['xirr', 'xirr', 'nominal'],
      }),
    );
    const before = JSON.stringify(frozen);
    expect(termsOf(frozen).rateMethods).toEqual(['xirr', 'nominal']);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

/** Freezes a JSON-like value and everything inside it. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

describe('validateLoanInput — defaults', () => {
  it('applies every default of SPEC §15', () => {
    const { terms, warnings } = validated(input());
    expect(warnings).toEqual([]);
    expect(terms).toEqual({
      currency: 'USD',
      minorUnits: 2,
      amount: 100000n,
      annualRatePct: '5',
      rate: rational(1n, 20n),
      repayment: 'annuity',
      balloon: null,
      frequency: 'monthly',
      payments: 12,
      disbursementDate: { y: 2026, m: 1, d: 15 },
      endOfMonth: true,
      accrual: { mode: 'periodic', compounding: 'monthly' },
      rounding: {
        interest: 'half-up',
        fees: 'half-up',
        payment: 'minor-half-up',
        principalRemainder: 'last',
      },
      fees: [],
      rateMethods: [...RATE_METHOD_IDS],
    });
  });

  it.each(FREQUENCY_IDS)('defaults the compounding to the frequency (%s)', (frequency) => {
    expect(termsOf(input({ frequency })).accrual).toEqual({
      mode: 'periodic',
      compounding: frequency,
    });
    expect(termsOf(input({ frequency, accrual: { mode: 'periodic' } })).accrual).toEqual({
      mode: 'periodic',
      compounding: frequency,
    });
  });

  it('hands out the default rounding frozen, so no caller can change it for later calls', () => {
    const rounding = termsOf(input()).rounding;
    expect(Object.isFrozen(rounding)).toBe(true);
    expect(() => {
      (rounding as { interest: string }).interest = 'floor';
    }).toThrow(TypeError);
    expect(termsOf(input()).rounding.interest).toBe('half-up');
  });

  it('treats a property set to undefined as absent', () => {
    expect(
      termsOf(
        input({
          endOfMonth: undefined,
          accrual: undefined,
          rounding: undefined,
          fees: undefined,
          rateMethods: undefined,
          balloon: undefined,
        }),
      ),
    ).toEqual(termsOf(input()));
  });
});

// ---------------------------------------------------------------------------------------
// Phase 1, field by field
// ---------------------------------------------------------------------------------------

describe('validateLoanInput — currency (SPEC §1.2)', () => {
  it.each([978, null, true, ['USD'], { code: 'USD' }])(
    'rejects a non-string currency (%j) as INPUT_INVALID',
    (currency) => {
      expect(errorsOf(input({ currency }))).toEqual(['INPUT_INVALID@currency']);
    },
  );

  it.each([
    'XAU',
    'XAG',
    'XPT',
    'XPD',
    'XDR',
    'XSU',
    'XUA',
    'XBA',
    'XBB',
    'XBC',
    'XBD',
    'XTS',
    'XXX',
    'usd',
    'ABC',
    '',
    ' USD',
    'constructor',
    '__proto__',
    'toString',
  ])('rejects %j as CURRENCY_INVALID', (currency) => {
    expect(errorsOf(input({ currency }))).toEqual(['CURRENCY_INVALID@currency']);
  });

  it.each([
    ['USD', 2, '1.00', 100n],
    ['GBP', 2, '1.00', 100n],
    ['EUR', 2, '1.00', 100n],
    ['CNY', 2, '1.00', 100n],
    ['UAH', 2, '1.00', 100n],
    ['JPY', 0, '100', 100n],
    ['KRW', 0, '100', 100n],
    ['KWD', 3, '1.000', 1000n],
    ['CLF', 4, '1.0001', 10001n],
  ] as const)('%s has %i minor digits', (currency, digits, amount, minor) => {
    const terms = termsOf(input({ currency, amount }));
    expect(terms.currency).toBe(currency);
    expect(terms.minorUnits).toBe(digits);
    expect(terms.amount).toBe(minor);
  });
});

describe('validateLoanInput — amount', () => {
  it.each([
    '1,000.00',
    '1e3',
    '+5',
    '01',
    '5.',
    '.5',
    ' 5',
    '5 ',
    '',
    '−5',
    '1_000',
    1000,
    null,
    true,
  ])('rejects a malformed amount (%j) as INPUT_INVALID', (amount) => {
    expect(errorsOf(input({ amount }))).toEqual(['INPUT_INVALID@amount']);
  });

  it('rejects a missing amount as INPUT_INVALID', () => {
    expect(errorsOf(without('amount'))).toEqual(['INPUT_INVALID@amount']);
  });

  it.each(['0', '0.00', '-0', '-0.01', '-5.00', '1000000000000000.01', '1000000000000001'])(
    'rejects %s as AMOUNT_RANGE',
    (amount) => {
      expect(errorsOf(input({ amount }))).toEqual(['AMOUNT_RANGE@amount']);
    },
  );

  it('accepts the limits 0.01 and 1e15', () => {
    expect(termsOf(input({ amount: '0.01' })).amount).toBe(1n);
    expect(termsOf(input({ amount: '1000000000000000' })).amount).toBe(100000000000000000n);
    expect(termsOf(input({ amount: '1000000000000000.00' })).amount).toBe(100000000000000000n);
  });

  it('accepts trailing zeros beyond the minor unit (SPEC §1.2: "100.100" USD)', () => {
    expect(termsOf(input({ amount: '100.100' })).amount).toBe(10010n);
  });

  it.each([
    ['USD', '100.005'],
    ['JPY', '100000.5'],
    ['KRW', '1.1'],
    ['KWD', '1.0005'],
    ['CLF', '1.00005'],
  ])('rejects more decimals than %s allows (%s) as TOO_MANY_DECIMALS', (currency, amount) => {
    expect(errorsOf(input({ currency, amount }))).toEqual(['TOO_MANY_DECIMALS@amount']);
  });

  it('checks the range before the minor units', () => {
    expect(errorsOf(input({ amount: '-5.005' }))).toEqual(['AMOUNT_RANGE@amount']);
    expect(errorsOf(input({ amount: '1000000000000000.001' }))).toEqual(['AMOUNT_RANGE@amount']);
  });

  it('checks the minor units only when the currency is valid', () => {
    expect(errorsOf(input({ currency: 'XAU', amount: '100.005' }))).toEqual([
      'CURRENCY_INVALID@currency',
    ]);
    expect(errorsOf(input({ currency: 5, amount: '100.005' }))).toEqual(['INPUT_INVALID@currency']);
  });
});

describe('validateLoanInput — annualRatePct', () => {
  it.each([5, '5%', '1e2', '+5', '5,5', '', null])(
    'rejects a malformed rate (%j) as INPUT_INVALID',
    (annualRatePct) => {
      expect(errorsOf(input({ annualRatePct }))).toEqual(['INPUT_INVALID@annualRatePct']);
    },
  );

  it.each(['-20.01', '-25', '1000.01', '1001', '100000'])('rejects %s as RATE_RANGE', (rate) => {
    expect(errorsOf(input({ annualRatePct: rate }))).toEqual(['RATE_RANGE@annualRatePct']);
  });

  it('keeps the entered string and parses j exactly', () => {
    expect(termsOf(input({ annualRatePct: '6.5' })).rate).toEqual(rational(13n, 200n));
    expect(termsOf(input({ annualRatePct: '6.875' })).rate).toEqual(rational(11n, 160n));
    const terms = termsOf(input({ annualRatePct: '3.10' }));
    expect(terms.annualRatePct).toBe('3.10');
    expect(terms.rate).toEqual(rational(31n, 1000n));
    expect(termsOf(input({ annualRatePct: '0.0001' })).rate).toEqual(rational(1n, 1000000n));
  });

  it.each([
    ['-20', 'RATE_NEGATIVE'],
    ['-0.5', 'RATE_NEGATIVE'],
    ['-0.0001', 'RATE_NEGATIVE'],
    ['100.01', 'RATE_HIGH'],
    ['1000', 'RATE_HIGH'],
  ] as const)('accepts %s with warning %s and params.annualRatePct', (rate, code) => {
    expect(validated(input({ annualRatePct: rate })).warnings).toEqual([
      { code, params: { annualRatePct: rate } },
    ]);
  });

  it.each(['0', '-0', '0.00', '100', '100.00', '5'])('accepts %s without a warning', (rate) => {
    expect(validated(input({ annualRatePct: rate })).warnings).toEqual([]);
  });

  it('treats -0 as a zero rate', () => {
    expect(termsOf(input({ annualRatePct: '-0' })).rate).toEqual(rational(0n));
  });
});

describe('validateLoanInput — repayment and frequency', () => {
  it.each(['interest-only', 'Annuity', '', 1, null])(
    'rejects repayment %j as INPUT_INVALID',
    (repayment) => {
      expect(errorsOf(input({ repayment }))).toEqual(['INPUT_INVALID@repayment']);
    },
  );

  it.each(['annuity', 'equal-principal', 'bullet'] as const)(
    'accepts repayment %s',
    (repayment) => {
      expect(termsOf(input({ repayment })).repayment).toBe(repayment);
    },
  );

  it.each(['daily', 'fortnightly', 'semimonthly', 'Monthly', 12, null])(
    'rejects frequency %j as INPUT_INVALID',
    (frequency) => {
      expect(errorsOf(input({ frequency }))).toEqual(['INPUT_INVALID@frequency']);
    },
  );

  it.each(FREQUENCY_IDS)('accepts frequency %s', (frequency) => {
    expect(termsOf(input({ frequency })).frequency).toBe(frequency);
  });
});

describe('validateLoanInput — balloon', () => {
  const balloonInput = (balloon: unknown, overrides: Input = {}): Input =>
    input({ repayment: 'balloon', balloon, ...overrides });

  it('is ignored unless the repayment is a balloon', () => {
    for (const repayment of ['annuity', 'equal-principal', 'bullet']) {
      expect(termsOf(input({ repayment, balloon: 'garbage' })).balloon).toBeNull();
    }
    // An unknown repayment is not a balloon either.
    expect(errorsOf(input({ repayment: 'baloon', balloon: 7 }))).toEqual([
      'INPUT_INVALID@repayment',
    ]);
  });

  it.each([undefined, null, 'percent', 25, ['amount', '1.00']])(
    'requires a plain object (%j)',
    (balloon) => {
      expect(errorsOf(balloonInput(balloon))).toEqual(['INPUT_INVALID@balloon']);
    },
  );

  it('reports kind and value separately', () => {
    expect(errorsOf(balloonInput({ kind: 'residual', value: '10' }))).toEqual([
      'INPUT_INVALID@balloon.kind',
    ]);
    expect(errorsOf(balloonInput({ value: '10' }))).toEqual(['INPUT_INVALID@balloon.kind']);
    expect(errorsOf(balloonInput({ kind: 'percent', value: 10 }))).toEqual([
      'INPUT_INVALID@balloon.value',
    ]);
    expect(errorsOf(balloonInput({ kind: 'amount' }))).toEqual(['INPUT_INVALID@balloon.value']);
    expect(errorsOf(balloonInput({ kind: 1, value: '1e2' }))).toEqual([
      'INPUT_INVALID@balloon.kind',
      'INPUT_INVALID@balloon.value',
    ]);
  });

  it('checks the minor units of an amount, not of a percentage', () => {
    expect(errorsOf(balloonInput({ kind: 'amount', value: '100.005' }))).toEqual([
      'TOO_MANY_DECIMALS@balloon.value',
    ]);
    expect(termsOf(balloonInput({ kind: 'percent', value: '12.345' })).balloon).toEqual({
      kind: 'percent',
      pct: parseDecimal('12.345'),
    });
    // Without a valid currency only the currency is reported.
    expect(
      errorsOf(balloonInput({ kind: 'amount', value: '100.005' }, { currency: 'XXX' })),
    ).toEqual(['CURRENCY_INVALID@currency']);
  });

  it('parses an amount to minor units', () => {
    expect(termsOf(balloonInput({ kind: 'amount', value: '250.50' })).balloon).toEqual({
      kind: 'amount',
      amount: 25050n,
    });
  });

  it.each([
    ['JPY', '100000', '100.5', '100', 100n],
    ['KWD', '1000.000', '1.0005', '1.000', 1000n],
    ['CLF', '1000.0000', '1.00005', '1.0001', 10001n],
  ])(
    'checks the residual amount against the minor units of %s',
    (currency, amount, tooPrecise, exact, minor) => {
      expect(
        errorsOf(balloonInput({ kind: 'amount', value: tooPrecise }, { currency, amount })),
      ).toEqual(['TOO_MANY_DECIMALS@balloon.value']);
      expect(
        termsOf(balloonInput({ kind: 'amount', value: exact }, { currency, amount })).balloon,
      ).toEqual({ kind: 'amount', amount: minor });
    },
  );

  it.each([
    ['amount', '0'],
    ['amount', '0.00'],
    ['amount', '-1.00'],
    ['amount', '1000.00'],
    ['amount', '1000.01'],
    ['percent', '0'],
    ['percent', '-5'],
    ['percent', '100'],
    ['percent', '150'],
    // 0.0004 % of 1 000.00 is 0.4 minor units: zero after rounding.
    ['percent', '0.0004'],
    // 99.9995 % of 1 000.00 is 99 999.5 minor units: half-up gives P.
    ['percent', '99.9995'],
  ])('rejects a residual %s %s outside 0 < Bal < P as BALLOON_RANGE', (kind, value) => {
    expect(errorsOf(balloonInput({ kind, value }))).toEqual(['BALLOON_RANGE@balloon.value']);
  });

  it.each([
    ['amount', '0.01'],
    ['amount', '999.99'],
    ['percent', '0.0005'],
    ['percent', '99.9994'],
    ['percent', '25'],
  ])('accepts a residual %s %s inside 0 < Bal < P after rounding', (kind, value) => {
    expect(termsOf(balloonInput({ kind, value })).repayment).toBe('balloon');
  });

  it('measures the residual against the principal financed (amount + financed fees)', () => {
    const fee = (financing: string): Input => ({
      fees: [{ id: 'f', kind: 'upfront', calc: 'fixed', value: '1.00', financing }],
    });
    const atAmount = { kind: 'amount', value: '1000.00' };
    expect(termsOf(balloonInput(atAmount, fee('financed'))).balloon).toEqual({
      kind: 'amount',
      amount: 100000n,
    });
    expect(errorsOf(balloonInput(atAmount, fee('paid')))).toEqual(['BALLOON_RANGE@balloon.value']);
  });

  it('rounds percentage upfront fees with the fee rounding mode before measuring P', () => {
    // 0.0125 % of 1 000.00 = 12.5 minor units: half-up 13, half-even 12.
    const scenario = (fees: string): Input =>
      balloonInput(
        { kind: 'amount', value: '1000.12' },
        {
          rounding: { fees },
          fees: [
            { id: 'f', kind: 'upfront', calc: 'percent', value: '0.0125', financing: 'financed' },
          ],
        },
      );
    expect(termsOf(scenario('half-up')).balloon).toEqual({ kind: 'amount', amount: 100012n });
    expect(errorsOf(scenario('half-even'))).toEqual(['BALLOON_RANGE@balloon.value']);
  });
});

describe('validateLoanInput — term (SPEC §2.4)', () => {
  it.each([12, '12', null, [12], true])('rejects a non-object term (%j)', (term) => {
    expect(errorsOf(input({ term }))).toEqual(['INPUT_INVALID@term']);
  });

  it('rejects a missing term', () => {
    expect(errorsOf(without('term'))).toEqual(['INPUT_INVALID@term']);
  });

  it.each([
    {},
    { months: 6 },
    { payments: 12, years: 1 },
    { payments: 12, months: 1 },
    { payments: 12, endDate: '2027-01-15' },
    { years: 1, endDate: '2027-01-15' },
    { endDate: '2027-01-15', months: 1 },
    { payments: 12, years: 1, months: 0, endDate: '2027-01-15' },
    { payments: null, years: null },
  ])('rejects a term without exactly one form (%j)', (term) => {
    expect(errorsOf(input({ term }))).toEqual(['INPUT_INVALID@term']);
  });

  it('decides the form by the properties that are not undefined', () => {
    expect(termsOf(input({ term: { payments: undefined, years: 2 } })).payments).toBe(24);
    expect(termsOf(input({ term: { payments: 6, years: undefined, unit: 'x' } })).payments).toBe(6);
  });

  it.each(['12', 12.5, Number.NaN, Number.POSITIVE_INFINITY, true, null])(
    'rejects payments %j as INPUT_INVALID on term.payments',
    (payments) => {
      expect(errorsOf(input({ term: { payments } }))).toEqual(['INPUT_INVALID@term.payments']);
    },
  );

  it.each([0, -1, 1201, 1e9])('rejects payments %j as TERM_RANGE on term.payments', (payments) => {
    expect(errorsOf(input({ term: { payments } }))).toEqual(['TERM_RANGE@term.payments']);
  });

  it('accepts 1 … 1200 payments, 12.0 as an integer', () => {
    expect(termsOf(input({ term: { payments: 1 } })).payments).toBe(1);
    expect(termsOf(input({ term: { payments: 1200 } })).payments).toBe(1200);
    expect(termsOf(input({ term: { payments: 12.0 } })).payments).toBe(12);
  });

  it('validates years and months', () => {
    expect(errorsOf(input({ term: { years: '1' } }))).toEqual(['INPUT_INVALID@term.years']);
    expect(errorsOf(input({ term: { years: 1.5 } }))).toEqual(['INPUT_INVALID@term.years']);
    expect(errorsOf(input({ term: { years: -1 } }))).toEqual(['TERM_RANGE@term.years']);
    expect(errorsOf(input({ term: { years: 101 } }))).toEqual(['TERM_RANGE@term.years']);
    expect(errorsOf(input({ term: { years: 1, months: 12 } }))).toEqual(['TERM_RANGE@term.months']);
    expect(errorsOf(input({ term: { years: 1, months: -1 } }))).toEqual(['TERM_RANGE@term.months']);
    expect(errorsOf(input({ term: { years: 1, months: 0.5 } }))).toEqual([
      'INPUT_INVALID@term.months',
    ]);
    expect(errorsOf(input({ term: { years: 1, months: null } }))).toEqual([
      'INPUT_INVALID@term.months',
    ]);
    expect(errorsOf(input({ term: { years: 'x', months: 'y' } }))).toEqual([
      'INPUT_INVALID@term.months',
      'INPUT_INVALID@term.years',
    ]);
  });

  it('resolves years + months to N = roundHalfUp(totalMonths × m / 12)', () => {
    expect(termsOf(input({ term: { years: 0, months: 7 }, frequency: 'weekly' })).payments).toBe(
      30,
    );
    expect(termsOf(input({ term: { years: 2 } })).payments).toBe(24);
    expect(termsOf(input({ term: { years: 1, months: 6 }, frequency: 'quarterly' })).payments).toBe(
      6,
    );
    // 6 months annual: 0.5 rounds half-up to 1.
    expect(termsOf(input({ term: { years: 0, months: 6 }, frequency: 'annual' })).payments).toBe(1);
    expect(termsOf(input({ term: { years: 100 } })).payments).toBe(1200);
  });

  it('reports TERM_TOO_SHORT and TERM_RANGE of a resolved term on field term', () => {
    expect(errorsOf(input({ term: { years: 0, months: 0 } }))).toEqual(['TERM_TOO_SHORT@term']);
    expect(errorsOf(input({ term: { years: 0, months: 5 }, frequency: 'annual' }))).toEqual([
      'TERM_TOO_SHORT@term',
    ]);
    expect(errorsOf(input({ term: { years: 100, months: 1 } }))).toEqual(['TERM_RANGE@term']);
    expect(errorsOf(input({ term: { years: 24 }, frequency: 'weekly' }))).toEqual([
      'TERM_RANGE@term',
    ]);
  });

  it('validates an end date', () => {
    expect(errorsOf(input({ term: { endDate: 20270115 } }))).toEqual([
      'INPUT_INVALID@term.endDate',
    ]);
    expect(errorsOf(input({ term: { endDate: null } }))).toEqual(['INPUT_INVALID@term.endDate']);
    expect(errorsOf(input({ term: { endDate: '2027-02-30' } }))).toEqual([
      'DATE_INVALID@term.endDate',
    ]);
    expect(errorsOf(input({ term: { endDate: '2027/01/15' } }))).toEqual([
      'DATE_INVALID@term.endDate',
    ]);
  });

  it('counts the schedule dates up to the end date', () => {
    expect(termsOf(input({ term: { endDate: '2027-01-15' } })).payments).toBe(12);
    expect(termsOf(input({ term: { endDate: '2027-01-14' } })).payments).toBe(11);
    expect(termsOf(input({ term: { endDate: '2026-02-15' } })).payments).toBe(1);
    expect(errorsOf(input({ term: { endDate: '2026-02-14' } }))).toEqual(['TERM_TOO_SHORT@term']);
    expect(errorsOf(input({ term: { endDate: '2026-01-15' } }))).toEqual(['TERM_TOO_SHORT@term']);
    expect(termsOf(input({ term: { endDate: '2126-01-15' } })).payments).toBe(1200);
    expect(errorsOf(input({ term: { endDate: '2126-02-15' } }))).toEqual(['TERM_RANGE@term']);
  });

  it('counts end-date terms of day-based frequencies by days', () => {
    // Weekly from 2026-01-15: 01-22, 01-29, 02-05, 02-12, 02-19.
    const weekly = (endDate: string): Input => input({ frequency: 'weekly', term: { endDate } });
    expect(termsOf(weekly('2026-02-12')).payments).toBe(4);
    expect(termsOf(weekly('2026-02-18')).payments).toBe(4);
    expect(termsOf(weekly('2026-02-19')).payments).toBe(5);
    expect(errorsOf(weekly('2026-01-21'))).toEqual(['TERM_TOO_SHORT@term']);
    // 1 200 weeks (8 400 days) from 2026-01-15 end on 2049-01-14; one more week is out
    // of range.
    expect(termsOf(weekly('2049-01-14')).payments).toBe(1200);
    expect(termsOf(weekly('2049-01-20')).payments).toBe(1200);
    expect(errorsOf(weekly('2049-01-21'))).toEqual(['TERM_RANGE@term']);
  });

  it('counts end-date terms with the end-of-month rule of the schedule', () => {
    // From 2026-02-28: with the rule the first date is 2026-03-31, without it 2026-03-28.
    const term = { endDate: '2026-03-30' };
    expect(
      termsOf(input({ disbursementDate: '2026-02-28', term, endOfMonth: false })).payments,
    ).toBe(1);
    expect(errorsOf(input({ disbursementDate: '2026-02-28', term }))).toEqual([
      'TERM_TOO_SHORT@term',
    ]);
  });
});

describe('validateLoanInput — disbursementDate and endOfMonth', () => {
  it.each([20260115, null, true, { y: 2026, m: 1, d: 15 }])(
    'rejects a non-string date (%j) as INPUT_INVALID',
    (disbursementDate) => {
      expect(errorsOf(input({ disbursementDate }))).toEqual(['INPUT_INVALID@disbursementDate']);
    },
  );

  it.each([
    '2026-13-01',
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '0000-01-01',
    '2026-1-15',
    '26-01-15',
    '2026-01-15T00:00:00Z',
    '',
  ])('rejects %j as DATE_INVALID', (disbursementDate) => {
    expect(errorsOf(input({ disbursementDate }))).toEqual(['DATE_INVALID@disbursementDate']);
  });

  it('accepts leap days and the supported range', () => {
    expect(termsOf(input({ disbursementDate: '2028-02-29' })).disbursementDate).toEqual({
      y: 2028,
      m: 2,
      d: 29,
    });
    expect(termsOf(input({ disbursementDate: '0001-01-01' })).disbursementDate).toEqual({
      y: 1,
      m: 1,
      d: 1,
    });
  });

  it('rejects a schedule ending after 9999-12-31 with DATE_INVALID on disbursementDate', () => {
    expect(errorsOf(input({ disbursementDate: '9990-06-15', term: { years: 30 } }))).toEqual([
      'DATE_INVALID@disbursementDate',
    ]);
    expect(errorsOf(input({ disbursementDate: '9999-12-01', term: { payments: 1 } }))).toEqual([
      'DATE_INVALID@disbursementDate',
    ]);
    expect(
      errorsOf(
        input({ disbursementDate: '9999-12-31', term: { payments: 1 }, frequency: 'weekly' }),
      ),
    ).toEqual(['DATE_INVALID@disbursementDate']);
    expect(termsOf(input({ disbursementDate: '9999-11-30', term: { payments: 1 } })).payments).toBe(
      1,
    );
    expect(
      termsOf(input({ disbursementDate: '9999-12-24', term: { payments: 1 }, frequency: 'weekly' }))
        .payments,
    ).toBe(1);
  });

  it('checks the last date only with a valid N', () => {
    expect(
      errorsOf(input({ disbursementDate: '9999-12-31', term: { years: 0, months: 0 } })),
    ).toEqual(['TERM_TOO_SHORT@term']);
  });

  it.each(['true', 1, 0, null])('rejects endOfMonth %j as INPUT_INVALID', (endOfMonth) => {
    expect(errorsOf(input({ endOfMonth }))).toEqual(['INPUT_INVALID@endOfMonth']);
  });

  it('defaults endOfMonth to true and keeps false', () => {
    expect(termsOf(input()).endOfMonth).toBe(true);
    expect(termsOf(input({ endOfMonth: false })).endOfMonth).toBe(false);
    expect(termsOf(input({ endOfMonth: true })).endOfMonth).toBe(true);
  });
});

describe('validateLoanInput — accrual', () => {
  it.each(['periodic', 1, null, []])('rejects a non-object accrual (%j)', (accrual) => {
    expect(errorsOf(input({ accrual }))).toEqual(['INPUT_INVALID@accrual']);
  });

  it.each([{}, { mode: 'simple' }, { mode: 'Periodic' }, { mode: null }])(
    'rejects accrual %j on accrual.mode',
    (accrual) => {
      expect(errorsOf(input({ accrual }))).toEqual(['INPUT_INVALID@accrual.mode']);
    },
  );

  it('validates the periodic compounding', () => {
    expect(errorsOf(input({ accrual: { mode: 'periodic', compounding: 'daily' } }))).toEqual([
      'INPUT_INVALID@accrual.compounding',
    ]);
    expect(errorsOf(input({ accrual: { mode: 'periodic', compounding: null } }))).toEqual([
      'INPUT_INVALID@accrual.compounding',
    ]);
    for (const compounding of [...FREQUENCY_IDS, 'continuous']) {
      expect(termsOf(input({ accrual: { mode: 'periodic', compounding } })).accrual).toEqual({
        mode: 'periodic',
        compounding,
      });
    }
  });

  it('ignores method and paymentBasis in periodic mode', () => {
    expect(
      termsOf(input({ accrual: { mode: 'periodic', method: 'nope', paymentBasis: 'nope' } }))
        .accrual,
    ).toEqual({ mode: 'periodic', compounding: 'monthly' });
  });

  it('validates the day-count method and payment basis', () => {
    expect(errorsOf(input({ accrual: { mode: 'daycount' } }))).toEqual([
      'INPUT_INVALID@accrual.method',
    ]);
    expect(errorsOf(input({ accrual: { mode: 'daycount', method: 'act-365' } }))).toEqual([
      'INPUT_INVALID@accrual.method',
    ]);
    expect(
      errorsOf(input({ accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'actual' } })),
    ).toEqual(['INPUT_INVALID@accrual.paymentBasis']);
    expect(
      errorsOf(input({ accrual: { mode: 'daycount', method: 1, paymentBasis: null } })),
    ).toEqual(['INPUT_INVALID@accrual.method', 'INPUT_INVALID@accrual.paymentBasis']);
  });

  it.each(DAY_COUNT_IDS)(
    'accepts day-count method %s with the nominal basis by default',
    (method) => {
      expect(termsOf(input({ accrual: { mode: 'daycount', method } })).accrual).toEqual({
        mode: 'daycount',
        method,
        paymentBasis: 'nominal',
      });
    },
  );

  it('keeps the exact basis and ignores compounding in day-count mode', () => {
    expect(
      termsOf(
        input({
          accrual: {
            mode: 'daycount',
            method: 'act-365f',
            paymentBasis: 'exact',
            compounding: 'x',
          },
        }),
      ).accrual,
    ).toEqual({ mode: 'daycount', method: 'act-365f', paymentBasis: 'exact' });
  });

  it('reports only the frequency when the default compounding depends on it', () => {
    expect(errorsOf(input({ frequency: 'daily' }))).toEqual(['INPUT_INVALID@frequency']);
    expect(errorsOf(input({ frequency: 'daily', accrual: { mode: 'periodic' } }))).toEqual([
      'INPUT_INVALID@frequency',
    ]);
    expect(
      errorsOf(input({ frequency: 'daily', accrual: { mode: 'periodic', compounding: 'annual' } })),
    ).toEqual(['INPUT_INVALID@frequency']);
  });

  it('rejects a balloon with the exact payment basis as UNSUPPORTED (phase 2)', () => {
    const balloon = { kind: 'percent', value: '25' };
    expect(
      errorsOf(
        input({
          repayment: 'balloon',
          balloon,
          accrual: { mode: 'daycount', method: 'act-365f', paymentBasis: 'exact' },
        }),
      ),
    ).toEqual(['UNSUPPORTED@accrual.paymentBasis']);
    // The nominal basis, other repayment types and periodic mode are fine.
    expect(
      termsOf(
        input({ repayment: 'balloon', balloon, accrual: { mode: 'daycount', method: 'act-360' } }),
      ).repayment,
    ).toBe('balloon');
    expect(
      termsOf(input({ accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'exact' } }))
        .accrual,
    ).toEqual({ mode: 'daycount', method: 'act-360', paymentBasis: 'exact' });
    expect(
      termsOf(
        input({
          repayment: 'balloon',
          balloon,
          accrual: { mode: 'periodic', paymentBasis: 'exact' },
        }),
      ).accrual,
    ).toEqual({ mode: 'periodic', compounding: 'monthly' });
  });
});

describe('validateLoanInput — rounding', () => {
  it.each(['half-up', 1, null, []])('rejects a non-object rounding (%j)', (rounding) => {
    expect(errorsOf(input({ rounding }))).toEqual(['INPUT_INVALID@rounding']);
  });

  it('reports every invalid rounding property on its own path', () => {
    expect(
      errorsOf(
        input({
          rounding: {
            interest: 'up',
            fees: 'bankers',
            payment: 'half-up',
            principalRemainder: 'middle',
          },
        }),
      ),
    ).toEqual([
      'INPUT_INVALID@rounding.fees',
      'INPUT_INVALID@rounding.interest',
      'INPUT_INVALID@rounding.payment',
      'INPUT_INVALID@rounding.principalRemainder',
    ]);
    expect(errorsOf(input({ rounding: { payment: null } }))).toEqual([
      'INPUT_INVALID@rounding.payment',
    ]);
  });

  it('fills the defaults of absent properties', () => {
    expect(termsOf(input({ rounding: { interest: 'floor' } })).rounding).toEqual({
      interest: 'floor',
      fees: 'half-up',
      payment: 'minor-half-up',
      principalRemainder: 'last',
    });
  });

  it.each(['half-up', 'half-even', 'ceil', 'floor'] as const)(
    'accepts rounding mode %s',
    (mode) => {
      const rounding = termsOf(input({ rounding: { interest: mode, fees: mode } })).rounding;
      expect(rounding.interest).toBe(mode);
      expect(rounding.fees).toBe(mode);
    },
  );

  it.each(['minor-half-up', 'minor-ceil', 'unit-half-up', 'unit-ceil'] as const)(
    'accepts payment policy %s',
    (payment) => {
      expect(termsOf(input({ rounding: { payment } })).rounding.payment).toBe(payment);
    },
  );

  it('validates principalRemainder whatever the repayment type', () => {
    expect(
      termsOf(input({ rounding: { principalRemainder: 'first' } })).rounding.principalRemainder,
    ).toBe('first');
    expect(errorsOf(input({ rounding: { principalRemainder: 'start' } }))).toEqual([
      'INPUT_INVALID@rounding.principalRemainder',
    ]);
  });
});

describe('validateLoanInput — equal principal remainder first (SPEC §5.3)', () => {
  const ep = (amount: string, overrides: Input = {}): Input =>
    input({
      amount,
      repayment: 'equal-principal',
      term: { payments: 360 },
      rounding: { principalRemainder: 'first' },
      ...overrides,
    });

  it('rejects a negative first principal as AMOUNT_TOO_SMALL_FOR_TERM on amount', () => {
    // q = R(361.80 / 360) = 1.01; p_1 = 361.80 − 359 × 1.01 = −0.79.
    expect(errorsOf(ep('361.80'))).toEqual(['AMOUNT_TOO_SMALL_FOR_TERM@amount']);
  });

  it('accepts a first principal of zero or more', () => {
    // q = R(361.79 / 360) = 1.00; p_1 = 361.79 − 359.00 = 2.79.
    expect(termsOf(ep('361.79')).repayment).toBe('equal-principal');
    // q = 1.00 exactly: p_1 = 1.00.
    expect(termsOf(ep('360.00')).payments).toBe(360);
  });

  it('applies only to equal principal with the remainder first', () => {
    expect(termsOf(ep('361.80', { rounding: { principalRemainder: 'last' } })).amount).toBe(36180n);
    expect(termsOf(ep('361.80', { repayment: 'annuity' })).amount).toBe(36180n);
  });

  it('uses the principal financed', () => {
    const fee = (financing: string): Input => ({
      fees: [{ id: 'f', kind: 'upfront', calc: 'fixed', value: '0.01', financing }],
    });
    expect(errorsOf(ep('361.79', fee('financed')))).toEqual(['AMOUNT_TOO_SMALL_FOR_TERM@amount']);
    expect(termsOf(ep('361.79', fee('paid'))).amount).toBe(36179n);
  });

  it('needs a valid N', () => {
    expect(errorsOf(ep('361.80', { term: { years: 0, months: 0 } }))).toEqual([
      'TERM_TOO_SHORT@term',
    ]);
  });
});

describe('validateLoanInput — fees (SPEC §6)', () => {
  const withFees = (fees: unknown, overrides: Input = {}): Input => input({ fees, ...overrides });
  const fee = (overrides: Input = {}): Input => ({
    id: 'fee',
    kind: 'periodic',
    calc: 'fixed',
    value: '1.00',
    ...overrides,
  });

  it.each(['fee', {}, null, 1])('rejects fees that are not an array (%j)', (fees) => {
    expect(errorsOf(withFees(fees))).toEqual(['INPUT_INVALID@fees']);
  });

  it('rejects items that are not plain objects, holes included', () => {
    // eslint-disable-next-line no-sparse-arrays -- a hole is an item too
    const fees = [null, 'fee', 5, [], fee(), , true];
    expect(errorsOf(withFees(fees))).toEqual(
      [
        'INPUT_INVALID@fees[0]',
        'INPUT_INVALID@fees[1]',
        'INPUT_INVALID@fees[2]',
        'INPUT_INVALID@fees[3]',
        'INPUT_INVALID@fees[5]',
        'INPUT_INVALID@fees[6]',
      ].sort(),
    );
  });

  it.each([undefined, 7, '', null])('rejects id %j', (id) => {
    expect(errorsOf(withFees([fee({ id })]))).toEqual(['INPUT_INVALID@fees[0].id']);
  });

  it('reports a duplicate id on the later items', () => {
    expect(
      errorsOf(withFees([fee({ id: 'a' }), fee({ id: 'b' }), fee({ id: 'a' }), fee({ id: 'a' })])),
    ).toEqual(['INPUT_INVALID@fees[2].id', 'INPUT_INVALID@fees[3].id']);
    // An earlier invalid id does not reserve anything.
    expect(errorsOf(withFees([fee({ id: '' }), fee({ id: '' })]))).toEqual([
      'INPUT_INVALID@fees[0].id',
      'INPUT_INVALID@fees[1].id',
    ]);
    // Ids are compared exactly.
    expect(
      termsOf(withFees([fee({ id: 'a' }), fee({ id: 'A' }), fee({ id: 'a ' })])).fees,
    ).toHaveLength(3);
  });

  it('counts the id of an item whose other properties are invalid', () => {
    expect(errorsOf(withFees([fee({ id: 'a', kind: 'monthly' }), fee({ id: 'a' })]))).toEqual([
      'INPUT_INVALID@fees[0].kind',
      'INPUT_INVALID@fees[1].id',
    ]);
  });

  it('checks calc only when the kind is valid', () => {
    expect(errorsOf(withFees([fee({ kind: 'monthly', calc: 'whatever' })]))).toEqual([
      'INPUT_INVALID@fees[0].kind',
    ]);
    expect(errorsOf(withFees([fee({ kind: undefined, calc: undefined })]))).toEqual([
      'INPUT_INVALID@fees[0].kind',
    ]);
  });

  it.each([
    ['upfront', 'pct-original'],
    ['upfront', 'pct-balance'],
    ['upfront', 'percentage'],
    ['periodic', 'percent'],
    ['insurance', 'percent'],
    ['insurance', undefined],
  ])('rejects a %s item with calc %j', (kind, calc) => {
    expect(errorsOf(withFees([fee({ kind, calc })]))).toEqual(['INPUT_INVALID@fees[0].calc']);
  });

  it('validates the value: type, then range, then minor units', () => {
    expect(errorsOf(withFees([fee({ value: 1 })]))).toEqual(['INPUT_INVALID@fees[0].value']);
    expect(errorsOf(withFees([fee({ value: undefined })]))).toEqual([
      'INPUT_INVALID@fees[0].value',
    ]);
    expect(errorsOf(withFees([fee({ value: '1,5' })]))).toEqual(['INPUT_INVALID@fees[0].value']);
    expect(errorsOf(withFees([fee({ value: '-0.01' })]))).toEqual(['FEE_RANGE@fees[0].value']);
    expect(errorsOf(withFees([fee({ value: '-1.005' })]))).toEqual(['FEE_RANGE@fees[0].value']);
    expect(errorsOf(withFees([fee({ value: '1.005' })]))).toEqual([
      'TOO_MANY_DECIMALS@fees[0].value',
    ]);
    expect(errorsOf(withFees([fee({ calc: 'pct-original', value: '-1' })]))).toEqual([
      'FEE_RANGE@fees[0].value',
    ]);
  });

  it('checks the minor units of fixed amounts only', () => {
    const terms = termsOf(withFees([fee({ calc: 'pct-balance', value: '1.005' })]));
    expect(terms.fees[0]?.value).toEqual({ calc: 'pct-balance', pct: parseDecimal('1.005') });
    expect(errorsOf(withFees([fee({ value: '1.005' })], { currency: 'XTS' }))).toEqual([
      'CURRENCY_INVALID@currency',
    ]);
    expect(
      termsOf(withFees([fee({ value: '200' })], { currency: 'JPY', amount: '100000' })).fees[0]
        ?.value,
    ).toEqual({ calc: 'fixed', amount: 200n });
  });

  it.each([
    ['JPY', '100000', '0.5', '1', 1n],
    ['KWD', '1000.000', '0.0005', '0.250', 250n],
    ['CLF', '1000.0000', '0.00005', '0.0125', 125n],
  ])(
    'checks a fixed value against the minor units of %s',
    (currency, amount, tooPrecise, exact, minor) => {
      for (const kind of ['upfront', 'periodic', 'insurance']) {
        expect(
          errorsOf(withFees([fee({ kind, value: tooPrecise })], { currency, amount })),
        ).toEqual(['TOO_MANY_DECIMALS@fees[0].value']);
        expect(
          termsOf(withFees([fee({ kind, value: exact })], { currency, amount })).fees[0]?.value,
        ).toEqual({ calc: 'fixed', amount: minor });
      }
    },
  );

  it('checks the minor units of a fixed value even when the kind is invalid', () => {
    expect(errorsOf(withFees([fee({ kind: 'monthly', value: '1.005' })]))).toEqual([
      'INPUT_INVALID@fees[0].kind',
      'TOO_MANY_DECIMALS@fees[0].value',
    ]);
  });

  it('accepts a zero value, -0 included', () => {
    expect(termsOf(withFees([fee({ value: '0' })])).fees[0]?.value).toEqual({
      calc: 'fixed',
      amount: 0n,
    });
    expect(termsOf(withFees([fee({ calc: 'pct-original', value: '-0' })])).fees[0]?.value).toEqual({
      calc: 'pct-original',
      pct: rational(0n),
    });
  });

  it('validates financing on upfront items only', () => {
    expect(errorsOf(withFees([fee({ kind: 'upfront', financing: 'later' })]))).toEqual([
      'INPUT_INVALID@fees[0].financing',
    ]);
    expect(errorsOf(withFees([fee({ kind: 'upfront', financing: null })]))).toEqual([
      'INPUT_INVALID@fees[0].financing',
    ]);
    expect(
      termsOf(withFees([fee({ kind: 'periodic', financing: 'later' })])).fees[0]?.financing,
    ).toBe('paid');
    expect(
      termsOf(withFees([fee({ kind: 'insurance', financing: 'financed' })])).fees[0]?.financing,
    ).toBe('paid');
  });

  it('validates inApr', () => {
    expect(errorsOf(withFees([fee({ inApr: 'yes' })]))).toEqual(['INPUT_INVALID@fees[0].inApr']);
    expect(errorsOf(withFees([fee({ inApr: 1 })]))).toEqual(['INPUT_INVALID@fees[0].inApr']);
    expect(errorsOf(withFees([fee({ kind: 'monthly', inApr: null })]))).toEqual([
      'INPUT_INVALID@fees[0].inApr',
      'INPUT_INVALID@fees[0].kind',
    ]);
  });

  it('reports every failing property of an item', () => {
    expect(
      errorsOf(
        withFees([
          { id: '', kind: 'upfront', calc: 'pct-balance', value: '-1', financing: 'x', inApr: 'x' },
        ]),
      ),
    ).toEqual([
      'FEE_RANGE@fees[0].value',
      'INPUT_INVALID@fees[0].calc',
      'INPUT_INVALID@fees[0].financing',
      'INPUT_INVALID@fees[0].id',
      'INPUT_INVALID@fees[0].inApr',
    ]);
  });

  it('builds the validated items with defaults, in input order', () => {
    const terms = termsOf(
      withFees([
        { id: 'origination', kind: 'upfront', calc: 'percent', value: '1.5' },
        {
          id: 'broker',
          kind: 'upfront',
          calc: 'fixed',
          value: '25.00',
          financing: 'financed',
          inApr: false,
        },
        { id: 'service', kind: 'periodic', calc: 'fixed', value: '5.00', inApr: true },
        { id: 'commission', kind: 'periodic', calc: 'pct-original', value: '0.5' },
        { id: 'cover', kind: 'insurance', calc: 'pct-balance', value: '0.04', inApr: false },
        { id: 'gps', kind: 'insurance', calc: 'fixed', value: '3.10', unknown: 'ignored' },
      ]),
    );
    expect(terms.fees).toEqual([
      {
        id: 'origination',
        kind: 'upfront',
        value: { calc: 'percent', pct: rational(3n, 2n) },
        financing: 'paid',
        inApr: true,
      },
      {
        id: 'broker',
        kind: 'upfront',
        value: { calc: 'fixed', amount: 2500n },
        financing: 'financed',
        inApr: false,
      },
      {
        id: 'service',
        kind: 'periodic',
        value: { calc: 'fixed', amount: 500n },
        financing: 'paid',
        inApr: true,
      },
      {
        id: 'commission',
        kind: 'periodic',
        value: { calc: 'pct-original', pct: rational(1n, 2n) },
        financing: 'paid',
        inApr: true,
      },
      {
        id: 'cover',
        kind: 'insurance',
        value: { calc: 'pct-balance', pct: rational(1n, 25n) },
        financing: 'paid',
        inApr: false,
      },
      {
        id: 'gps',
        kind: 'insurance',
        value: { calc: 'fixed', amount: 310n },
        financing: 'paid',
        inApr: true,
      },
    ]);
  });

  it('accepts an empty list', () => {
    expect(termsOf(withFees([])).fees).toEqual([]);
  });
});

describe('validateLoanInput — rateMethods', () => {
  it.each(['xirr', {}, null, 1])(
    'rejects rateMethods that are not an array (%j)',
    (rateMethods) => {
      expect(errorsOf(input({ rateMethods }))).toEqual(['INPUT_INVALID@rateMethods']);
    },
  );

  it('reports every unknown element on its index', () => {
    // eslint-disable-next-line no-sparse-arrays -- a hole is an element too
    const rateMethods = ['nominal', 'apr', 5, , 'XIRR', 'xirr'];
    expect(errorsOf(input({ rateMethods }))).toEqual([
      'INPUT_INVALID@rateMethods[1]',
      'INPUT_INVALID@rateMethods[2]',
      'INPUT_INVALID@rateMethods[3]',
      'INPUT_INVALID@rateMethods[4]',
    ]);
  });

  it('keeps the input order and drops duplicates (first occurrence kept)', () => {
    expect(
      termsOf(input({ rateMethods: ['xirr', 'nominal', 'xirr', 'ukAprc', 'nominal'] })).rateMethods,
    ).toEqual(['xirr', 'nominal', 'ukAprc']);
  });

  it('accepts an empty list and every id', () => {
    expect(termsOf(input({ rateMethods: [] })).rateMethods).toEqual([]);
    expect(termsOf(input({ rateMethods: [...RATE_METHOD_IDS].reverse() })).rateMethods).toEqual(
      [...RATE_METHOD_IDS].reverse(),
    );
  });
});

// ---------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------

describe('validateLoanInput — phases (SPEC §13)', () => {
  it('reports all phase-1 errors together', () => {
    expect(
      errorsOf(
        input({
          amount: '-5.00',
          annualRatePct: '-25',
          term: { payments: 0 },
          disbursementDate: '2026-13-01',
          endOfMonth: 'yes',
          rounding: { fees: 'up' },
        }),
      ),
    ).toEqual([
      'AMOUNT_RANGE@amount',
      'DATE_INVALID@disbursementDate',
      'INPUT_INVALID@endOfMonth',
      'INPUT_INVALID@rounding.fees',
      'RATE_RANGE@annualRatePct',
      'TERM_RANGE@term.payments',
    ]);
  });

  it('runs phase 2 only after a clean phase 1', () => {
    // Each of these inputs would fail a phase-2 check as well.
    expect(errorsOf(input({ amount: 'abc', term: { years: 0, months: 0 } }))).toEqual([
      'INPUT_INVALID@amount',
    ]);
    expect(
      errorsOf(
        input({
          annualRatePct: '2000',
          repayment: 'balloon',
          balloon: { kind: 'amount', value: '5000.00' },
          disbursementDate: '9999-12-01',
        }),
      ),
    ).toEqual(['RATE_RANGE@annualRatePct']);
  });

  it('reports all phase-2 errors together', () => {
    expect(
      errorsOf(
        input({
          repayment: 'balloon',
          balloon: { kind: 'amount', value: '1000.00' },
          term: { years: 0, months: 0 },
          accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'exact' },
        }),
      ),
    ).toEqual([
      'BALLOON_RANGE@balloon.value',
      'TERM_TOO_SHORT@term',
      'UNSUPPORTED@accrual.paymentBasis',
    ]);
    expect(
      errorsOf(
        input({
          amount: '361.80',
          repayment: 'equal-principal',
          term: { payments: 360 },
          rounding: { principalRemainder: 'first' },
          disbursementDate: '9990-01-01',
        }),
      ),
    ).toEqual(['AMOUNT_TOO_SMALL_FOR_TERM@amount', 'DATE_INVALID@disbursementDate']);
  });

  it('does not report NEG_AMORTIZATION: that is the schedule (phase 3)', () => {
    expect(
      validateLoanInput(
        input({
          amount: '100000.00',
          annualRatePct: '30',
          term: { payments: 360 },
          accrual: { mode: 'daycount', method: 'act-360' },
        }),
      ).ok,
    ).toBe(true);
  });

  it('re-exports the cash-flow validator', () => {
    expect(validateCashFlowInput(null)).toEqual({
      ok: false,
      errors: [{ code: 'INPUT_INVALID', field: null }],
    });
  });
});

// ---------------------------------------------------------------------------------------
// Golden vectors (kind "loan"): validation alone, checked against the expected output
// ---------------------------------------------------------------------------------------

interface LoanVector {
  readonly id: string;
  readonly kind: string;
  readonly input: unknown;
  readonly expected: {
    readonly ok: boolean;
    readonly errors?: readonly { readonly code: string; readonly field: string | null }[];
    readonly warnings?: readonly { readonly code: string }[];
    readonly rows?: readonly unknown[];
  };
}

function isLoanVector(value: unknown): value is LoanVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'kind' in value &&
    value.kind === 'loan' &&
    'input' in value &&
    'expected' in value
  );
}

const LOAN_VECTORS: readonly LoanVector[] = Object.values(
  import.meta.glob<unknown>('../../tests/vectors/core/*.json', { eager: true, import: 'default' }),
)
  .filter(isLoanVector)
  .sort((a, b) => a.id.localeCompare(b.id));

const RATE_WARNINGS = new Set(['RATE_NEGATIVE', 'RATE_HIGH']);

describe('validateLoanInput — golden vectors', () => {
  it('finds the loan vectors', () => {
    expect(LOAN_VECTORS.length).toBeGreaterThanOrEqual(75);
  });

  const inputErrors = LOAN_VECTORS.filter(
    (vector) =>
      vector.expected.errors !== undefined &&
      !vector.expected.errors.some((error) => error.code === 'NEG_AMORTIZATION'),
  );
  it.each(inputErrors.map((vector) => [vector.id, vector] as const))(
    '%s: exactly the expected errors',
    (_id, vector) => {
      const expected = (vector.expected.errors ?? [])
        .map((error) => `${error.code}@${String(error.field)}`)
        .sort();
      expect(errorsOf(vector.input)).toEqual(expected);
    },
  );

  const accepted = LOAN_VECTORS.filter((vector) => !inputErrors.includes(vector));
  it.each(accepted.map((vector) => [vector.id, vector] as const))(
    '%s: valid, with the expected rate warnings',
    (_id, vector) => {
      const { terms, warnings } = validated(vector.input);
      const expectedRateWarnings = (vector.expected.warnings ?? [])
        .map((warning) => warning.code)
        .filter((code) => RATE_WARNINGS.has(code));
      expect(warnings.map((warning) => warning.code)).toEqual(expectedRateWarnings);
      // Without an early close the ledger has N rows.
      const rows = vector.expected.rows;
      const earlyClose = (vector.expected.warnings ?? []).some((w) => w.code === 'EARLY_CLOSE');
      if (rows !== undefined && !earlyClose) {
        expect(terms.payments).toBe(rows.length);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------

const ERROR_CODES = new Set([
  'INPUT_INVALID',
  'CURRENCY_INVALID',
  'AMOUNT_RANGE',
  'TOO_MANY_DECIMALS',
  'RATE_RANGE',
  'TERM_RANGE',
  'TERM_TOO_SHORT',
  'DATE_INVALID',
  'BALLOON_RANGE',
  'FEE_RANGE',
  'UNSUPPORTED',
  'AMOUNT_TOO_SMALL_FOR_TERM',
]);

/** A decimal string with `scale` decimals for the integer `units / 10^scale`. */
function decimalText(units: bigint, scale: number): string {
  return formatMinor(units, scale);
}

const validLoanInput = fc.record({
  currency: fc.constantFrom('USD', 'JPY', 'KWD', 'CLF', 'EUR'),
  units: fc.bigInt({ min: 1n, max: 10n ** 12n }),
  ratePct: fc.integer({ min: -2000, max: 100000 }),
  repayment: fc.constantFrom('annuity', 'equal-principal', 'bullet'),
  frequency: fc.constantFrom(...FREQUENCY_IDS),
  payments: fc.integer({ min: 1, max: 600 }),
  date: fc.record({
    y: fc.integer({ min: 1900, max: 2200 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  }),
  endOfMonth: fc.boolean(),
});

type ValidLoanSample = typeof validLoanInput extends fc.Arbitrary<infer T> ? T : never;

const DIGITS: Readonly<Record<string, number>> = { USD: 2, JPY: 0, KWD: 3, CLF: 4, EUR: 2 };

function toInput(sample: ValidLoanSample): Input {
  const digits = DIGITS[sample.currency] ?? 2;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    currency: sample.currency,
    amount: decimalText(sample.units, digits),
    annualRatePct: decimalText(BigInt(sample.ratePct), 2),
    repayment: sample.repayment,
    frequency: sample.frequency,
    term: { payments: sample.payments },
    disbursementDate: `${String(sample.date.y)}-${pad(sample.date.m)}-${pad(sample.date.d)}`,
    endOfMonth: sample.endOfMonth,
  };
}

describe('validateLoanInput — properties', () => {
  it('accepts random valid inputs and keeps their values exactly', () => {
    fc.assert(
      fc.property(validLoanInput, (sample) => {
        const result = validateLoanInput(toInput(sample));
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.terms.amount).toBe(sample.units);
          expect(result.terms.rate).toEqual(rational(BigInt(sample.ratePct), 10000n));
          expect(result.terms.payments).toBe(sample.payments);
          expect(result.terms.disbursementDate).toEqual(sample.date);
          expect(result.warnings.length).toBe(sample.ratePct < 0 || sample.ratePct > 10000 ? 1 : 0);
        }
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(validLoanInput, (sample) => {
        expect(validateLoanInput(toInput(sample))).toEqual(validateLoanInput(toInput(sample)));
      }),
    );
  });

  it('never throws, and reports known codes with at most one error per field', () => {
    const field = fc.oneof(fc.jsonValue(), fc.constant(undefined));
    const arbitraryInput = fc.oneof(
      fc.anything(),
      fc.record(
        {
          currency: fc.oneof(field, fc.constantFrom('USD', 'JPY', 'XAU')),
          amount: fc.oneof(field, fc.constantFrom('100.00', '0', '1.005')),
          annualRatePct: fc.oneof(field, fc.constantFrom('5', '-30', '0')),
          repayment: fc.oneof(field, fc.constantFrom('annuity', 'balloon', 'equal-principal')),
          balloon: fc.oneof(field, fc.record({ kind: field, value: field })),
          frequency: fc.oneof(field, fc.constantFrom(...FREQUENCY_IDS)),
          term: fc.oneof(
            field,
            fc.record(
              { payments: field, years: field, months: field, endDate: field },
              { requiredKeys: [] },
            ),
          ),
          disbursementDate: fc.oneof(field, fc.constantFrom('2026-01-31', '9999-12-31')),
          endOfMonth: field,
          accrual: fc.oneof(
            field,
            fc.record({
              mode: fc.oneof(field, fc.constantFrom('periodic', 'daycount')),
              method: field,
            }),
          ),
          rounding: fc.oneof(
            field,
            fc.record({ interest: field, payment: field }, { requiredKeys: [] }),
          ),
          fees: fc.oneof(
            field,
            fc.array(
              fc.oneof(
                field,
                fc.record(
                  {
                    id: field,
                    kind: fc.oneof(field, fc.constantFrom('upfront', 'periodic')),
                    calc: field,
                    value: field,
                  },
                  { requiredKeys: [] },
                ),
              ),
              { maxLength: 4 },
            ),
          ),
          rateMethods: fc.oneof(
            field,
            fc.array(fc.oneof(field, fc.constantFrom(...RATE_METHOD_IDS))),
          ),
        },
        { requiredKeys: [] },
      ),
    );
    fc.assert(
      fc.property(arbitraryInput, (value) => {
        const result = validateLoanInput(value);
        if (!result.ok) {
          expect(result.errors.length).toBeGreaterThan(0);
          for (const error of result.errors) {
            expect(ERROR_CODES.has(error.code)).toBe(true);
          }
          const fields = result.errors.map((error) => error.field);
          expect(new Set(fields).size).toBe(fields.length);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('reports a broken top-level field on exactly that field', () => {
    const fieldNames = [
      'currency',
      'amount',
      'annualRatePct',
      'repayment',
      'frequency',
      'term',
      'disbursementDate',
      'endOfMonth',
      'accrual',
      'rounding',
      'fees',
      'rateMethods',
    ];
    fc.assert(
      fc.property(validLoanInput, fc.constantFrom(...fieldNames), (sample, name) => {
        const broken = { ...toInput(sample), [name]: Symbol('broken') };
        const result = validateLoanInput(broken);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errors).toEqual([{ code: 'INPUT_INVALID', field: name }]);
        }
      }),
    );
  });
});
