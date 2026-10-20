// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Localized texts built from engine values: the messages of every error and warning code
 * (SPEC §13), the names of rate methods, frequencies and other ids. Engine `params` are
 * strings (§13); they are parsed here and formatted with the i18n helpers before they
 * reach a message.
 */

import {
  type DayCountId,
  type EngineError,
  type EngineWarning,
  type FrequencyId,
  type RateMethodId,
  type RepaymentType,
  type RoundingMode,
  minorUnits,
} from '../../engine';
import { type DecimalInputKind, formatDate, formatNumber, type MessageKey } from '../../i18n';
import { ratePercent } from './display';
import { headlineMethodFor, type RateSource } from './headline';
import { formatLocale, t } from './i18n';
import { type FieldPath, type LoanForm, form } from './loan';

// ---------------------------------------------------------------------------------------
// Names of ids
// ---------------------------------------------------------------------------------------

const DAY_COUNT_KEYS = {
  '30u-360': 'dayCount.thirty360Us',
  '30-360-isda': 'dayCount.thirty360Isda',
  '30e-360': 'dayCount.thirtyE360',
  'act-360': 'dayCount.act360',
  'act-365f': 'dayCount.act365f',
  'act-act-isda': 'dayCount.actActIsda',
} as const satisfies Record<DayCountId, string>;

const ROUNDING_MODE_KEYS = {
  'half-up': 'roundingMode.halfUp',
  'half-even': 'roundingMode.halfEven',
  ceil: 'roundingMode.ceil',
  floor: 'roundingMode.floor',
} as const satisfies Record<RoundingMode, string>;

const REPAYMENT_KEYS = {
  annuity: 'repayment.annuity',
  'equal-principal': 'repayment.equalPrincipal',
  bullet: 'repayment.bullet',
  balloon: 'repayment.balloon',
} as const satisfies Record<RepaymentType, string>;

/** A rate method's name in the terms of GLOSSARY §6 ("APR", "年化利率（单利）"). */
export function methodName(method: RateMethodId): string {
  return t(`rateMethod.${method}`);
}

/** A rate method's short name for "In {rateName}" (GLOSSARY §4). */
export function methodShortName(method: RateMethodId): string {
  return t(`rateShort.${method}`);
}

/** The text of a source badge ("Reg Z · US"). */
export function sourceName(source: RateSource): string {
  return t(`rateSource.${source}`);
}

/** A frequency's name ("Monthly"). */
export function frequencyName(frequency: FrequencyId): string {
  return t(`frequency.${frequency}`);
}

/** The payment label of a frequency ("Monthly payment", DESIGN §8.6). */
export function paymentLabel(frequency: FrequencyId): string {
  return t(`payment.${frequency}`);
}

/** A repayment type's title ("Equal payments"). */
export function repaymentName(repayment: RepaymentType): string {
  return t(REPAYMENT_KEYS[repayment]);
}

/** A day-count convention with a short description ("ACT/365F (actual days ÷ 365)"). */
export function dayCountName(dayCount: DayCountId): string {
  return t(DAY_COUNT_KEYS[dayCount]);
}

/** A rounding mode's name ("Half up"). */
export function roundingModeName(mode: RoundingMode): string {
  return t(ROUNDING_MODE_KEYS[mode]);
}

/** The default name of a fee row by kind ("Origination fee"). */
export function defaultFeeName(kind: 'upfront' | 'periodic' | 'insurance'): string {
  return kind === 'upfront'
    ? t('fees.defaultUpfront')
    : kind === 'periodic'
      ? t('fees.defaultPeriodic')
      : t('fees.defaultInsurance');
}

/** Labels of the inputs, by UI field (the error list names the field it leads to). */
const FIELD_LABEL_KEYS = {
  currency: 'inputs.currency',
  amount: 'inputs.amount',
  annualRatePct: 'inputs.rate',
  term: 'inputs.term',
  'term.years': 'inputs.termYears',
  'term.months': 'inputs.termMonths',
  'term.payments': 'inputs.termPayments',
  'term.endDate': 'inputs.termEndDate',
  frequency: 'inputs.frequency',
  repayment: 'inputs.repayment',
  'balloon.kind': 'inputs.balloonKind',
  'balloon.value': 'inputs.balloon',
  disbursementDate: 'inputs.disbursementDate',
  fees: 'fees.title',
  'accrual.mode': 'advanced.interestModel',
  'accrual.compounding': 'advanced.compounding',
  'accrual.method': 'advanced.dayCount',
  'accrual.paymentBasis': 'advanced.paymentBasis',
  'rounding.interest': 'advanced.roundingInterest',
  'rounding.payment': 'advanced.roundingPayment',
  'rounding.fees': 'advanced.roundingFees',
  'rounding.principalRemainder': 'advanced.principalRemainder',
  endOfMonth: 'advanced.endOfMonth',
  rateMethods: 'advanced.headline',
} as const satisfies Record<string, MessageKey>;

/**
 * The label of the input a UI field path belongs to ("Loan amount"; a fee's value is
 * named after its row: the user's name or the default name of its kind).
 */
