// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineError, FeeInput } from '../../engine';
import {
  ADVANCED_FIELDS,
  type FeeDraft,
  type LoanForm,
  addFee,
  defaultForm,
  engineErrors,
  feeValueField,
  fieldErrors,
  fieldOfEngineError,
  form,
  headlineMethod,
  inputErrors,
  inputIdFor,
  loanInput,
  newFeeId,
  okResult,
  removeFee,
  resetForm,
  result,
  secondaryMethod,
  setInputInvalid,
  toLoanInput,
  todayIso,
  updateFee,
  updateForm,
} from './loan';

const TODAY = '2026-11-01';

/** A fee row with defaults for the fields a test does not care about. */
function fee(fields: Partial<FeeDraft> & Pick<FeeDraft, 'uid'>): FeeDraft {
  return {
    name: '',
    kind: 'upfront',
    calc: 'fixed',
    value: '0',
    financing: 'paid',
    inApr: true,
    ...fields,
  };
}

/** The fee row of the current form with this id; throws when there is none. */
function feeOf(uid: string): FeeDraft {
  const draft = form.value.fees.find((item) => item.uid === uid);
  if (draft === undefined) {
    throw new Error(`no fee ${uid}`);
  }
  return draft;
}

/** The first fee row of the current form; throws when there is none. */
function firstFee(): FeeDraft {
  const [draft] = form.value.fees;
  if (draft === undefined) {
    throw new Error('the form has no fees');
  }
  return draft;
}

/** The engine input of the design scenario with some fields changed. */
function inputOf(patch: Partial<LoanForm>): ReturnType<typeof toLoanInput> {
  return toLoanInput({ ...defaultForm(TODAY), ...patch });
}

