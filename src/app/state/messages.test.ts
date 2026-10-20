// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_COUNT_IDS,
  type EngineError,
  type ErrorCode,
  RATE_METHOD_IDS,
  type RepaymentType,
  type RoundingMode,
} from '../../engine';
import { formatDate, formatNumber, formatPercent } from '../../i18n';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import { setLanguage } from './i18n';
import {
  type FeeDraft,
  type LoanForm,
  defaultForm,
  feeValueField,
  form,
  resetForm,
  updateFee,
  updateForm,
} from './loan';
import {
  automaticMethod,
  dayCountName,
  defaultFeeName,
  fieldErrorMessage,
  fieldKind,
  fieldLabel,
  frequencyName,
  methodName,
  methodShortName,
  negativeAmortizationFix,
  negativeAmortizationMessage,
  paymentLabel,
  rateFailureReason,
  repaymentName,
  roundingModeName,
  sourceName,
  warningMessage,
} from './messages';

type CatalogKey = keyof typeof en;

/** A catalog template with its placeholders filled in. */
function fill(template: string, params: Readonly<Record<string, string>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] ?? placeholder);
}

/** An English message by key, filled in. */
function english(key: CatalogKey, params?: Readonly<Record<string, string>>): string {
  return fill(en[key], params);
}

/** A Russian message by key, filled in (compared with the catalog, not a literal). */
function russian(key: CatalogKey, params?: Readonly<Record<string, string>>): string {
  return fill(ru[key], params);
}

function error(code: ErrorCode, field: string | null = null): EngineError {
  return { code, field };
}

const BASE: LoanForm = {
  ...defaultForm('2026-11-01'),
  fees: [
    {
      uid: 'fixed',
      name: '',
      kind: 'upfront',
      calc: 'fixed',
      value: '500',
      financing: 'paid',
      inApr: true,
    },
    {
      uid: 'pct',
      name: '',
      kind: 'periodic',
      calc: 'pct-balance',
      value: '0.1',
      financing: 'paid',
      inApr: true,
    },
  ] satisfies FeeDraft[],
};

beforeEach(() => {
  resetForm();
  setLanguage('en');
});

describe('names of ids', () => {
  it('names every rate method and its short form', () => {
    for (const method of RATE_METHOD_IDS) {
      expect(methodName(method)).toBe(en[`rateMethod.${method}`]);
      expect(methodShortName(method)).toBe(en[`rateShort.${method}`]);
    }
    expect(methodName('usRegZApr')).toBe('APR');
  });

  it('names sources, frequencies and payment labels', () => {
    expect(sourceName('regZ')).toBe('Reg Z · US');
    expect(sourceName('nbu')).toBe(en['rateSource.nbu']);
    expect(frequencyName('biweekly')).toBe('Bi-weekly');
    expect(paymentLabel('monthly')).toBe('Monthly payment');
    expect(paymentLabel('annual')).toBe(en['payment.annual']);
  });

  it.each([
    ['annuity', 'Equal payments'],
    ['equal-principal', 'Equal principal'],
    ['bullet', 'Interest-only'],
    ['balloon', 'Balloon'],
  ] as [RepaymentType, string][])('names the repayment %s', (repayment, name) => {
    expect(repaymentName(repayment)).toBe(name);
  });

  it('names every day count and rounding mode', () => {
    const dayCounts = DAY_COUNT_IDS.map(dayCountName);
    expect(new Set(dayCounts).size).toBe(DAY_COUNT_IDS.length);
    expect(dayCountName('act-365f')).toBe('ACT/365F (actual days ÷ 365)');
    expect(dayCountName('30u-360')).toBe(en['dayCount.thirty360Us']);
    const modes: [RoundingMode, string][] = [
      ['half-up', 'Half up'],
      ['half-even', 'Half to even'],
      ['ceil', 'Up'],
      ['floor', 'Down'],
    ];
    for (const [mode, name] of modes) {
      expect(roundingModeName(mode)).toBe(name);
    }
  });

  it('names fee rows by kind', () => {
    expect(defaultFeeName('upfront')).toBe('Origination fee');
    expect(defaultFeeName('periodic')).toBe('Periodic fee');
    expect(defaultFeeName('insurance')).toBe('Insurance');
  });

  it('gives the automatic headline method of a form', () => {
    expect(automaticMethod()).toBe('usRegZApr');
    expect(automaticMethod({ ...BASE, currency: 'UAH' })).toBe('uaRealAnnual');
    updateForm({ currency: 'GBP', headlineMethod: 'xirr' });
    expect(automaticMethod()).toBe('ukAprc');
  });
});