export function fieldLabel(field: FieldPath, value: LoanForm = form.value): string {
  const fee = /^fee:(.+)\.value$/.exec(field);
  if (fee !== null) {
    const draft = value.fees.find((item) => item.uid === fee[1]);
    if (draft === undefined) {
      return t('fees.title');
    }
    return draft.name.trim() === '' ? defaultFeeName(draft.kind) : draft.name.trim();
  }
  const key: MessageKey | undefined = (FIELD_LABEL_KEYS as Readonly<Record<string, MessageKey>>)[
    field
  ];
  return key === undefined ? field : t(key);
}

/** The headline method a form uses when its choice is "automatic". */
export function automaticMethod(value: LoanForm = form.value): RateMethodId {
  return headlineMethodFor(value.currency);
}

// ---------------------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------------------

/** Engine limits quoted by messages (SPEC §2.4, §3.4, §13). */
const LIMITS = {
  money: '1000000000000000',
  rateMin: '-20',
  rateMax: '1000',
  years: 100,
  months: 11,
  payments: 1200,
  percentDecimals: 10,
  feePercent: '100',
  /** Above this annual rate the engine warns `RATE_HIGH` (SPEC §3.4). */
  highRate: '100',
} as const;

/** What a field holds, for messages that depend on it (`INPUT_INVALID`, `TOO_MANY_DECIMALS`). */
export function fieldKind(field: FieldPath, value: LoanForm = form.value): DecimalInputKind {
  if (field === 'annualRatePct') {
    return 'percent';
  }
  if (field === 'term.years' || field === 'term.months' || field === 'term.payments') {
    return 'integer';
  }
  if (field === 'balloon.value') {
    return value.balloonKind === 'percent' ? 'percent' : 'money';
  }
  const fee = /^fee:(.+)\.value$/.exec(field);
  if (fee !== null) {
    const draft = value.fees.find((item) => item.uid === fee[1]);
    return draft === undefined || draft.calc === 'fixed' ? 'money' : 'percent';
  }
  return 'money';
}

/** The message for an input whose text does not parse. */
function inputInvalidMessage(field: FieldPath, value: LoanForm): string {
  if (field === 'disbursementDate' || field === 'term.endDate') {
    return t('errors.inputInvalidDate');
  }
  const locale = formatLocale.value;
  switch (fieldKind(field, value)) {
    case 'money': {
      // The example must itself be valid in the currency (no cents for JPY, three digits
      // for KWD), or following it would give TOO_MANY_DECIMALS.
      const digits = minorUnits(value.currency) ?? 2;
      return t('errors.inputInvalidMoney', {
        example: formatNumber(digits === 0 ? '350000' : '350000.5', locale, {
          minimumFractionDigits: digits,
        }),
      });
    }
    case 'percent':
      return t('errors.inputInvalidPercent', { example: formatNumber('6.875', locale) });
    case 'integer':
      return t('errors.inputInvalidInteger');
  }
}

/** The `TOO_MANY_DECIMALS` message: whole minor units for money, 10⁻¹⁰ for percentages. */
function tooManyDecimalsMessage(field: FieldPath, value: LoanForm): string {
  if (fieldKind(field, value) === 'percent') {
    return t('errors.tooManyDecimalsPercent', { digits: LIMITS.percentDecimals });
  }
  const digits = minorUnits(value.currency) ?? 0;
  return digits === 0
    ? t('errors.tooManyDecimalsWhole', { currency: value.currency })
    : t('errors.tooManyDecimalsMoney', { digits, currency: value.currency });
}

/** The `TERM_RANGE` message of the field it is reported on. */
function termRangeMessage(field: FieldPath): string {
  switch (field) {
    case 'term.years':
      return t('errors.termRangeYears', { max: LIMITS.years });
    case 'term.months':
      return t('errors.termRangeMonths', { max: LIMITS.months });
    case 'term.payments':
      return t('errors.termRangePayments', { max: LIMITS.payments });
    default:
      return t('errors.termRange', { max: LIMITS.payments });
  }
}

/** The `FEE_RANGE` message: the fees section (`fees`) or one fee's value. */
function feeRangeMessage(field: FieldPath, value: LoanForm): string {
  if (field === 'fees') {
    return t('errors.feeRangeTotal');
  }
  return fieldKind(field, value) === 'percent'
    ? t('errors.feeRangePercent', { max: ratePercent(LIMITS.feePercent, 0) })
    : t('errors.feeRangeFixed', { max: formatNumber(LIMITS.money, formatLocale.value) });
}

/**
 * The localized message of an error on a UI field (DESIGN §8.2): `field` is the UI field
 * the error belongs to (`fieldOfEngineError`), which decides wording that depends on the
 * input, such as money against percentages.
 */
