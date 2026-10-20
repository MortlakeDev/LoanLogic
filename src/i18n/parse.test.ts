// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatCurrencyName,
  formatMoney,
  formatMoneyParts,
  formatMonthYear,
  formatNumber,
} from './format';
import { parseDecimalInput } from './parse';

const NBSP = ' ';
const NARROW_NBSP = ' ';
const MINUS = '−';

function value(text: string, locale: string, kind: 'money' | 'percent' | 'integer'): string | null {
  const result = parseDecimalInput(text, locale, kind);
  return result.ok ? result.value : null;
}

describe('parseDecimalInput — money', () => {
  it.each([
    ['en-US', '350,000.50', '350000.50'],
    ['en-US', '350000.5', '350000.5'],
    ['en-US', '1,234,567', '1234567'],
    ['en-US', ' 42 ', '42'],
    ['en-US', '-12.30', '-12.30'],
    ['en-US', `${MINUS}12.30`, '-12.30'],
    ['en-US', '007', '7'],
    ['en-US', '.5', '0.5'],
    ['en-US', '5.', '5'],
    ['zh-CN', '1,000,000.00', '1000000.00'],
    ['de-DE', '350.000,50', '350000.50'],
    ['de-DE', '350000,50', '350000.50'],
    ['de-DE', '6.875.000', '6875000'],
    ['de-DE', '6.875,5', '6875.5'],
    ['ru-RU', `350${NBSP}000,50`, '350000.50'],
    ['ru-RU', `350${NARROW_NBSP}000,50`, '350000.50'],
    ['ru-RU', '350 000,50', '350000.50'],
    ['ru-RU', '350000.50', '350000.50'],
    ['uk-UA', '1 000 000,00', '1000000.00'],
    ['uk-UA', '12,5', '12.5'],
  ])('%s: "%s" → %s', (locale, text, expected) => {
    expect(value(text, locale, 'money')).toBe(expected);
  });

  it.each([
    ['en-US', '1.000,50'],
    ['en-US', '1,00'],
    ['en-US', '12,34,567'],
    ['en-US', '1,000,0'],
    ['en-US', '1e3'],
    ['en-US', '+5'],
    ['en-US', '5-'],
    ['en-US', '--5'],
    ['en-US', '1.2.3'],
    ['en-US', ''],
    ['en-US', '  '],
    ['en-US', '-'],
    ['en-US', '.'],
    ['en-US', '$5'],
    ['de-DE', '6.875'],
    ['de-DE', '1.000'],
    ['de-DE', '1,000,00'],
    ['ru-RU', '1,000.00'],
    ['ru-RU', '12 34'],
    ['zh-CN', '1,000,0.5'],
  ])('%s: "%s" is invalid, never a guess', (locale, text) => {
    expect(parseDecimalInput(text, locale, 'money')).toEqual({ ok: false });
  });

  it('round-trips what formatNumber prints, in every supported locale', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('en-US', 'de-DE', 'ru-RU', 'uk-UA', 'zh-CN'),
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        (locale, cents) => {
          const negative = cents < 0n;
          const digits = (negative ? -cents : cents).toString().padStart(3, '0');
          const exact = `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
          const shown = formatNumber(exact, locale, { minimumFractionDigits: 2 });
          // A displayed zero has no sign (SPEC display rule), so −0.00 reads back as 0.00.
          const expected = /^-0\.00$/.test(exact) ? '0.00' : exact;
          expect(value(shown, locale, 'money')).toBe(expected);
        },
      ),
    );
  });
});

describe('parseDecimalInput — percent', () => {
  it.each([
    ['en-US', '6.875', '6.875'],
    ['en-US', '6,875', '6.875'],
    ['de-DE', '6.875', '6.875'],
    ['de-DE', '6,875', '6.875'],
    ['ru-RU', '6,875', '6.875'],
    ['uk-UA', '0,0000000001', '0.0000000001'],
    ['zh-CN', '3.10', '3.10'],
    ['en-US', '-0.5', '-0.5'],
    ['en-US', `${MINUS}0,5`, '-0.5'],
    ['en-US', ',5', '0.5'],
  ])('%s: "%s" → %s', (locale, text, expected) => {
    expect(value(text, locale, 'percent')).toBe(expected);
  });

  it.each(['1,000.5', '1 000', '6.8.7', 'abc', '', '1e2', '5%'])(
    '"%s" is invalid: percentages take no grouping',
    (text) => {
      expect(parseDecimalInput(text, 'en-US', 'percent')).toEqual({ ok: false });
    },
  );
});

describe('parseDecimalInput — integer', () => {
  it.each([
    ['30', '30'],
    [' 360 ', '360'],
    ['007', '7'],
    ['0', '0'],
  ])('"%s" → %s', (text, expected) => {
    expect(value(text, 'en-US', 'integer')).toBe(expected);
  });

  it.each(['1,200', '1 200', '12.5', '-3', '', 'x'])('"%s" is invalid', (text) => {
    expect(parseDecimalInput(text, 'ru-RU', 'integer')).toEqual({ ok: false });
  });
});

describe('formatMoneyParts', () => {
  it.each([
    ['2299.25', 'USD', 'en-US', 2],
    ['4270.16', 'CNY', 'zh-CN', 2],
    ['12345.67', 'UAH', 'uk-UA', 2],
    ['-0.004', 'USD', 'en-US', 2],
    ['-15.5', 'EUR', 'de-DE', 2],
    ['35000000', 'JPY', 'en-US', 0],
  ])('joins to exactly formatMoney for %s %s in %s', (amount, currency, locale, digits) => {
    const parts = formatMoneyParts(amount, currency, locale, { fractionDigits: digits });
    expect(parts.map((part) => part.value).join('')).toBe(
      formatMoney(amount, currency, locale, { fractionDigits: digits }),
    );
  });

  it('separates the currency symbol, integer, decimal and fraction parts', () => {
    const parts = formatMoneyParts('2299.25', 'USD', 'en-US');
    expect(parts.map((part) => [part.type, part.value])).toEqual([
      ['currency', '$'],
      ['integer', '2'],
      ['group', ','],
      ['integer', '299'],
      ['decimal', '.'],
      ['fraction', '25'],
    ]);
    // Ukrainian puts the symbol last; the parts say so without any string slicing.
    expect(formatMoneyParts('12345.67', 'UAH', 'uk-UA').at(-1)).toMatchObject({
      type: 'currency',
    });
  });
});

describe('formatMonthYear', () => {
  it.each([
    ['en-US', 'Dec 2026'],
    ['zh-CN', '2026年12月'],
  ])('writes December 2026 in %s as %s', (locale, expected) => {
    expect(formatMonthYear({ y: 2026, m: 12 }, locale)).toBe(expected);
  });

  it('keeps the month in every time zone and rejects invalid months', () => {
    expect(formatMonthYear({ y: 2027, m: 1 }, 'en-US')).toBe('Jan 2027');
    expect(() => formatMonthYear({ y: 2026, m: 13 }, 'en-US')).toThrow(RangeError);
    expect(() => formatMonthYear({ y: 0, m: 1 }, 'en-US')).toThrow(RangeError);
  });
});

describe('formatCurrencyName', () => {
  it('names currencies in the UI language and falls back to the code', () => {
    expect(formatCurrencyName('USD', 'en-US')).toBe('US Dollar');
    expect(formatCurrencyName('CNY', 'zh-CN')).toBe('人民币');
    expect(formatCurrencyName('XXZ', 'en-US')).toBe('XXZ');
  });
});

describe('formatNumber with significant digits', () => {
  it('rounds irrational explain values to 10 significant digits', () => {
    expect(formatNumber('2299.2503260271', 'en-US', { maximumSignificantDigits: 10 })).toBe(
      '2,299.250326',
    );
    expect(formatNumber('0.005729166666667', 'ru-RU', { maximumSignificantDigits: 10 })).toBe(
      '0,005729166667',
    );
  });
});