describe('fieldKind', () => {
  it.each([
    ['amount', 'money'],
    ['annualRatePct', 'percent'],
    ['term.years', 'integer'],
    ['term.months', 'integer'],
    ['term.payments', 'integer'],
    ['fee:fixed.value', 'money'],
    ['fee:pct.value', 'percent'],
    ['fee:missing.value', 'money'],
    ['fees', 'money'],
  ] as const)('%s holds %s', (field, kind) => {
    expect(fieldKind(field, BASE)).toBe(kind);
  });

  it('follows the balloon kind', () => {
    expect(fieldKind('balloon.value', { ...BASE, balloonKind: 'percent' })).toBe('percent');
    expect(fieldKind('balloon.value', { ...BASE, balloonKind: 'amount' })).toBe('money');
  });

  it('reads the current form by default (its 1 % upfront fee)', () => {
    const uid = form.value.fees[0]?.uid ?? 'missing';
    expect(fieldKind(`fee:${uid}.value`)).toBe('percent');
  });
});

describe('fieldErrorMessage: INPUT_INVALID', () => {
  it.each([
    ['amount', english('errors.inputInvalidMoney', { example: '350,000.50' })],
    ['fee:fixed.value', english('errors.inputInvalidMoney', { example: '350,000.50' })],
    ['annualRatePct', english('errors.inputInvalidPercent', { example: '6.875' })],
    ['fee:pct.value', english('errors.inputInvalidPercent', { example: '6.875' })],
    ['term.years', 'Enter a whole number.'],
    ['term.payments', 'Enter a whole number.'],
    ['disbursementDate', 'Enter a date.'],
    ['term.endDate', 'Enter a date.'],
  ])('on %s', (field, message) => {
    expect(fieldErrorMessage(field, error('INPUT_INVALID', field), BASE)).toBe(message);
  });

  it('uses the example of the UI language', () => {
    setLanguage('ru');
    expect(fieldErrorMessage('amount', error('INPUT_INVALID', 'amount'), BASE)).toBe(
      russian('errors.inputInvalidMoney', {
        example: formatNumber('350000.50', 'ru-RU', { minimumFractionDigits: 2 }),
      }),
    );
    expect(fieldErrorMessage('annualRatePct', error('INPUT_INVALID'), BASE)).toBe(
      russian('errors.inputInvalidPercent', { example: formatNumber('6.875', 'ru-RU') }),
    );
    expect(fieldErrorMessage('term.years', error('INPUT_INVALID'), BASE)).toBe(
      ru['errors.inputInvalidInteger'],
    );
  });

  it('reads the current form by default', () => {
    expect(fieldErrorMessage('amount', error('INPUT_INVALID', 'amount'))).toBe(
      'Enter an amount such as 350,000.50.',
    );
  });
});