beforeEach(() => {
  // resetForm() takes today's date at the UI boundary; pin it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 0));
  resetForm();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('todayIso', () => {
  it('writes the local date as YYYY-MM-DD with padded months and days', () => {
    expect(todayIso(new Date(2026, 2, 7))).toBe('2026-03-07');
    expect(todayIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('pads years below 1000 to four digits', () => {
    const early = new Date(2026, 0, 1);
    early.setFullYear(999, 0, 5);
    expect(todayIso(early)).toBe('0999-01-05');
    early.setFullYear(42, 6, 9);
    expect(todayIso(early)).toBe('0042-07-09');
  });

  it('defaults to now', () => {
    expect(todayIso()).toBe(TODAY);
  });
});

describe('newFeeId', () => {
  it('returns unique non-empty ids', () => {
    const ids = Array.from({ length: 50 }, () => newFeeId());
    expect(new Set(ids).size).toBe(50);
    expect(ids.every((id) => /^fee-\d+$/.test(id))).toBe(true);
  });
});

describe('defaultForm', () => {
  it('is the design scenario disbursed on the given day', () => {
    const value = defaultForm('2026-11-01');
    expect(value).toMatchObject({
      currency: 'USD',
      amount: '350000.00',
      annualRatePct: '6.875',
      termMode: 'years',
      termYears: '30',
      termMonths: '0',
      frequency: 'monthly',
      repayment: 'annuity',
      disbursementDate: '2026-11-01',
      endOfMonth: true,
      accrualMode: 'periodic',
      compounding: 'payment',
      headlineMethod: 'auto',
    });
    expect(value.fees).toEqual([
      {
        uid: value.fees[0]?.uid,
        name: '',
        kind: 'upfront',
        calc: 'percent',
        value: '1',
        financing: 'paid',
        inApr: true,
      },
    ]);
  });

  it('defaults to today and gives every call a new fee id', () => {
    expect(defaultForm().disbursementDate).toBe(TODAY);
    expect(defaultForm().fees[0]?.uid).not.toBe(defaultForm().fees[0]?.uid);
  });
});

describe('updateForm and resetForm', () => {
  it('replaces only the given fields', () => {
    updateForm({ amount: '1000.00', currency: 'EUR' });
    expect(form.value.amount).toBe('1000.00');
    expect(form.value.currency).toBe('EUR');
    expect(form.value.annualRatePct).toBe('6.875');
  });

  it('restores the opening scenario and clears typing errors', () => {
    updateForm({ amount: '1.00', repayment: 'bullet' });
    setInputInvalid('annualRatePct', true);
    resetForm();
    expect({ ...form.value, fees: [] }).toEqual({ ...defaultForm(TODAY), fees: [] });
    expect(inputErrors.value.size).toBe(0);
  });
});

describe('fee rows', () => {
  it('adds an upfront fixed fee with an empty value by default', () => {
    const uid = addFee();
    expect(form.value.fees).toHaveLength(2);
    expect(feeOf(uid)).toEqual(fee({ uid }));
  });

  it('adds a fee of the given kind', () => {
    const uid = addFee('insurance');
    expect(feeOf(uid).kind).toBe('insurance');
    expect(feeOf(uid).calc).toBe('fixed');
  });

  it('changes only the given fee', () => {
    const uid = addFee('periodic');
    const before = firstFee();
    updateFee(uid, { value: '12.50', name: 'Service' });
    expect(feeOf(uid)).toMatchObject({ value: '12.50', name: 'Service', kind: 'periodic' });
    expect(firstFee()).toBe(before);
  });

  it('maps a percentage between upfront and periodic kinds', () => {
    const uid = firstFee().uid;
    expect(firstFee().calc).toBe('percent');
    updateFee(uid, { kind: 'periodic' });
    expect(feeOf(uid).calc).toBe('pct-original');
    updateFee(uid, { kind: 'upfront' });
    expect(feeOf(uid).calc).toBe('percent');
    updateFee(uid, { kind: 'insurance', calc: 'pct-balance' });
    expect(feeOf(uid).calc).toBe('pct-balance');
    updateFee(uid, { kind: 'periodic' });
    expect(feeOf(uid).calc).toBe('pct-balance');
    updateFee(uid, { kind: 'upfront' });
    expect(feeOf(uid).calc).toBe('percent');
  });

  it('keeps a fixed calculation across kinds', () => {
    const uid = addFee('upfront');
    updateFee(uid, { kind: 'periodic' });
    expect(feeOf(uid).calc).toBe('fixed');
    updateFee(uid, { kind: 'upfront' });
    expect(feeOf(uid).calc).toBe('fixed');
  });

  it('takes an explicit calculation with the kind as given', () => {
    const uid = firstFee().uid;
    updateFee(uid, { kind: 'periodic', calc: 'fixed' });
    expect(feeOf(uid)).toMatchObject({ kind: 'periodic', calc: 'fixed' });
  });

  it('changes nothing for an unknown fee id', () => {
    const before = form.value.fees;
    updateFee('missing', { value: '9' });
    expect(form.value.fees).toEqual(before);
  });

  it('removes a fee and its typing error', () => {
    const uid = addFee();
    setInputInvalid(feeValueField(uid), true);
    setInputInvalid('amount', true);
    removeFee(uid);
    expect(form.value.fees.map((item) => item.uid)).not.toContain(uid);
    expect([...inputErrors.value]).toEqual(['amount']);
  });
});

describe('field paths and input ids', () => {
  it.each([
    ['amount', 'field-amount'],
    ['annualRatePct', 'field-annualRatePct'],
    ['term.years', 'field-term-years'],
    ['term.endDate', 'field-term-endDate'],
    ['balloon.value', 'field-balloon-value'],
    ['accrual.paymentBasis', 'field-accrual-paymentBasis'],
    ['fees', 'field-fees'],
    ['fees[2].value', 'field-fees-2-value'],
    ['fee:fee-3.value', 'fee-fee-3-value'],
    [feeValueField('fee-12'), 'fee-fee-12-value'],
  ])('%s → #%s', (field, id) => {
    expect(inputIdFor(field)).toBe(id);
  });

  it('writes fee value fields by row id', () => {
    expect(feeValueField('fee-7')).toBe('fee:fee-7.value');
  });

  it('lists the advanced fields', () => {
    expect(ADVANCED_FIELDS.has('accrual.mode')).toBe(true);
    expect(ADVANCED_FIELDS.has('rateMethods')).toBe(true);
    expect(ADVANCED_FIELDS.has('amount')).toBe(false);
  });
});

describe('fieldOfEngineError', () => {
  const error = (field: string | null): EngineError => ({ code: 'FEE_RANGE', field });

  it('maps fee paths to the fee row value field', () => {
    const uid = firstFee().uid;
    expect(fieldOfEngineError(error('fees[0].value'))).toBe(feeValueField(uid));
    expect(fieldOfEngineError(error('fees[0].kind'))).toBe(feeValueField(uid));
    expect(fieldOfEngineError(error('fees[0]'))).toBe(feeValueField(uid));
  });

  it('maps a fee beyond the list to the fees section', () => {
    expect(fieldOfEngineError(error('fees[9].value'))).toBe('fees');
  });

  it('uses the given fee list', () => {
    const fees = [fee({ uid: 'a' }), fee({ uid: 'b' })];
    expect(fieldOfEngineError(error('fees[1].value'), fees)).toBe('fee:b.value');
  });

  it('keeps other paths and has no field for null', () => {
    expect(fieldOfEngineError(error('amount'))).toBe('amount');
    expect(fieldOfEngineError(error('fees'))).toBe('fees');
    expect(fieldOfEngineError(error('term'))).toBe('term');
    expect(fieldOfEngineError(error(null))).toBeNull();
  });
});

describe('setInputInvalid', () => {
  it('adds and removes a field', () => {
    setInputInvalid('amount', true);
    expect(inputErrors.value.has('amount')).toBe(true);
    setInputInvalid('amount', false);
    expect(inputErrors.value.has('amount')).toBe(false);
  });

  it('keeps the same set when nothing changes', () => {
    const empty = inputErrors.value;
    setInputInvalid('amount', false);
    expect(inputErrors.value).toBe(empty);
    setInputInvalid('amount', true);
    const marked = inputErrors.value;
    setInputInvalid('amount', true);
    expect(inputErrors.value).toBe(marked);
  });
});

describe('toLoanInput', () => {
  it('builds the design scenario input', () => {
    const uid = 'fee-x';
    expect(
      toLoanInput({ ...defaultForm(TODAY), fees: [fee({ uid, calc: 'percent', value: '1' })] }),
    ).toEqual({
      currency: 'USD',
      amount: '350000.00',
      annualRatePct: '6.875',
      repayment: 'annuity',
      frequency: 'monthly',
      term: { years: 30, months: 0 },
      disbursementDate: TODAY,
      endOfMonth: true,
      accrual: { mode: 'periodic' },
      rounding: {
        interest: 'half-up',
        fees: 'half-up',
        payment: 'minor-half-up',
        principalRemainder: 'last',
      },
      fees: [
        { id: uid, kind: 'upfront', calc: 'percent', value: '1', financing: 'paid', inApr: true },
      ],
    });
  });

  it('writes the term the way it is entered', () => {
    expect(inputOf({ termYears: '2', termMonths: '6' }).term).toEqual({ years: 2, months: 6 });
    expect(inputOf({ termMode: 'payments', termPayments: '120' }).term).toEqual({
      payments: 120,
    });
    expect(inputOf({ termMode: 'endDate', termEndDate: '2036-11-01' }).term).toEqual({
      endDate: '2036-11-01',
    });
  });

  it('sends the balloon only for a balloon loan', () => {
    expect('balloon' in inputOf({ repayment: 'annuity', balloonValue: '30' })).toBe(false);
    expect(
      inputOf({ repayment: 'balloon', balloonKind: 'amount', balloonValue: '50000.00' }).balloon,
    ).toEqual({ kind: 'amount', value: '50000.00' });
    expect(inputOf({ repayment: 'balloon' }).balloon).toEqual({ kind: 'percent', value: '30' });
  });

  it('writes the interest model', () => {
    expect(inputOf({ compounding: 'payment' }).accrual).toEqual({ mode: 'periodic' });
    expect(inputOf({ compounding: 'semiannual' }).accrual).toEqual({
      mode: 'periodic',
      compounding: 'semiannual',
    });
    expect(inputOf({ compounding: 'continuous' }).accrual).toEqual({
      mode: 'periodic',
      compounding: 'continuous',
    });
    expect(
      inputOf({
        accrualMode: 'daycount',
        dayCount: 'act-360',
        paymentBasis: 'exact',
        compounding: 'annual',
      }).accrual,
    ).toEqual({ mode: 'daycount', method: 'act-360', paymentBasis: 'exact' });
  });

  it('writes the rounding options', () => {
    expect(
      inputOf({
        roundingInterest: 'half-even',
        roundingFees: 'floor',
        roundingPayment: 'unit-ceil',
        principalRemainder: 'first',
      }).rounding,
    ).toEqual({
      interest: 'half-even',
      fees: 'floor',
      payment: 'unit-ceil',
      principalRemainder: 'first',
    });
  });

  it('maps fee rows to engine fees', () => {
    const fees: FeeInput[] = inputOf({
      fees: [
        fee({ uid: 'u1', calc: 'percent', value: '1.5', financing: 'financed', inApr: false }),
        fee({ uid: 'u2', calc: 'fixed', value: '500.00' }),
        // A stale periodic calculation on an upfront row is still a percentage.
        fee({ uid: 'u3', calc: 'pct-original', value: '2' }),
        fee({ uid: 'p1', kind: 'periodic', calc: 'percent', value: '0.1', financing: 'financed' }),
        fee({ uid: 'p2', kind: 'periodic', calc: 'pct-balance', value: '0.05' }),
        fee({ uid: 'i1', kind: 'insurance', calc: 'fixed', value: '25.00', inApr: false }),
      ],
    }).fees as FeeInput[];
    expect(fees).toEqual([
      {
        id: 'u1',
        kind: 'upfront',
        calc: 'percent',
        value: '1.5',
        financing: 'financed',
        inApr: false,
      },
      { id: 'u2', kind: 'upfront', calc: 'fixed', value: '500.00', financing: 'paid', inApr: true },
      { id: 'u3', kind: 'upfront', calc: 'percent', value: '2', financing: 'paid', inApr: true },
      { id: 'p1', kind: 'periodic', calc: 'pct-original', value: '0.1', inApr: true },
      { id: 'p2', kind: 'periodic', calc: 'pct-balance', value: '0.05', inApr: true },
      { id: 'i1', kind: 'insurance', calc: 'fixed', value: '25.00', inApr: false },
    ]);
  });

  it('is what loanInput holds for the current form', () => {
    updateForm({ amount: '1000.00' });
    expect(loanInput.value).toEqual(toLoanInput(form.value));
  });
});

describe('result', () => {
  it('calculates the design scenario', () => {
    expect(okResult.value?.summary.regularInstalment).toBe('2299.25');
    expect(okResult.value?.summary.lastPayment).toBe('2300.28');
    expect(okResult.value?.rates.usRegZApr).toMatchObject({ display: '6.974' });
    expect(engineErrors.value).toEqual([]);
    expect(fieldErrors.value.size).toBe(0);
  });

  it('is blank while a field does not parse, and recomputes after', () => {
    setInputInvalid('annualRatePct', true);
    expect(result.value).toBeNull();
    expect(okResult.value).toBeNull();
    expect(engineErrors.value).toEqual([]);
    setInputInvalid('annualRatePct', false);
    expect(okResult.value?.summary.regularInstalment).toBe('2299.25');
  });

  it('follows every change of the form', () => {
    updateForm({ amount: '175000.00' });
    expect(okResult.value?.summary.amount).toBe('175000.00');
  });

  it('reports engine errors and no ok result', () => {
    updateForm({ amount: '0' });
    expect(okResult.value).toBeNull();
    expect(engineErrors.value).toEqual([{ code: 'AMOUNT_RANGE', field: 'amount' }]);
    expect(fieldErrors.value.get('amount')).toEqual({ code: 'AMOUNT_RANGE', field: 'amount' });
  });
});

describe('fieldErrors', () => {
  it('shows typing errors as INPUT_INVALID on their field', () => {
    setInputInvalid('term.years', true);
    expect(fieldErrors.value.get('term.years')).toEqual({
      code: 'INPUT_INVALID',
      field: 'term.years',
    });
  });

  it('maps engine fee errors to the fee row and keeps the first error of a field', () => {
    const uid = firstFee().uid;
    updateFee(uid, {
      kind: 'bogus' as unknown as FeeDraft['kind'],
      calc: 'fixed',
      value: '-1',
    });
    expect(engineErrors.value.map((error) => error.field)).toEqual([
      'fees[0].kind',
      'fees[0].value',
    ]);
    expect([...fieldErrors.value]).toEqual([
      [feeValueField(uid), { code: 'INPUT_INVALID', field: 'fees[0].kind' }],
    ]);
  });

  it('puts the section error of fees on `fees`', () => {
    updateFee(firstFee().uid, { value: '100' });
    expect(fieldErrors.value.get('fees')?.code).toBe('FEE_RANGE');
  });

  it('leaves out errors that belong to no field', () => {
    updateForm({ amount: '10.00', annualRatePct: '6', roundingPayment: 'unit-half-up' });
    expect(engineErrors.value).toEqual([
      { code: 'NEG_AMORTIZATION', field: null, params: { period: '1' } },
    ]);
    expect(fieldErrors.value.size).toBe(0);
  });
});

describe('headline and secondary methods', () => {
  it('follow the currency while automatic', () => {
    expect(headlineMethod.value).toBe('usRegZApr');
    expect(secondaryMethod.value).toBe('effective');
    updateForm({ currency: 'GBP' });
    expect(headlineMethod.value).toBe('ukAprc');
    updateForm({ currency: 'CNY' });
    expect(headlineMethod.value).toBe('cnAnnualized');
    expect(secondaryMethod.value).toBe('irrEffective');
  });

  it('take the method chosen in Advanced', () => {
    updateForm({ currency: 'CNY', headlineMethod: 'xirr' });
    expect(headlineMethod.value).toBe('xirr');
    expect(secondaryMethod.value).toBe('effective');
  });
});
