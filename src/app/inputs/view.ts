// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Texts and small view rules of the inputs panel: option labels, the status lines of the
 * disclosures, the hint lines of the term and the fees. They select engine values and
 * format them with `display.ts` and the i18n helpers; nothing here computes money.
 */

import {
  type FeeAmount,
  type LoanResult,
  type PaymentRounding,
  type RateMethodId,
  CURRENCY_CODES,
  isLastDayOfMonth,
  parseIsoDate,
} from '../../engine';
import { formatCurrencyName } from '../../i18n';
import { fromMinor } from '../state/derived';
import { currencyDigits, money } from '../state/display';
import { rateSourceOf } from '../state/headline';
import { formatLocale, t } from '../state/i18n';
import type { FeeDraft, LoanForm, TermMode } from '../state/loan';
import { methodName, sourceName } from '../state/messages';

/** A successful engine result. */
export type OkResult = Extract<LoanResult, { ok: true }>;

/** The currencies listed first in the currency select (T03 brief §3), in this order. */
export const COMMON_CURRENCIES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'CNY',
  'UAH',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'PLN',
];

/** Every other code of the engine's ISO 4217 table, A–Z. */
export const OTHER_CURRENCIES: readonly string[] = CURRENCY_CODES.filter(
  (code) => !COMMON_CURRENCIES.includes(code),
);

/**
 * A currency option: "USD · US dollar" in the UI language, or the code alone when there is
 * no name for it (DESIGN §8.2). `Intl.DisplayNames` answers with the code itself for codes
 * its data lacks (CLF, ZWG in some browsers), which would read "CLF · CLF".
 *
 * @param nameOf The currency's name in the UI language; `Intl.DisplayNames` by default.
 */
export function currencyOptionLabel(
  code: string,
  nameOf: (code: string) => string | undefined = (item) =>
    formatCurrencyName(item, formatLocale.value),
): string {
  const name = nameOf(code);
  return name === undefined || name === '' || name === code
    ? code
    : t('inputs.currencyOption', { code, name });
}

/**
 * The number of scheduled payments N (SPEC §2.4) for the term hint: after an early close
 * the engine reports N in the `EARLY_CLOSE` warning (`scheduled`, a decimal string),
 * otherwise it is the summary's count. `null` while there is no result.
 */
export function scheduledPayments(result: OkResult | null): number | null {
  if (result === null) {
    return null;
  }
  const scheduled = result.warnings.find((warning) => warning.code === 'EARLY_CLOSE')?.params
    ?.scheduled;
  return scheduled === undefined ? result.summary.paymentsCount : Number(scheduled);
}

/**
 * The unit a payment policy rounds to, as money: one minor unit ("$0.01", "¥1") for the
 * `minor-*` policies, one whole unit ("$1") for the `unit-*` policies (SPEC §1.5).
 */
export function paymentRoundingUnit(policy: PaymentRounding): string {
  return policy === 'minor-half-up' || policy === 'minor-ceil'
    ? money(fromMinor(1n, currencyDigits.value))
    : money('1', 0);
}

/** A payment rounding option: "Half up to $0.01", "Up to $1". */
export function paymentRoundingLabel(policy: PaymentRounding): string {
  const unit = paymentRoundingUnit(policy);
  return policy === 'minor-half-up' || policy === 'unit-half-up'
    ? t('paymentRounding.halfUp', { unit })
    : t('paymentRounding.up', { unit });
}

/**
 * A rate method in the headline select. Methods with a regulator name it, so the US and
 * UK APRs (both "APR") can be told apart: "APR · Reg Z · US".
 */
export function headlineOptionLabel(method: RateMethodId): string {
  const source = rateSourceOf(method);
  return source === null
    ? methodName(method)
    : t('advanced.headlineOption', { method: methodName(method), source: sourceName(source) });
}

/** Whether an ISO date is the last day of its month (the end-of-month rule applies). */
export function isMonthEnd(iso: string): boolean {
  const date = parseIsoDate(iso);
  return date !== undefined && isLastDayOfMonth(date);
}

/**
 * The status line of the Advanced disclosure (DESIGN §8.5): the interest model and the
 * payment rounding, then the term mode and the headline method when they are not the
 * defaults.
 */
export function advancedStatus(value: LoanForm): string {
  const unit = paymentRoundingUnit(value.roundingPayment);
  const parts = [
    value.accrualMode === 'periodic' ? t('advanced.statusPeriodic') : t('advanced.statusDayCount'),
    value.roundingPayment === 'minor-half-up' || value.roundingPayment === 'unit-half-up'
      ? t('advanced.statusRoundHalfUp', { unit })
      : t('advanced.statusRoundUp', { unit }),
  ];
  if (value.termMode === 'payments') {
    parts.push(t('advanced.statusTermPayments'));
  } else if (value.termMode === 'endDate') {
    parts.push(t('advanced.statusTermEndDate'));
  }
  if (value.headlineMethod !== 'auto') {
    parts.push(t('advanced.statusMethod', { method: headlineOptionLabel(value.headlineMethod) }));
  }
  return parts.join(' · ');
}