describe('fieldErrorMessage: the other SPEC §13 codes', () => {
  it('CURRENCY_INVALID', () => {
    expect(fieldErrorMessage('currency', error('CURRENCY_INVALID', 'currency'), BASE)).toBe(
      'Choose a currency from the list.',
    );
  });

  it('AMOUNT_RANGE quotes the limit', () => {
    expect(fieldErrorMessage('amount', error('AMOUNT_RANGE', 'amount'), BASE)).toBe(
      'Enter an amount above zero, up to 1,000,000,000,000,000.',
    );
  });

  describe('TOO_MANY_DECIMALS', () => {
    it('on money: the currency minor units', () => {
      expect(fieldErrorMessage('amount', error('TOO_MANY_DECIMALS', 'amount'), BASE)).toBe(
        'Use at most 2 decimal places: USD has no smaller unit.',
      );
      expect(
        fieldErrorMessage('fee:fixed.value', error('TOO_MANY_DECIMALS'), {
          ...BASE,
          currency: 'KWD',
        }),
      ).toBe('Use at most 3 decimal places: KWD has no smaller unit.');
    });

    it('on money in a currency without minor units: whole amounts', () => {
      expect(
        fieldErrorMessage('amount', error('TOO_MANY_DECIMALS'), { ...BASE, currency: 'JPY' }),
      ).toBe('JPY has no minor units: enter a whole amount.');
    });

    it('on a percentage field, fee or balloon: 10 decimals', () => {
      const message = 'Use at most 10 decimal places.';
      expect(fieldErrorMessage('annualRatePct', error('TOO_MANY_DECIMALS'), BASE)).toBe(message);
      expect(fieldErrorMessage('fee:pct.value', error('TOO_MANY_DECIMALS'), BASE)).toBe(message);
      expect(
        fieldErrorMessage('balloon.value', error('TOO_MANY_DECIMALS'), {
          ...BASE,
          balloonKind: 'percent',
        }),
      ).toBe(message);
      expect(
        fieldErrorMessage('balloon.value', error('TOO_MANY_DECIMALS'), {
          ...BASE,
          balloonKind: 'amount',
        }),
      ).toBe('Use at most 2 decimal places: USD has no smaller unit.');
    });
  });

  it('RATE_RANGE formats both limits as percentages', () => {
    expect(fieldErrorMessage('annualRatePct', error('RATE_RANGE'), BASE)).toBe(
      'Enter a rate from -20% to 1,000%.',
    );
    setLanguage('ru');
    expect(fieldErrorMessage('annualRatePct', error('RATE_RANGE'), BASE)).toBe(
      russian('errors.rateRange', {
        min: formatPercent('-0.20', 0, 'ru-RU'),
        max: formatPercent('10.00', 0, 'ru-RU'),
      }),
    );
  });

  it.each([
    ['term.years', 'Enter 0 to 100 years.'],
    ['term.months', 'Enter 0 to 11 months.'],
    ['term.payments', 'Enter 1 to 1,200 payments.'],
    ['term', 'The term gives more than 1,200 payments.'],
  ])('TERM_RANGE on %s', (field, message) => {
    expect(fieldErrorMessage(field, error('TERM_RANGE', field), BASE)).toBe(message);
  });

  it('TERM_TOO_SHORT', () => {
    expect(fieldErrorMessage('term', error('TERM_TOO_SHORT', 'term'), BASE)).toBe(
      'The term is shorter than one payment period.',
    );
  });

  it('DATE_INVALID on the disbursement date quotes the last date, on the end date not', () => {
    expect(fieldErrorMessage('disbursementDate', error('DATE_INVALID'), BASE)).toBe(
      'Enter a valid date. The last payment must fall by Dec 31, 9999.',
    );
    expect(fieldErrorMessage('term.endDate', error('DATE_INVALID'), BASE)).toBe(
      'Enter a valid end date.',
    );
    setLanguage('ru');
    expect(fieldErrorMessage('disbursementDate', error('DATE_INVALID'), BASE)).toBe(
      russian('errors.dateInvalid', { max: formatDate({ y: 9999, m: 12, d: 31 }, 'ru-RU') }),
    );
  });

  it('BALLOON_RANGE', () => {
    expect(fieldErrorMessage('balloon.value', error('BALLOON_RANGE'), BASE)).toBe(
      en['errors.balloonRange'],
    );
  });

  it('FEE_RANGE on the fees section, a fixed fee and a percentage fee', () => {
    expect(fieldErrorMessage('fees', error('FEE_RANGE', 'fees'), BASE)).toBe(
      en['errors.feeRangeTotal'],
    );
    expect(fieldErrorMessage('fee:fixed.value', error('FEE_RANGE'), BASE)).toBe(
      'Enter a fee from 0 to 1,000,000,000,000,000.',
    );
    expect(fieldErrorMessage('fee:pct.value', error('FEE_RANGE'), BASE)).toBe(
      'Enter a percentage from 0 to 100%.',
    );
  });

  it('UNSUPPORTED and AMOUNT_TOO_SMALL_FOR_TERM', () => {
    expect(fieldErrorMessage('accrual.paymentBasis', error('UNSUPPORTED'), BASE)).toBe(
      en['errors.unsupportedBasis'],
    );
    expect(fieldErrorMessage('amount', error('AMOUNT_TOO_SMALL_FOR_TERM'), BASE)).toBe(
      en['errors.amountTooSmall'],
    );
  });

  it('NEG_AMORTIZATION names the period', () => {
    const negative: EngineError = {
      code: 'NEG_AMORTIZATION',
      field: null,
      params: { period: '242' },
    };
    expect(fieldErrorMessage('amount', negative, BASE)).toBe(
      english('errors.negAmortization', { period: '242' }),
    );
    expect(negativeAmortizationMessage({ ...negative, params: { period: '1199' } })).toContain(
      '1,199',
    );
    expect(negativeAmortizationMessage(error('NEG_AMORTIZATION'))).toBe(
      english('errors.negAmortization', { period: '?' }),
    );
    setLanguage('ru');
    expect(negativeAmortizationMessage(negative)).toBe(
      russian('errors.negAmortization', { period: '242' }),
    );
  });

  it('has an English message for every code', () => {
    const codes: ErrorCode[] = [
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
      'NEG_AMORTIZATION',
    ];
    for (const code of codes) {
      const message = fieldErrorMessage('amount', error(code), BASE);
      expect(message).not.toMatch(/^errors\.|\{\w+\}/);
    }
  });
});

