// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENCY_CODES } from '../../engine';
import { setLanguage } from '../state/i18n';
import { defaultForm, type FeeDraft, type LoanForm, okResult, resetForm } from '../state/loan';
import {
  COMMON_CURRENCIES,
  currencyOptionLabel,
  feeCalcOf,
  feeSummary,
  hasCustomSettings,
  headlineOptionLabel,
  isMonthEnd,
  moreStatus,
  type OkResult,
  OTHER_CURRENCIES,
  paymentRoundingUnit,
  scheduledPayments,
  termModePatch,
} from './view';

beforeEach(() => {
  localStorage.clear();
  resetForm();
  setLanguage('en');
});

/** The result of the design scenario disbursed on 2026-11-01. */
function designResult(): OkResult {
  resetForm();
  const result = okResult.value;
  if (result === null) {
    throw new Error('the design scenario has no result');
  }
  return result;
}

/** A result whose schedule closed early: 300 payments of 360 scheduled. */
function earlyClose(result: OkResult): OkResult {
  return {
    ...result,
    warnings: [{ code: 'EARLY_CLOSE', params: { paymentsCount: '300', scheduled: '360' } }],
    summary: { ...result.summary, paymentsCount: 300 },
  };
}

const FORM: LoanForm = defaultForm('2026-11-01');

describe('currencies', () => {
  it('lists every code of the engine once, the common ones first', () => {
    expect([...COMMON_CURRENCIES, ...OTHER_CURRENCIES].sort()).toEqual([...CURRENCY_CODES]);
    expect(OTHER_CURRENCIES).toEqual([...OTHER_CURRENCIES].sort());
  });
});

describe('currencyOptionLabel', () => {
  it('is the code and the name when there is a name', () => {
    expect(currencyOptionLabel('USD', () => 'US dollar')).toBe('USD · US dollar');
    expect(currencyOptionLabel('USD')).toBe('USD · US Dollar');
  });

  it('is the code alone when the name is missing or is the code itself', () => {
    expect(currencyOptionLabel('CLF', () => undefined)).toBe('CLF');
    expect(currencyOptionLabel('CLF', () => '')).toBe('CLF');
    expect(currencyOptionLabel('ZWG', () => 'ZWG')).toBe('ZWG');
  });
});

describe('scheduledPayments', () => {
  it('is the scheduled N, also after an early close, and null without a result', () => {
    const result = designResult();
    expect(scheduledPayments(result)).toBe(360);
    expect(scheduledPayments(earlyClose(result))).toBe(360);
    expect(scheduledPayments(null)).toBeNull();
  });
});

describe('termModePatch', () => {
  it('keeps the loan when the engine gives the term exactly', () => {
    const result = designResult();
    expect(termModePatch('payments', result)).toEqual({
      termMode: 'payments',
      termPayments: '360',
    });
    expect(termModePatch('endDate', result)).toEqual({
      termMode: 'endDate',
      termEndDate: result.summary.payoffDate,
    });
    expect(termModePatch('years', result)).toEqual({ termMode: 'years' });
  });

  it('keeps the last entered value without a result or after an early close', () => {
    expect(termModePatch('payments', null)).toEqual({ termMode: 'payments' });
    expect(termModePatch('endDate', null)).toEqual({ termMode: 'endDate' });
    expect(termModePatch('endDate', earlyClose(designResult()))).toEqual({ termMode: 'endDate' });
  });
});

describe('status lines', () => {
  it('rounds payments to the minor or the whole unit of the currency', () => {
    expect(paymentRoundingUnit('minor-half-up')).toBe('$0.01');
    expect(paymentRoundingUnit('minor-ceil')).toBe('$0.01');
    expect(paymentRoundingUnit('unit-half-up')).toBe('$1');
    expect(paymentRoundingUnit('unit-ceil')).toBe('$1');
  });

  it('counts only Advanced settings that apply to the loan as custom', () => {
    expect(hasCustomSettings(FORM)).toBe(false);
    expect(hasCustomSettings({ ...FORM, headlineMethod: 'xirr' })).toBe(true);
    expect(hasCustomSettings({ ...FORM, principalRemainder: 'first' })).toBe(false);
    expect(
      hasCustomSettings({ ...FORM, repayment: 'equal-principal', principalRemainder: 'first' }),
    ).toBe(true);
    expect(hasCustomSettings({ ...FORM, endOfMonth: false })).toBe(false);
    expect(hasCustomSettings({ ...FORM, endOfMonth: false, disbursementDate: '2026-02-28' })).toBe(
      true,
    );
  });

  it('pluralizes the fee count', () => {
    const fee = FORM.fees[0];
    if (fee === undefined) {
      throw new Error('the design scenario has a fee');
    }
    expect(moreStatus({ ...FORM, fees: [fee, { ...fee, uid: 'other' }] })).toBe(
      '2 fees and insurance items',
    );
    expect(moreStatus({ ...FORM, fees: [fee, fee], termMode: 'payments' })).toBe(
      '2 fees and insurance items · custom settings',
    );
  });

  it('names the regulator of methods that have one', () => {
    expect(headlineOptionLabel('ukAprc')).toBe('APR · FCA · UK');
    expect(headlineOptionLabel('xirr')).toBe('XIRR');
  });

  it('knows month ends, and that an empty date is none', () => {
    expect(isMonthEnd('2028-02-29')).toBe(true);
    expect(isMonthEnd('2027-02-28')).toBe(true);
    expect(isMonthEnd('2028-02-28')).toBe(false);
    expect(isMonthEnd('')).toBe(false);
  });
});

describe('fees', () => {
  const periodic: FeeDraft = {
    uid: 'p',
    name: '',
    kind: 'periodic',
    calc: 'percent',
    value: '1',
    financing: 'paid',
    inApr: true,
  };

  it('maps calculations the way the engine input does', () => {
    expect(feeCalcOf(periodic)).toBe('pct-original');
    expect(feeCalcOf({ ...periodic, calc: 'pct-balance' })).toBe('pct-balance');
    expect(feeCalcOf({ ...periodic, kind: 'upfront', calc: 'pct-balance' })).toBe('percent');
    expect(feeCalcOf({ ...periodic, kind: 'upfront', calc: 'fixed' })).toBe('fixed');
  });

  it('has no summary without amounts', () => {
    expect(feeSummary(periodic, undefined, 'APR')).toBeNull();
  });
});
