// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Calendar dates without time or zone (SPEC §2.1), on integer day numbers of the
 * proleptic Gregorian calendar. JS `Date` is never used here.
 *
 * Arithmetic works for any year so that a schedule running past 9999-12-31 can be
 * detected; `isSupportedDate` tells whether a date is inside 0001-01-01 … 9999-12-31.
 */

/** A calendar date; `m` is 1-based (1 = January). */
export interface LocalDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

/** First supported date (SPEC §2.1). */
export const MIN_DATE: LocalDate = Object.freeze({ y: 1, m: 1, d: 1 });
/** Last supported date (SPEC §2.1). */
export const MAX_DATE: LocalDate = Object.freeze({ y: 9999, m: 12, d: 31 });

/** Whether `y` is a Gregorian leap year. */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Number of days in month `m` (1–12) of year `y`. */
export function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 2:
      return isLeapYear(y) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/** Whether the date is the last day of its month. */
export function isLastDayOfMonth(date: LocalDate): boolean {
  return date.d === daysInMonth(date.y, date.m);
}

/** The last day of the date's month. */
export function lastDayOfMonth(date: LocalDate): LocalDate {
  return { y: date.y, m: date.m, d: daysInMonth(date.y, date.m) };
}

/** Whether `y-m-d` names an existing date (any integer year). */
function exists(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) &&
    Number.isInteger(m) &&
    Number.isInteger(d) &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, m)
  );
}

/**
 * Day number of a date: days since 1970-01-01 (negative before). Uses the era-based
 * civil-to-days conversion, exact for every integer year.
 */
export function toDayNumber(date: LocalDate): number {
  const y = date.m <= 2 ? date.y - 1 : date.y;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = date.m > 2 ? date.m - 3 : date.m + 9;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + date.d - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date of a day number (inverse of `toDayNumber`). */
export function fromDayNumber(dayNumber: number): LocalDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const d = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const m = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const y = yearOfEra + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

/** `date + n` days. */
export function addDays(date: LocalDate, n: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + n);
}

/**
 * `date + n` months (n may be negative): the same day of month, clamped to the length of
 * the target month (Jan 31 + 1 month = Feb 28/29; Mar 31 − 1 month = Feb 28/29).
 * This is also how months are counted back (SPEC §2.1 "Counting months back").
 */
export function addMonths(date: LocalDate, n: number): LocalDate {
  const monthIndex = date.y * 12 + (date.m - 1) + n;
  const y = Math.floor(monthIndex / 12);
  const m = monthIndex - y * 12 + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

/** Days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** −1, 0 or 1 as `a` is earlier than, equal to or later than `b`. */
export function compareDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  if (a.y !== b.y) {
    return a.y < b.y ? -1 : 1;
  }
  if (a.m !== b.m) {
    return a.m < b.m ? -1 : 1;
  }
  return a.d === b.d ? 0 : a.d < b.d ? -1 : 1;
}

/** Whether `a` and `b` are the same date. */
export function sameDate(a: LocalDate, b: LocalDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Whether the date lies within 0001-01-01 … 9999-12-31. */
export function isSupportedDate(date: LocalDate): boolean {
  return compareDates(date, MIN_DATE) >= 0 && compareDates(date, MAX_DATE) <= 0;
}

/**
 * Parses a strict `YYYY-MM-DD` date (four-digit year ≥ 0001, existing day). Returns
 * `undefined` for anything else, including "2026-2-3", "2026-02-30" and "0000-01-01".
 */
export function parseIsoDate(text: string): LocalDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return y >= 1 && exists(y, m, d) ? { y, m, d } : undefined;
}

/** Formats a supported date as `YYYY-MM-DD`. */
export function formatIsoDate(date: LocalDate): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.y, 4)}-${pad(date.m, 2)}-${pad(date.d, 2)}`;
}