describe('negativeAmortizationFix', () => {
  it('suggests the exact payment basis for a day-count annuity', () => {
    expect(negativeAmortizationFix({ ...BASE, accrualMode: 'daycount' })).toEqual({
      field: 'accrual.paymentBasis',
      message: en['errors.negAmortizationFixExact'],
    });
  });

  it('suggests the periodic model for a day-count balloon', () => {
    expect(
      negativeAmortizationFix({ ...BASE, accrualMode: 'daycount', repayment: 'balloon' }),
    ).toEqual({ field: 'accrual.mode', message: en['errors.negAmortizationFixPeriodic'] });
  });

  it('suggests a finer payment rounding in the periodic model', () => {
    expect(negativeAmortizationFix()).toEqual({
      field: 'rounding.payment',
      message: en['errors.negAmortizationFixRounding'],
    });
    setLanguage('ru');
    expect(negativeAmortizationFix(BASE).message).toBe(ru['errors.negAmortizationFixRounding']);
  });
});

describe('warningMessage', () => {
  it('RATE_NEGATIVE shows the rate as entered', () => {
    expect(warningMessage({ code: 'RATE_NEGATIVE', params: { annualRatePct: '-0.50' } })).toBe(
      english('warnings.rateNegative', { rate: '-0.50%' }),
    );
  });

  it('RATE_HIGH keeps the decimals as entered', () => {
    expect(warningMessage({ code: 'RATE_HIGH', params: { annualRatePct: '150.250' } })).toBe(
      english('warnings.rateHigh', { rate: '150.250%' }),
    );
    expect(warningMessage({ code: 'RATE_HIGH', params: { annualRatePct: '1000' } })).toBe(
      english('warnings.rateHigh', { rate: '1,000%' }),
    );
    expect(warningMessage({ code: 'RATE_HIGH' })).toBe(
      english('warnings.rateHigh', { rate: '0%' }),
    );
  });

  it('EARLY_CLOSE formats both counts', () => {
    expect(
      warningMessage({ code: 'EARLY_CLOSE', params: { paymentsCount: '1199', scheduled: '1200' } }),
    ).toBe(english('warnings.earlyClose', { paymentsCount: '1,199', scheduled: '1,200' }));
    expect(warningMessage({ code: 'EARLY_CLOSE' })).toBe(
      english('warnings.earlyClose', { paymentsCount: '0', scheduled: '0' }),
    );
  });

  it('IRR_MULTIPLE lists the localized method names', () => {
    expect(warningMessage({ code: 'IRR_MULTIPLE', params: { methods: 'xirr,ukAprc' } })).toBe(
      english('warnings.irrMultiple', { methods: 'XIRR and APR' }),
    );
    expect(
      warningMessage({ code: 'IRR_MULTIPLE', params: { methods: 'xirr,euAprc,irrNominal' } }),
    ).toBe(
      english('warnings.irrMultiple', {
        methods: `XIRR, APRC, and ${en['rateMethod.irrNominal']}`,
      }),
    );
    expect(warningMessage({ code: 'IRR_MULTIPLE' })).toBe(
      english('warnings.irrMultiple', { methods: '' }),
    );
  });

  it('follows the UI language', () => {
    setLanguage('ru');
    expect(warningMessage({ code: 'IRR_MULTIPLE', params: { methods: 'xirr,ukAprc' } })).toBe(
      russian('warnings.irrMultiple', {
        methods: new Intl.ListFormat('ru-RU', { type: 'conjunction' }).format([
          ru['rateMethod.xirr'],
          ru['rateMethod.ukAprc'],
        ]),
      }),
    );
    expect(warningMessage({ code: 'RATE_NEGATIVE', params: { annualRatePct: '-1.5' } })).toBe(
      russian('warnings.rateNegative', { rate: formatPercent('-0.015', 1, 'ru-RU') }),
    );
    expect(
      warningMessage({ code: 'EARLY_CLOSE', params: { paymentsCount: '1199', scheduled: '1200' } }),
    ).toBe(
      russian('warnings.earlyClose', {
        paymentsCount: formatNumber('1199', 'ru-RU'),
        scheduled: formatNumber('1200', 'ru-RU'),
      }),
    );
  });
});

