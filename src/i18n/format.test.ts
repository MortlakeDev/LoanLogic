// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  type CalendarDate,
  type DateStyle,
} from './format';

const NBSP = ' ';
const NARROW_NBSP = ' ';
const DATE_STYLES: readonly DateStyle[] = ['full', 'long', 'medium', 'short'];
const LOCALES = ['en-US', 'zh-CN', 'ru-RU', 'uk-UA'] as const;

/** The locale's grouping and decimal separators, as this runtime's ICU defines them. */
function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === 'group')?.value;
  const decimal = parts.find((part) => part.type === 'decimal')?.value;
  if (group === undefined || decimal === undefined) {
    throw new Error(`No group/decimal separator for ${locale}`);
  }
  return { group, decimal };
}

/**
 * Independent reference for a calendar date: the ISO date-time string format pins the
 * instant to UTC midnight for any four-digit year (including 0000–0099).
 */
function referenceDate(iso: string, locale: string, style: DateStyle): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

function iso({ y, m, d }: CalendarDate): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Turns an integer number of minor units (scale 10^digits) into a plain decimal string. */
function toDecimalString(units: bigint, digits: number): string {
  const negative = units < 0n;
  const magnitude = (negative ? -units : units).toString().padStart(digits + 1, '0');
  const integer = magnitude.slice(0, magnitude.length - digits);
  const fraction = magnitude.slice(magnitude.length - digits);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

describe('formatMoney', () => {
  it('formats the brief sample: 1234567.891 USD in en-US', () => {
    expect(formatMoney('1234567.891', 'USD', 'en-US')).toBe('$1,234,567.89');
  });

  it('shows no decimals for JPY and rounds to whole yen', () => {
    expect(formatMoney('1234.5', 'JPY', 'en-US')).toBe('¥1,235');
    expect(formatMoney('1234.4', 'JPY', 'en-US')).toBe('¥1,234');
    expect(formatMoney('1234', 'JPY', 'en-US')).not.toMatch(/\./);
  });

  it('shows three decimals for KWD', () => {
    const rounded = formatMoney('1234.5678', 'KWD', 'en-US');
    expect(rounded).toContain('KWD');
    expect(rounded).toMatch(/1,234\.568$/);
    expect(formatMoney('1234.5', 'KWD', 'en-US')).toMatch(/1,234\.500$/);
  });

  it.each([
    ['ru-RU', 'RUB', '₽'],
    ['uk-UA', 'UAH', '₴'],
  ])('uses native grouping and a decimal comma in %s', (locale, currency, symbol) => {
    const { group, decimal } = separators(locale);
    expect([NBSP, NARROW_NBSP]).toContain(group);
    expect(decimal).toBe(',');

    const formatted = formatMoney('1234567.891', currency, locale);
    expect(formatted.startsWith(`1${group}234${group}567${decimal}89`)).toBe(true);
    expect(formatted).toContain(symbol);
    expect(formatted).not.toMatch(/[.]/);
  });

  it('formats CNY in zh-CN with ¥ and two decimals', () => {
    expect(formatMoney('1234567.891', 'CNY', 'zh-CN')).toBe('¥1,234,567.89');
    expect(formatMoney('5', 'CNY', 'zh-CN')).toBe('¥5.00');
  });

  it('keeps every digit of exact decimal strings (no detour through floats)', () => {
    expect(formatMoney('12345678901234567.89', 'USD', 'en-US')).toBe('$12,345,678,901,234,567.89');
    // 2^53 + 1 is the first integer a double cannot represent.
    expect(formatMoney('9007199254740993.01', 'USD', 'en-US')).toBe('$9,007,199,254,740,993.01');
    expect(formatMoney('0.1', 'USD', 'en-US')).toBe('$0.10');
  });

  it.each([
    ['2.345', '$2.35'],
    ['-2.345', '-$2.35'],
    ['2.344', '$2.34'],
    ['-2.344', '-$2.34'],
    ['0.125', '$0.13'],
    ['-0.125', '-$0.13'],
    ['1.005', '$1.01'],
    ['999.995', '$1,000.00'],
  ])('rounds %s half away from zero to %s', (value, expected) => {
    expect(formatMoney(value, 'USD', 'en-US')).toBe(expected);
  });

  it('accepts other plain decimal spellings', () => {
    expect(formatMoney('.5', 'USD', 'en-US')).toBe('$0.50');
    expect(formatMoney('+7', 'USD', 'en-US')).toBe('$7.00');
    expect(formatMoney('-0.5', 'USD', 'en-US')).toBe('-$0.50');
  });

  it('honours fractionDigits over the currency default', () => {
    expect(formatMoney('1234.567', 'USD', 'en-US', { fractionDigits: 0 })).toBe('$1,235');
    expect(formatMoney('1234.5', 'USD', 'en-US', { fractionDigits: 4 })).toBe('$1,234.5000');
    expect(formatMoney('1234.5', 'JPY', 'en-US', { fractionDigits: 2 })).toBe('¥1,234.50');
    expect(formatMoney('-2.5', 'USD', 'en-US', { fractionDigits: 0 })).toBe('-$3');
  });

  it('honours currencyDisplay', () => {
    expect(formatMoney('1234.5', 'CAD', 'en-US')).toBe('CA$1,234.50');
    expect(formatMoney('1234.5', 'CAD', 'en-US', { currencyDisplay: 'symbol' })).toBe(
      'CA$1,234.50',
    );
    expect(formatMoney('1234.5', 'CAD', 'en-US', { currencyDisplay: 'narrowSymbol' })).toBe(
      '$1,234.50',
    );
    expect(formatMoney('1234.5', 'USD', 'en-US', { currencyDisplay: 'code' })).toMatch(
      /^USD\s1,234\.50$/u,
    );
    expect(formatMoney('1234.5', 'USD', 'en-US', { currencyDisplay: 'name' })).toBe(
      '1,234.50 US dollars',
    );
  });

  it.each(['abc', '1,000', '', ' ', '1.2.3', '0x10', 'Infinity', 'NaN', '1_000', '١٢٣', '$5'])(
    'rejects the non-decimal string %j with a RangeError',
    (value) => {
      expect(() => formatMoney(value, 'USD', 'en-US')).toThrow(RangeError);
    },
  );

  it('rejects a malformed currency code with a RangeError', () => {
    expect(() => formatMoney('1', 'US', 'en-US')).toThrow(RangeError);
  });

  it('round-trips any whole number of cents exactly (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), (cents) => {
        const value = toDecimalString(cents, 2);
        const formatted = formatMoney(value, 'USD', 'en-US');
        expect(formatted.startsWith('$')).toBe(true);
        expect(formatted.replace(/[$,]/g, '')).toBe(value);
      }),
    );
  });

  it('rounds three-decimal amounts half away from zero exactly (property)', () => {
    const mills = fc
      .bigInt({ min: -(10n ** 13n), max: 10n ** 13n })
      // |x| < 0.005 rounds to a signed zero, whose display the SPEC does not define yet.
      .filter((value) => value >= 5n || value <= -5n);
    fc.assert(
      fc.property(mills, (amount) => {
        const negative = amount < 0n;
        const magnitude = negative ? -amount : amount;
        const cents = (magnitude + 5n) / 10n;
        const expected = `${negative ? '-' : ''}${toDecimalString(cents, 2)}`;
        const formatted = formatMoney(toDecimalString(amount, 3), 'USD', 'en-US');
        expect(formatted.replace(/[$,]/g, '')).toBe(expected);
      }),
    );
  });
});

