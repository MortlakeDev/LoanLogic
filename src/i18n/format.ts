// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Locale-aware formatting helpers. Every number, amount, percentage and date shown to
 * the user goes through these functions; the locale is always passed explicitly.
 *
 * Decimal strings are handed to `Intl.NumberFormat` as strings, so exact ledger values
 * are formatted without a detour through binary floating point.
 */

/** A decimal value: a decimal string such as "1234.56" (preferred for money), or a number. */
export type DecimalInput = string | number | bigint;

/** A calendar date without time or zone; `m` is 1-based (1 = January). */
export interface CalendarDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export type DateStyle = 'full' | 'long' | 'medium' | 'short';

export interface MoneyFormatOptions {
  /** Overrides the currency's default fraction digits (e.g. to show whole units). */
  readonly fractionDigits?: number;
  readonly currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
}

export interface NumberFormatOptions {
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly useGrouping?: boolean;
}

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(cacheKey, format);
  }
  return format;
}

// Non-finite values would print as "NaN" or "∞": a bug upstream, never a figure to show.
function toIntlValue(value: DecimalInput): number | bigint | Intl.StringNumericLiteral {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Not a finite number: ${String(value)}`);
    }
    return value;
  }
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new RangeError(`Not a decimal string: "${value}"`);
  }
  // Out-of-range exponents ("1e400") overflow to Infinity; the exact string is still what
  // Intl formats.
  if (!Number.isFinite(Number(trimmed))) {
    throw new RangeError(`Decimal string out of range: "${value}"`);
  }
  return trimmed as Intl.StringNumericLiteral;
}

/**
 * Formats a monetary amount.
 *
 * @param value Amount in major units as a decimal string, e.g. "1234567.89".
 * @param currency ISO 4217 code, e.g. "USD".
 * @param locale BCP 47 formatting locale, e.g. "en-US".
 * @returns The localized amount, e.g. "$1,234,567.89". Uses the currency's standard
 *   fraction digits (JPY 0, KWD 3) unless `options.fractionDigits` is given; rounds half
 *   away from zero.
 * @throws RangeError if `value` is not a finite decimal string.
 */
export function formatMoney(
  value: string,
  currency: string,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const intlOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
    roundingMode: 'halfExpand',
  };
  if (options.fractionDigits !== undefined) {
    intlOptions.minimumFractionDigits = options.fractionDigits;
    intlOptions.maximumFractionDigits = options.fractionDigits;
  }
  return numberFormat(locale, intlOptions).format(toIntlValue(value));
}

/**
 * Formats a plain number with locale grouping and decimal separators.
 *
 * @param value Decimal string or number.
 * @param locale BCP 47 formatting locale.
 * @throws RangeError if `value` is not finite or not a decimal string.
 */
export function formatNumber(
  value: DecimalInput,
  locale: string,
  options: NumberFormatOptions = {},
): string {
  return numberFormat(locale, {
    roundingMode: 'halfExpand',
    maximumFractionDigits: 20,
    ...options,
  }).format(toIntlValue(value));
}

/**
 * Formats a ratio as a percentage with a fixed number of decimals.
 *
 * @param value The ratio as a decimal fraction: "0.065" (or 0.065) is shown as 6.5 %.
 * @param digits Number of decimals to show (0–20), rounded half away from zero.
 * @param locale BCP 47 formatting locale.
 * @throws RangeError if `value` is not finite or not a decimal string.
 */
export function formatPercent(value: DecimalInput, digits: number, locale: string): string {
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    roundingMode: 'halfExpand',
  }).format(toIntlValue(value));
}

/**
 * Formats a calendar date. The date is placed at UTC midnight and formatted in UTC, so
 * the shown day never shifts with the user's time zone.
 *
 * @param date Calendar date (`m` is 1-based).
 * @param locale BCP 47 formatting locale.
 * @param style Intl `dateStyle`.
 * @throws RangeError if the date does not exist (e.g. 2026-02-30) or is before year 1
 *   (Intl prints no era, so year 0 or −5 would be shown as a wrong positive year).
 */
export function formatDate(
  date: CalendarDate,
  locale: string,
  style: DateStyle = 'medium',
): string {
  const { y, m, d } = date;
  const invalid = (): RangeError =>
    new RangeError(`Invalid calendar date: ${String(y)}-${String(m)}-${String(d)}`);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1) {
    throw invalid();
  }
  // Start from a UTC midnight and set the fields in one call: Date.UTC(y, …) alone would
  // map years 0–99 to 1900–1999.
  const instant = new Date(Date.UTC(2000, 0, 1));
  instant.setUTCFullYear(y, m - 1, d);
  if (
    instant.getUTCFullYear() !== y ||
    instant.getUTCMonth() !== m - 1 ||
    instant.getUTCDate() !== d
  ) {
    throw invalid();
  }
  const cacheKey = `${locale}|${style}`;
  let format = dateFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' });
    dateFormats.set(cacheKey, format);
  }
  return format.format(instant);
}
