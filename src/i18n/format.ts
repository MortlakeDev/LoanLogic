// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Locale-aware formatting helpers. Every number, amount, percentage and date shown to
 * the user goes through these functions; the locale is always passed explicitly.
 *
 * Decimal strings are handed to `Intl.NumberFormat` as strings, so exact ledger values
 * are formatted without a detour through binary floating point.
 *
 * Display rule: a value that displays as zero never shows a sign. "-0.004" USD is "$0.00",
 * not "-$0.00", while "-0.005" is "-$0.01" (`signDisplay: 'negative'`).
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
  /** Rounds to this many significant digits instead (irrational explain values, DESIGN §8.6). */
  readonly maximumSignificantDigits?: number;
  readonly useGrouping?: boolean;
}

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Returns a cached `Intl.NumberFormat`: constructing one is far slower than formatting, and
 * a schedule table formats thousands of cells with a handful of option sets.
 */
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(cacheKey, format);
  }
  return format;
}

/**
 * Checks a value before it reaches Intl and returns it in a form Intl formats exactly
 * (decimal strings stay strings). Non-finite values would print as "NaN" or "∞": a bug
 * upstream, never a figure to show.
 *
 * @throws RangeError for a non-finite number, a string that is not a plain decimal
 *   ("1,000", "0x10", "Infinity"), or a decimal string whose magnitude overflows a double.
 */
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
 *   away from zero; an amount that rounds to zero has no sign.
 * @throws RangeError if `value` is not a finite decimal string.
 */
export function formatMoney(
  value: string,
  currency: string,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  return numberFormat(locale, moneyOptions(currency, options)).format(toIntlValue(value));
}

/** The Intl options of every money formatter, so text and parts always agree. */
function moneyOptions(currency: string, options: MoneyFormatOptions): Intl.NumberFormatOptions {
  const intlOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
    roundingMode: 'halfExpand',
    signDisplay: 'negative',
  };
  if (options.fractionDigits !== undefined) {
    intlOptions.minimumFractionDigits = options.fractionDigits;
    intlOptions.maximumFractionDigits = options.fractionDigits;
  }
  return intlOptions;
}

/**
 * A monetary amount as Intl parts (`currency`, `integer`, `group`, `decimal`,
 * `fraction`, `minusSign`, `literal`), for displays that style the parts differently
 * (DESIGN §4.2 hero numbers: the symbol small and muted, the minor units muted). The parts
 * join to exactly `formatMoney`'s string, in any locale and currency (`¥4,270.16`,
 * `12 345,67 ₴`); never split a formatted string by hand.
 *
 * @param value Amount in major units as a decimal string.
 * @param currency ISO 4217 code.
 * @param locale BCP 47 formatting locale.
 * @throws RangeError if `value` is not a finite decimal string.
 */
export function formatMoneyParts(
  value: string,
  currency: string,
  locale: string,
  options: MoneyFormatOptions = {},
): Intl.NumberFormatPart[] {
  return numberFormat(locale, moneyOptions(currency, options)).formatToParts(toIntlValue(value));
}

/**
 * Formats a plain number with locale grouping and decimal separators. Keeps up to 20
 * fraction digits unless `options` limit them; a value that rounds to zero has no sign.
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
    signDisplay: 'negative',
    maximumFractionDigits: 20,
    ...options,
  }).format(toIntlValue(value));
}

/**
 * Formats a ratio as a percentage with a fixed number of decimals.
 *
 * @param value The ratio as a decimal fraction: "0.065" (or 0.065) is shown as 6.5 %.
 * @param digits Number of decimals to show (0–20), rounded half away from zero; a value
 *   that rounds to zero has no sign.
 * @param locale BCP 47 formatting locale.
 * @throws RangeError if `value` is not finite or not a decimal string.
 */
export function formatPercent(value: DecimalInput, digits: number, locale: string): string {
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    roundingMode: 'halfExpand',
    signDisplay: 'negative',
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

const monthYearFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A month and year as Intl writes it in `locale` ("Dec 2026", "2026年12月", "дек. 2026 г.")
 * for schedule groups and chart labels (DESIGN §9). Formatted in UTC from the calendar
 * fields, so the month never shifts with the time zone.
 *
 * @param date A calendar date; only `y` and `m` are used.
 * @param locale BCP 47 formatting locale.
 * @throws RangeError if `y` < 1 or `m` is not 1–12.
 */
export function formatMonthYear(date: Pick<CalendarDate, 'y' | 'm'>, locale: string): string {
  const { y, m } = date;
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 1 || m < 1 || m > 12) {
    throw new RangeError(`Invalid month: ${String(y)}-${String(m)}`);
  }
  const instant = new Date(Date.UTC(2000, 0, 1));
  instant.setUTCFullYear(y, m - 1, 1);
  let format = monthYearFormats.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' });
    monthYearFormats.set(locale, format);
  }
  return format.format(instant);
}

const currencyNames = new Map<string, Intl.DisplayNames>();

/**
 * A currency's name in `locale` ("US Dollar", "美元", "доллар США"), as Intl writes it,
 * for the currency select. Codes Intl does not know come back as the code itself.
 *
 * @param code ISO 4217 code.
 * @param locale BCP 47 locale of the UI language.
 */
export function formatCurrencyName(code: string, locale: string): string {
  let names = currencyNames.get(locale);
  if (names === undefined) {
    names = new Intl.DisplayNames(locale, { type: 'currency', fallback: 'code' });
    currencyNames.set(locale, names);
  }
  return names.of(code) ?? code;
}