export function fieldErrorMessage(
  field: FieldPath,
  error: EngineError,
  value: LoanForm = form.value,
): string {
  const locale = formatLocale.value;
  switch (error.code) {
    case 'INPUT_INVALID':
      return inputInvalidMessage(field, value);
    case 'CURRENCY_INVALID':
      return t('errors.currencyInvalid');
    case 'AMOUNT_RANGE':
      return t('errors.amountRange', { max: formatNumber(LIMITS.money, locale) });
    case 'TOO_MANY_DECIMALS':
      return tooManyDecimalsMessage(field, value);
    case 'RATE_RANGE':
      return t('errors.rateRange', {
        min: ratePercent(LIMITS.rateMin, 0),
        max: ratePercent(LIMITS.rateMax, 0),
      });
    case 'TERM_RANGE':
      return termRangeMessage(field);
    case 'TERM_TOO_SHORT':
      return t('errors.termTooShort');
    case 'DATE_INVALID':
      return field === 'term.endDate'
        ? t('errors.endDateInvalid')
        : t('errors.dateInvalid', { max: formatDate({ y: 9999, m: 12, d: 31 }, locale) });
    case 'BALLOON_RANGE':
      return t('errors.balloonRange');
    case 'FEE_RANGE':
      return feeRangeMessage(field, value);
    case 'UNSUPPORTED':
      return t('errors.unsupportedBasis');
    case 'AMOUNT_TOO_SMALL_FOR_TERM':
      return t('errors.amountTooSmall');
    case 'NEG_AMORTIZATION':
      return negativeAmortizationMessage(error);
  }
}

/** The field that holds the fix suggested for `NEG_AMORTIZATION`, with its message. */
export interface FixSuggestion {
  readonly field: FieldPath;
  readonly message: string;
}

/**
 * The `NEG_AMORTIZATION` message with the first period whose principal is negative
 * (`params.period`, a decimal string).
 */
export function negativeAmortizationMessage(error: EngineError): string {
  const period = error.params?.period;
  return t('errors.negAmortization', {
    period: period === undefined ? '?' : formatNumber(period, formatLocale.value),
  });
}

/**
 * A fix for `NEG_AMORTIZATION` that fits the loan (T03 brief §4): the exact payment basis
 * for a day-count annuity; the periodic interest model for a day-count balloon (the exact
 * basis is `UNSUPPORTED` there); in the periodic model a finer payment rounding, or
 * rounding the payment up when it is already rounded half up to the minor unit.
 */
export function negativeAmortizationFix(value: LoanForm = form.value): FixSuggestion {
  if (value.accrualMode === 'daycount' && value.repayment === 'annuity') {
    return { field: 'accrual.paymentBasis', message: t('errors.negAmortizationFixExact') };
  }
  if (value.accrualMode === 'daycount') {
    return { field: 'accrual.mode', message: t('errors.negAmortizationFixPeriodic') };
  }
  // Half up to the minor unit is already the finest rounding; what is left is rounding the
  // payment up, so that it is never below the exact instalment.
  return value.roundingPayment === 'minor-half-up'
    ? { field: 'rounding.payment', message: t('errors.negAmortizationFixRoundUp') }
    : { field: 'rounding.payment', message: t('errors.negAmortizationFixRounding') };
}

// ---------------------------------------------------------------------------------------
// Warnings and rate failures
// ---------------------------------------------------------------------------------------

/** The method ids of an `IRR_MULTIPLE` warning ("xirr,ukAprc") as localized names. */
function methodList(methods: string | undefined): string {
  const names = (methods ?? '')
    .split(',')
    .filter((id) => id !== '')
    .map((id) => methodName(id as RateMethodId));
  return new Intl.ListFormat(formatLocale.value, { type: 'conjunction' }).format(names);
}

/** The localized explanation of an engine warning (DESIGN §8.13). */
export function warningMessage(warning: EngineWarning): string {
  const params = warning.params ?? {};
  const locale = formatLocale.value;
  switch (warning.code) {
    case 'RATE_NEGATIVE':
      return t('warnings.rateNegative', { rate: rateAsEntered(params.annualRatePct) });
    case 'RATE_HIGH':
      return t('warnings.rateHigh', {
        limit: ratePercent(LIMITS.highRate, 0),
        rate: rateAsEntered(params.annualRatePct),
      });
    case 'EARLY_CLOSE':
      // `count` picks the plural form of the noun after {scheduled} ("из 361 платежа").
      return t('warnings.earlyClose', {
        count: Number(params.scheduled ?? '0'),
        paymentsCount: formatNumber(params.paymentsCount ?? '0', locale),
        scheduled: formatNumber(params.scheduled ?? '0', locale),
      });
    case 'IRR_MULTIPLE':
      return t('warnings.irrMultiple', { methods: methodList(params.methods) });
  }
}

/** A rate in percent as entered ("6.875") with its own decimals: "6.875%". */
function rateAsEntered(percent: string | undefined): string {
  const value = percent ?? '0';
  const decimals = value.split('.')[1]?.length ?? 0;
  return ratePercent(value, decimals);
}

/** The reason a rate shows "n/a" (`IRR_NO_CONVERGENCE`, SPEC §10). */
export function rateFailureReason(): string {
  return t('rates.noConvergence', {
    min: ratePercent('-99', 0),
    max: ratePercent('1000000000', 0),
  });
}
