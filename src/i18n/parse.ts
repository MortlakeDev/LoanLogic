// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Parsing of numbers typed in the user's formatting locale into the engine's plain
 * decimal strings (SPEC §15 `DecimalString`). Fields reformat on blur only, so this
 * accepts what people type, but never guesses: anything ambiguous is invalid.
 */

/** What a field holds: money (grouping allowed), a percentage, or a whole number. */
export type DecimalInputKind = 'money' | 'percent' | 'integer';

/** The parse result: an engine decimal string, or a failure (`INPUT_INVALID`). */
export type DecimalInputResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false };

const NBSP = ' ';
const NARROW_NBSP = ' ';
const MINUS_SIGN = '−';
const SPACE_LIKE = new Set([' ', NBSP, NARROW_NBSP]);

const separatorCache = new Map<string, { group: string; decimal: string }>();

/** The locale's grouping and decimal separators, as this runtime's ICU defines them. */
function separatorsOf(locale: string): { group: string; decimal: string } {
  let separators = separatorCache.get(locale);
  if (separators === undefined) {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    separators = {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    };
    separatorCache.set(locale, separators);
  }
  return separators;
}

const FAIL: DecimalInputResult = Object.freeze({ ok: false });

/** Removes leading zeros of an integer part ("007" → "7", "000" → "0"). */
function trimLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

/** Builds the engine's decimal string from validated digit runs. */
function toDecimalString(negative: boolean, integer: string, fraction: string): string {
  const whole = trimLeadingZeros(integer);
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Integer digits with optional grouping, valid only between groups of three digits. */
function parseGroupedInteger(text: string, isGroup: (char: string) => boolean): string | null {
  if (/^\d+$/.test(text)) {
    return text;
  }
  const groups: string[] = [];
  let current = '';
  for (const char of text) {
    if (/\d/.test(char)) {
      current += char;
    } else if (isGroup(char)) {
      groups.push(current);
      current = '';
    } else {
      return null;
    }
  }
  groups.push(current);
  const [first, ...rest] = groups;
  if (first === undefined || !/^\d{1,3}$/.test(first) || rest.length === 0) {
    return null;
  }
  return rest.every((group) => /^\d{3}$/.test(group)) ? groups.join('') : null;
}

/**
 * Parses a number typed in `locale` into the engine's plain decimal string ("6.875",
 * "-0.5", "350000.50"), or fails (`INPUT_INVALID`, never a guess).
 *
 * - Leading and trailing spaces are ignored; "-" and U+2212 (−) are minus signs.
 * - `money`: the locale's decimal separator, and "." as a decimal separator when it is not
 *   the locale's grouping separator (iOS shows the device region's decimal key); the
 *   locale's grouping separator (a space-like one also as a plain space, NBSP or narrow
 *   NBSP) only between groups of three digits. Where "." is the grouping separator
 *   (de-DE), a single "." before exactly three digits could be either, so "6.875" is
 *   invalid there rather than 6875; "6.875.000" and "6.875,5" are not ambiguous.
 * - `percent`: no grouping; "." or "," as the decimal separator in every locale.
 * - `integer`: digits only.
 *
 * @param text The field's text as typed.
 * @param locale BCP 47 formatting locale (e.g. "de-DE").
 * @param kind What the field holds.
 */
export function parseDecimalInput(
  text: string,
  locale: string,
  kind: DecimalInputKind,
): DecimalInputResult {
  // trim() also removes NBSP and narrow NBSP (Unicode space separators).
  let body = text.trim();
  let negative = false;
  if (body.startsWith('-') || body.startsWith(MINUS_SIGN)) {
    negative = true;
    body = body.slice(1);
  }
  if (body === '') {
    return FAIL;
  }
  if (kind === 'integer') {
    return !negative && /^\d+$/.test(body) ? { ok: true, value: trimLeadingZeros(body) } : FAIL;
  }
  if (kind === 'percent') {
    const match = /^(\d*)(?:[.,](\d*))?$/.exec(body);
    const integer = match?.[1] ?? '';
    const fraction = match?.[2] ?? '';
    if (match === null || (integer === '' && fraction === '')) {
      return FAIL;
    }
    return { ok: true, value: toDecimalString(negative, integer, fraction) };
  }

  const { group, decimal } = separatorsOf(locale);
  const groupIsSpace = SPACE_LIKE.has(group);
  const isGroup = (char: string): boolean =>
    char === group || (groupIsSpace && SPACE_LIKE.has(char));
  const decimals = new Set([decimal]);
  if (group !== '.') {
    decimals.add('.');
  }
  // UTF-16 indices, so they match `slice` below (the separators are all single code units).
  const decimalPositions: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (decimals.has(body.charAt(index))) {
      decimalPositions.push(index);
    }
  }
  if (decimalPositions.length > 1) {
    return FAIL;
  }
  const at = decimalPositions[0];
  const integerText = at === undefined ? body : body.slice(0, at);
  const fraction = at === undefined ? '' : body.slice(at + 1);
  if (!/^\d*$/.test(fraction)) {
    return FAIL;
  }
  if (integerText === '') {
    return fraction === '' ? FAIL : { ok: true, value: toDecimalString(negative, '0', fraction) };
  }
  // "6.875" where "." groups: a decimal point from another region's keypad, or grouping?
  if (group === '.' && at === undefined && /^\d{1,3}\.\d{3}$/.test(integerText)) {
    return FAIL;
  }
  const integer = parseGroupedInteger(integerText, isGroup);
  return integer === null
    ? FAIL
    : { ok: true, value: toDecimalString(negative, integer, fraction) };
}