describe('rateFailureReason', () => {
  it('quotes the solver range (SPEC §10)', () => {
    expect(rateFailureReason()).toBe(
      english('rates.noConvergence', { min: '-99%', max: '1,000,000,000%' }),
    );
    setLanguage('ru');
    expect(rateFailureReason()).toBe(
      russian('rates.noConvergence', {
        min: formatPercent('-0.99', 0, 'ru-RU'),
        max: formatPercent('10000000', 0, 'ru-RU'),
      }),
    );
  });
});

describe('fieldLabel', () => {
  it('names the input of a field path', () => {
    expect(fieldLabel('amount')).toBe('Loan amount');
    expect(fieldLabel('term.years')).toBe('Years');
    expect(fieldLabel('rounding.payment')).toBe('Payment');
    expect(fieldLabel('fees')).toBe('Fees & insurance');
    // Paths the UI never reports keep their own name rather than a wrong label.
    expect(fieldLabel('flows[0].date')).toBe('flows[0].date');
  });

  it('names a fee value after its row', () => {
    resetForm();
    const uid = form.value.fees[0]?.uid ?? '';
    expect(fieldLabel(feeValueField(uid))).toBe('Origination fee');
    updateFee(uid, { name: '  Broker fee ' });
    expect(fieldLabel(feeValueField(uid))).toBe('Broker fee');
    expect(fieldLabel(feeValueField('missing'))).toBe('Fees & insurance');
  });
});