describe('formatNumber', () => {
  it('keeps all fraction digits by default', () => {
    expect(formatNumber('1234567.891', 'en-US')).toBe('1,234,567.891');
    expect(formatNumber('0.12345678901234567891', 'en-US')).toBe('0.12345678901234567891');
  });

  it('uses native separators in ru-RU and uk-UA', () => {
    for (const locale of ['ru-RU', 'uk-UA']) {
      const { group, decimal } = separators(locale);
      expect(formatNumber('1234567.5', locale)).toBe(`1${group}234${group}567${decimal}5`);
      expect(formatNumber(1234.5, locale)).toBe(`1${group}234${decimal}5`);
    }
  });

  it('accepts numbers and bigints', () => {
    expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatNumber(12345678901234567890n, 'en-US')).toBe('12,345,678,901,234,567,890');
  });

  it('honours its options', () => {
    expect(formatNumber('1234567.891', 'en-US', { useGrouping: false })).toBe('1234567.891');
    expect(formatNumber('5', 'en-US', { minimumFractionDigits: 2 })).toBe('5.00');
    expect(formatNumber('2.25', 'en-US', { maximumFractionDigits: 1 })).toBe('2.3');
    expect(formatNumber('-2.25', 'en-US', { maximumFractionDigits: 1 })).toBe('-2.3');
    expect(
      formatNumber('1.5', 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ).toBe('1.50');
  });

  it.each(['abc', '1,000', '', '0x10', 'Infinity'])('rejects %j with a RangeError', (value) => {
    expect(() => formatNumber(value, 'en-US')).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects the non-finite number %s instead of printing it',
    (value) => {
      expect(() => formatNumber(value, 'en-US')).toThrow(RangeError);
    },
  );
});

describe('out-of-range decimal strings', () => {
  const huge = `1${'0'.repeat(400)}`;

  it.each(['1e400', '-1e400', huge])('are rejected by every number formatter: %s', (value) => {
    expect(() => formatMoney(value, 'USD', 'en-US')).toThrow(RangeError);
    expect(() => formatNumber(value, 'en-US')).toThrow(RangeError);
    expect(() => formatPercent(value, 2, 'en-US')).toThrow(RangeError);
  });

  it('still format a tiny exponent that rounds to zero', () => {
    expect(formatMoney('1e-400', 'USD', 'en-US')).toBe('$0.00');
  });
});

describe('formatPercent', () => {
  it('formats a fraction as a percentage with fixed decimals', () => {
    expect(formatPercent('0.065', 2, 'en-US')).toBe('6.50%');
    expect(formatPercent('0.065', 0, 'en-US')).toBe('7%');
    expect(formatPercent('0.0125', 1, 'en-US')).toBe('1.3%');
    expect(formatPercent('-0.0125', 1, 'en-US')).toBe('-1.3%');
    expect(formatPercent(0.5, 0, 'en-US')).toBe('50%');
  });

  it('keeps exact decimal strings exact', () => {
    expect(formatPercent('0.06825', 3, 'en-US')).toBe('6.825%');
    expect(formatPercent('0.1234567890123456789', 17, 'en-US')).toBe('12.34567890123456789%');
  });

  it('uses the ru-RU decimal comma and percent spacing', () => {
    const { decimal } = separators('ru-RU');
    expect(formatPercent('0.065', 2, 'ru-RU')).toMatch(new RegExp(`^6${decimal}50[\\s]?%$`, 'u'));
    expect(formatPercent('0.065', 2, 'ru-RU')).not.toContain('.');
  });

  it.each(['abc', '6.5%', ''])('rejects %j with a RangeError', (value) => {
    expect(() => formatPercent(value, 2, 'en-US')).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects the non-finite number %s', (value) => {
    expect(() => formatPercent(value, 2, 'en-US')).toThrow(RangeError);
  });
});

describe('formatDate', () => {
  const leapDay: CalendarDate = { y: 2024, m: 2, d: 29 };

  it('formats every date style in en-US', () => {
    expect(formatDate(leapDay, 'en-US', 'full')).toBe('Thursday, February 29, 2024');
    expect(formatDate(leapDay, 'en-US', 'long')).toBe('February 29, 2024');
    expect(formatDate(leapDay, 'en-US', 'medium')).toBe('Feb 29, 2024');
    expect(formatDate(leapDay, 'en-US', 'short')).toBe('2/29/24');
  });

  it('defaults to the medium style', () => {
    expect(formatDate(leapDay, 'en-US')).toBe(formatDate(leapDay, 'en-US', 'medium'));
  });

  it('formats native long and short dates in ru-RU and zh-CN', () => {
    expect(formatDate(leapDay, 'ru-RU', 'long')).toBe('29 февраля 2024 г.');
    expect(formatDate(leapDay, 'ru-RU', 'short')).toBe('29.02.2024');
    expect(formatDate(leapDay, 'zh-CN', 'long')).toBe('2024年2月29日');
    expect(formatDate(leapDay, 'uk-UA', 'long')).toBe('29 лютого 2024 р.');
  });

  it.each(LOCALES)('matches the UTC calendar date in every style for %s', (locale) => {
    for (const style of DATE_STYLES) {
      for (const date of [leapDay, { y: 2026, m: 12, d: 31 }, { y: 1999, m: 1, d: 1 }]) {
        expect(formatDate(date, locale, style)).toBe(referenceDate(iso(date), locale, style));
      }
    }
  });

  describe('in time zones far from UTC', () => {
    const originalZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

    afterEach(() => {
      // Node re-reads the zone when TZ is assigned but not when it is deleted, so put the
      // original zone back before unstubbing.
      vi.stubEnv('TZ', originalZone);
      vi.unstubAllEnvs();
    });

    const cases: readonly [CalendarDate, string, string][] = [
      [{ y: 2024, m: 1, d: 1 }, 'January 1, 2024', '1/1/24'],
      [{ y: 2024, m: 2, d: 29 }, 'February 29, 2024', '2/29/24'],
      [{ y: 2026, m: 12, d: 31 }, 'December 31, 2026', '12/31/26'],
    ];

    it.each([
      ['Pacific/Kiritimati', -14 * 60],
      ['Pacific/Pago_Pago', 11 * 60],
      ['America/Los_Angeles', 8 * 60],
    ])('shows the same day in %s', async (zone, januaryOffsetMinutes) => {
      vi.stubEnv('TZ', zone);
      // Prove the zone switch took effect, otherwise the test would pass vacuously.
      expect(new Date(Date.UTC(2024, 0, 1)).getTimezoneOffset()).toBe(januaryOffsetMinutes);

      // A fresh module instance, so no formatter cached under another zone is reused.
      vi.resetModules();
      const fresh = await import('./format');
      for (const [date, long, short] of cases) {
        expect(fresh.formatDate(date, 'en-US', 'long')).toBe(long);
        expect(fresh.formatDate(date, 'en-US', 'short')).toBe(short);
        expect(fresh.formatDate(date, 'ru-RU', 'short')).toBe(
          `${String(date.d).padStart(2, '0')}.${String(date.m).padStart(2, '0')}.${String(date.y)}`,
        );
      }
    });
  });

  it('keeps years 1–99 as they are (not 1901–1999)', () => {
    expect(formatDate({ y: 50, m: 1, d: 1 }, 'en-US', 'long')).toBe('January 1, 50');
    expect(formatDate({ y: 1, m: 1, d: 1 }, 'en-US', 'long')).toBe('January 1, 1');
    expect(formatDate({ y: 99, m: 12, d: 31 }, 'en-US', 'long')).toBe('December 31, 99');
    for (const style of DATE_STYLES) {
      expect(formatDate({ y: 50, m: 1, d: 1 }, 'en-US', style)).toBe(
        referenceDate('0050-01-01', 'en-US', style),
      );
    }
  });

  it('rejects years before 1, which Intl would print without an era as a wrong year', () => {
    for (const date of [
      { y: 0, m: 2, d: 29 },
      { y: 0, m: 1, d: 1 },
      { y: -5, m: 3, d: 1 },
    ]) {
      expect(() => formatDate(date, 'en-US', 'long')).toThrow(RangeError);
    }
    expect(formatDate({ y: 1, m: 1, d: 1 }, 'en-US', 'long')).toBe(
      referenceDate('0001-01-01', 'en-US', 'long'),
    );
  });

  it('applies the Gregorian leap-year rules', () => {
    expect(formatDate({ y: 2000, m: 2, d: 29 }, 'en-US', 'long')).toBe('February 29, 2000');
    expect(formatDate({ y: 400, m: 2, d: 29 }, 'en-US', 'long')).toBe('February 29, 400');
    expect(() => formatDate({ y: 1900, m: 2, d: 29 }, 'en-US')).toThrow(RangeError);
    expect(() => formatDate({ y: 100, m: 2, d: 29 }, 'en-US')).toThrow(RangeError);
    expect(() => formatDate({ y: 1, m: 2, d: 29 }, 'en-US')).toThrow(RangeError);
  });

  it.each<CalendarDate>([
    { y: 2026, m: 2, d: 29 },
    { y: 2026, m: 13, d: 1 },
    { y: 2026, m: 0, d: 10 },
    { y: 2026, m: 1, d: 0 },
    { y: 2026, m: 1, d: 32 },
    { y: 2026, m: 4, d: 31 },
    { y: 2026, m: -1, d: 1 },
    { y: 2026.5, m: 1, d: 1 },
    { y: 2026, m: 1.5, d: 1 },
    { y: 2026, m: 1, d: 1.5 },
    { y: Number.NaN, m: 1, d: 1 },
    { y: 2026, m: Number.POSITIVE_INFINITY, d: 1 },
    { y: 1_000_000, m: 1, d: 1 },
  ])('rejects the invalid date %o with a RangeError', (date) => {
    expect(() => formatDate(date, 'en-US', 'long')).toThrow(RangeError);
  });
});
