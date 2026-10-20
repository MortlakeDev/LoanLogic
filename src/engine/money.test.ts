// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DECIMAL_STRING, decimalValue, formatMinor, isDecimalString, toMinorUnits } from './money';
import { rational } from './rational';

describe('isDecimalString (SPEC §15 DecimalString)', () => {
  it.each(['6.5', '-0.5', '0', '-0', '0.065', '100000.00', '1000000000000000.00', '12', '0.50'])(
    'accepts %s',
    (text) => {
      expect(isDecimalString(text)).toBe(true);
      expect(DECIMAL_STRING.test(text)).toBe(true);
    },
  );

  it.each([
    '',
    '-',
    '+1',
    '1e5',
    '1E5',
    '1,000.00',
    '1 000',
    ' 1',
    '1 ',
    '01',
    '-01',
    '00.5',
    '1.',
    '.5',
    '-.5',
    '--1',
    '1.2.3',
    '0x10',
    'NaN',
    'Infinity',
    '١٢',
    '1\n',
    '６',
  ])('rejects %j', (text) => {
    expect(isDecimalString(text)).toBe(false);
  });

  it('rejects values that are not strings', () => {
    for (const value of [1, 1.5, 0, null, undefined, true, {}, [], 10n]) {
      expect(isDecimalString(value)).toBe(false);
    }
  });
});

describe('decimalValue', () => {
  it('parses exactly', () => {
    expect(decimalValue('6.5')).toEqual(rational(13n, 2n));
    expect(decimalValue('-0.5')).toEqual(rational(-1n, 2n));
    expect(decimalValue('100000.00')).toEqual(rational(100000n));
  });
});

describe('toMinorUnits (SPEC §1.2)', () => {
  it('accepts whole minor units, including trailing zeros', () => {
    expect(toMinorUnits('100.100', 2)).toBe(10010n);
    expect(toMinorUnits('100.10', 2)).toBe(10010n);
    expect(toMinorUnits('100', 2)).toBe(10000n);
    expect(toMinorUnits('0', 2)).toBe(0n);
    expect(toMinorUnits('-12.34', 2)).toBe(-1234n);
  });

  it('rejects amounts finer than the minor unit', () => {
    expect(toMinorUnits('100.005', 2)).toBeUndefined();
    expect(toMinorUnits('0.001', 2)).toBeUndefined();
  });

  it('handles JPY 0, KWD 3 and CLF 4 minor units', () => {
    expect(toMinorUnits('35000000', 0)).toBe(35000000n);
    expect(toMinorUnits('1.0', 0)).toBe(1n);
    expect(toMinorUnits('100000.5', 0)).toBeUndefined();
    expect(toMinorUnits('50000.000', 3)).toBe(50000000n);
    expect(toMinorUnits('0.001', 3)).toBe(1n);
    expect(toMinorUnits('0.0005', 3)).toBeUndefined();
    expect(toMinorUnits('3000.0000', 4)).toBe(30000000n);
    expect(toMinorUnits('0.0001', 4)).toBe(1n);
    expect(toMinorUnits('0.00001', 4)).toBeUndefined();
  });

  it('is exact at the largest amount, 1e15', () => {
    expect(toMinorUnits('1000000000000000', 2)).toBe(10n ** 17n);
    expect(toMinorUnits('1000000000000000.00', 2)).toBe(10n ** 17n);
    expect(toMinorUnits('999999999999999.99', 2)).toBe(10n ** 17n - 1n);
    expect(toMinorUnits('1000000000000000.0000', 4)).toBe(10n ** 19n);
  });
});

describe('formatMinor', () => {
  it('formats at the currency minor units', () => {
    expect(formatMinor(123450n, 2)).toBe('1234.50');
    expect(formatMinor(123450n, 0)).toBe('123450');
    expect(formatMinor(1n, 3)).toBe('0.001');
    expect(formatMinor(30000000n, 4)).toBe('3000.0000');
    expect(formatMinor(-5n, 2)).toBe('-0.05');
    expect(formatMinor(10n ** 17n, 2)).toBe('1000000000000000.00');
  });

  it('writes zero without a sign', () => {
    expect(formatMinor(0n, 2)).toBe('0.00');
    expect(formatMinor(0n, 0)).toBe('0');
    expect(formatMinor(0n, 3)).toBe('0.000');
  });

  it('round-trips with toMinorUnits and always shows the minor-unit digits', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 19n), max: 10n ** 19n }),
        fc.constantFrom(0, 2, 3, 4),
        (minor, minorUnits) => {
          const text = formatMinor(minor, minorUnits);
          expect(isDecimalString(text)).toBe(true);
          expect(text.split('.')[1]?.length ?? 0).toBe(minorUnits);
          expect(toMinorUnits(text, minorUnits)).toBe(minor);
        },
      ),
    );
  });
});