/** The Advanced settings of the opening scenario (`defaultForm` in state/loan.ts). */
const ADVANCED_DEFAULTS = {
  termMode: 'years',
  accrualMode: 'periodic',
  compounding: 'payment',
  roundingInterest: 'half-up',
  roundingFees: 'half-up',
  roundingPayment: 'minor-half-up',
  principalRemainder: 'last',
  endOfMonth: true,
  headlineMethod: 'auto',
} as const satisfies Partial<LoanForm>;

/**
 * Whether an Advanced setting that applies to this loan differs from the opening
 * scenario. The principal remainder counts only for equal principal and the end-of-month
 * rule only on a month end, where those controls are shown.
 */
export function hasCustomSettings(value: LoanForm): boolean {
  return (
    value.termMode !== ADVANCED_DEFAULTS.termMode ||
    value.accrualMode !== ADVANCED_DEFAULTS.accrualMode ||
    value.compounding !== ADVANCED_DEFAULTS.compounding ||
    value.roundingInterest !== ADVANCED_DEFAULTS.roundingInterest ||
    value.roundingFees !== ADVANCED_DEFAULTS.roundingFees ||
    value.roundingPayment !== ADVANCED_DEFAULTS.roundingPayment ||
    value.headlineMethod !== ADVANCED_DEFAULTS.headlineMethod ||
    (value.repayment === 'equal-principal' &&
      value.principalRemainder !== ADVANCED_DEFAULTS.principalRemainder) ||
    (isMonthEnd(value.disbursementDate) && value.endOfMonth !== ADVANCED_DEFAULTS.endOfMonth)
  );
}

/** The status line of the mobile "Fees and advanced settings" disclosure (DESIGN §7.2). */
export function moreStatus(value: LoanForm): string {
  const count = value.fees.length;
  const custom = hasCustomSettings(value);
  if (count > 0) {
    return custom ? t('inputs.moreFeesCustom', { count }) : t('inputs.moreFees', { count });
  }
  return custom ? t('inputs.moreCustom') : t('inputs.moreNotSet');
}

/**
 * The calculation a fee row sends to the engine (as `toLoanInput` maps it): upfront
 * fees are fixed or a percentage of the amount, periodic items fixed or a percentage of
 * the amount or of the balance.
 */
export function feeCalcOf(fee: FeeDraft): FeeDraft['calc'] {
  if (fee.kind === 'upfront') {
    return fee.calc === 'fixed' ? 'fixed' : 'percent';
  }
  return fee.calc === 'percent' ? 'pct-original' : fee.calc;
}

/**
 * The hint line of a fee row from the engine's amounts (DESIGN §8.2): "$3,500.00 · paid
 * at closing · in APR"; for periodic items the amount per payment (of the first period
 * for a percentage of the balance) and the total. `null` without amounts (no result).
 */
export function feeSummary(
  fee: FeeDraft,
  amounts: FeeAmount | undefined,
  rateName: string,
): string | null {
  if (amounts === undefined) {
    return null;
  }
  const inRate = fee.inApr
    ? t('fees.hintInRate', { rateName })
    : t('fees.hintNotInRate', { rateName });
  if (fee.kind === 'upfront') {
    const financing = fee.financing === 'financed' ? t('fees.hintFinanced') : t('fees.hintPaid');
    return [money(amounts.amount), financing, inRate].join(' · ');
  }
  const amount = money(amounts.amount);
  const perPeriod =
    feeCalcOf(fee) === 'pct-balance'
      ? t('fees.hintFirstPeriod', { amount })
      : t('fees.hintPerPayment', { amount });
  return [perPeriod, t('fees.hintTotal', { amount: money(amounts.total) }), inRate].join(' · ');
}

/**
 * The form change for a new term mode. The new mode starts from the loan's current term
 * where the engine gives it exactly — the scheduled number of payments, or the payoff
 * date when the schedule runs its full length — so switching keeps the same loan;
 * otherwise the mode's last entered value stays.
 */
export function termModePatch(mode: TermMode, result: OkResult | null): Partial<LoanForm> {
  const payments = scheduledPayments(result);
  if (mode === 'payments' && payments !== null) {
    return { termMode: mode, termPayments: String(payments) };
  }
  if (mode === 'endDate' && result !== null && payments === result.summary.paymentsCount) {
    return { termMode: mode, termEndDate: result.summary.payoffDate };
  }
  return { termMode: mode };
}
