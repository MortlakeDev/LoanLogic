// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Display formatting bound to the current scenario and UI language: the currency of the
 * form, its minor units and the formatting locale. Every figure a component shows goes
 * through these helpers (or the i18n helpers they wrap), so amounts always carry the
 * engine's minor units (DESIGN §9) and a zero never shows a sign.
 *
 * The helpers read signals, so a component that calls them re-renders when the language
 * or the currency changes.
 */

import { computed } from '@preact/signals';
import { minorUnits, parseIsoDate } from '../../engine';
import {
  type DateStyle,
  formatDate,
  formatMoney,
  formatMoneyParts,
  formatMonthYear,
  formatNumber,
  formatPercent,
} from '../../i18n';
import { formatLocale } from './i18n';
import { form } from './loan';

/** The scenario's currency code. */
export const currency = computed(() => form.value.currency);

/**
 * Digits of the currency's minor unit (USD 2, JPY 0). A code outside the engine's table
 * cannot be chosen in the UI; the engine reports it as `CURRENCY_INVALID` anyway.
 */
export const currencyDigits = computed(() => minorUnits(form.value.currency) ?? 2);

/** An engine amount with the currency symbol: "$2,299.25", "12 345,67 ₴". */
export function money(value: string, fractionDigits: number = currencyDigits.value): string {
  return formatMoney(value, currency.value, formatLocale.value, { fractionDigits });
}

/** An engine amount as Intl parts, for hero numbers (DESIGN §4.2). */
export function moneyParts(value: string): Intl.NumberFormatPart[] {
  return formatMoneyParts(value, currency.value, formatLocale.value, {
    fractionDigits: currencyDigits.value,
  });
}

/** An engine amount without the currency symbol, for table cells (DESIGN §9): "2,299.25". */
export function amount(value: string): string {
  const digits = currencyDigits.value;
  return formatNumber(value, formatLocale.value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** The currency's symbol in the current locale ("$", "¥", "₴"), for input prefixes. */
export function currencySymbol(): string {
  return (
    formatMoneyParts('0', currency.value, formatLocale.value).find(
      (part) => part.type === 'currency',
    )?.value ?? currency.value
  );
}

/** A count or other plain number: "360", "1,200". */
export function count(value: number | string): string {
  return formatNumber(value, formatLocale.value);
}

/**
 * A percentage given in percent ("6.974" → 0.06974) as a ratio string, exactly: the
 * decimal point moves two places, with no detour through floating point.
 */
export function percentToFraction(percent: string): string {
  const negative = percent.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? percent.slice(1) : percent).split('.');
  const padded = whole.padStart(3, '0');
  const integer = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${integer}.${padded.slice(-2)}${fraction}`;
}

/**
 * A rate given in percent, with a fixed number of decimals: `ratePercent("6.974", 3)` →
 * "6.974%" (en-US), "6,974 %" (ru-RU). Rates keep their trailing zeros (DESIGN §9).
 */
export function ratePercent(percent: string, decimals: number): string {
  return formatPercent(percentToFraction(percent), decimals, formatLocale.value);
}

/** A share given as a fraction ("0.421") with one decimal: "42.1%". */
export function share(fraction: string): string {
  return formatPercent(fraction, 1, formatLocale.value);
}

/** An engine date (YYYY-MM-DD) in the locale's medium style: "Dec 1, 2026". */
export function date(iso: string, style: DateStyle = 'medium'): string {
  const parsed = parseIsoDate(iso);
  if (parsed === undefined) {
    throw new RangeError(`Not an ISO date: "${iso}"`);
  }
  return formatDate(parsed, formatLocale.value, style);
}

/** The month and year of an engine date: "Dec 2026", "2026年12月". */
export function monthYear(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (parsed === undefined) {
    throw new RangeError(`Not an ISO date: "${iso}"`);
  }
  return formatMonthYear(parsed, formatLocale.value);
}
