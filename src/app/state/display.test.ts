// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { beforeEach, describe, expect, it } from 'vitest';
import {
  amount,
  count,
  currency,
  currencyDigits,
  currencySymbol,
  date,
  money,
  moneyParts,
  monthYear,
  percentToFraction,
  ratePercent,
  share,
} from './display';
import { setLanguage } from './i18n';
import { resetForm, updateForm } from './loan';

/** Intl separates groups and units with NBSP or narrow NBSP; compare with plain spaces. */
function spaced(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

beforeEach(() => {
  resetForm();
  setLanguage('en');
});

describe('percentToFraction', () => {
  it.each([
    ['6.974', '0.06974'],
    ['6.875', '0.06875'],
    ['-0.5', '-0.005'],
    ['-20', '-0.20'],
    ['100', '1.00'],
    ['0', '0.00'],
    ['0.0000000001', '0.000000000001'],
    ['1000', '10.00'],
    ['1000000000', '10000000.00'],
    ['12.25', '0.1225'],
  ])('%s %% → %s', (percent, fraction) => {
    expect(percentToFraction(percent)).toBe(fraction);
  });
});

describe('ratePercent', () => {
  it('keeps trailing zeros', () => {
    expect(ratePercent('6.50', 2)).toBe('6.50%');
    expect(ratePercent('6.974', 3)).toBe('6.974%');
    expect(ratePercent('3.1', 2)).toBe('3.10%');
    expect(ratePercent('-20', 0)).toBe('-20%');
    expect(ratePercent('1000', 0)).toBe('1,000%');
  });

  it('follows the UI language', () => {
    setLanguage('ru');
    expect(spaced(ratePercent('6.974', 3))).toBe('6,974 %');
    setLanguage('zh-CN');
    expect(ratePercent('3.10', 2)).toBe('3.10%');
  });
});

describe('money and amounts', () => {
  it('formats USD with the symbol and two decimals', () => {
    expect(currency.value).toBe('USD');
    expect(currencyDigits.value).toBe(2);
    expect(money('2299.25')).toBe('$2,299.25');
    expect(money('-5.5')).toBe('-$5.50');
    expect(money('-0.004')).toBe('$0.00');
    expect(money('2299.25', 0)).toBe('$2,299');
    expect(
      moneyParts('2299.25')
        .map((part) => part.value)
        .join(''),
    ).toBe('$2,299.25');
  });

  it('formats JPY without minor units', () => {
    updateForm({ currency: 'JPY' });
    expect(currencyDigits.value).toBe(0);
    expect(money('4270')).toBe('¥4,270');
    expect(amount('4270')).toBe('4,270');
    expect(currencySymbol()).toBe('¥');
  });

  it('formats UAH in Ukrainian', () => {
    setLanguage('uk');
    updateForm({ currency: 'UAH' });
    expect(spaced(money('12345.67'))).toBe('12 345,67 ₴');
    expect(spaced(amount('12345.6'))).toBe('12 345,60');
    expect(currencySymbol()).toBe('₴');
    const parts = moneyParts('12345.67');
    expect(parts.find((part) => part.type === 'currency')?.value).toBe('₴');
    expect(parts.find((part) => part.type === 'decimal')?.value).toBe(',');
  });

  it('writes amounts without the symbol, negative with a minus sign', () => {
    expect(amount('2299.25')).toBe('2,299.25');
    expect(amount('-3641.8')).toBe('-3,641.80');
    expect(amount('0')).toBe('0.00');
  });

  it('gives the symbol of the currency in the current locale', () => {
    expect(currencySymbol()).toBe('$');
    updateForm({ currency: 'CNY' });
    setLanguage('zh-CN');
    expect(currencySymbol()).toBe('¥');
  });

  it('falls back to 2 digits for a code outside the engine table', () => {
    updateForm({ currency: 'ZZZ' });
    expect(currencyDigits.value).toBe(2);
  });
});

describe('count and share', () => {
  it('formats counts with grouping', () => {
    expect(count(360)).toBe('360');
    expect(count(1200)).toBe('1,200');
    expect(count('1200')).toBe('1,200');
    setLanguage('ru');
    expect(spaced(count(1200))).toBe('1 200');
  });

  it('formats shares with one decimal', () => {
    expect(share('0.421')).toBe('42.1%');
    expect(share('0.004')).toBe('0.4%');
    expect(share('-0.012')).toBe('-1.2%');
  });
});

describe('dates', () => {
  it('formats engine dates in the locale', () => {
    expect(date('2026-12-01')).toBe('Dec 1, 2026');
    expect(date('2026-12-01', 'long')).toBe('December 1, 2026');
    expect(monthYear('2026-12-01')).toBe('Dec 2026');
    setLanguage('zh-CN');
    expect(monthYear('2026-12-01')).toBe('2026年12月');
  });

  it('rejects a string that is not an existing ISO date', () => {
    expect(() => date('2026-02-30')).toThrow(RangeError);
    expect(() => date('01.12.2026')).toThrow(RangeError);
    expect(() => monthYear('2026-13-01')).toThrow(RangeError);
    expect(() => monthYear('')).toThrow(RangeError);
  });
});
