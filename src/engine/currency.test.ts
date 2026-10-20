// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES, minorUnits } from './currency';

/** Codes whose ISO 4217 minor unit is "N.A." (SPEC §1.2). */
const NOT_APPLICABLE = [
  'XAU',
  'XAG',
  'XPT',
  'XPD',
  'XDR',
  'XSU',
  'XUA',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XTS',
  'XXX',
];

describe('minorUnits (SPEC §1.2)', () => {
  it.each([
    ['USD', 2],
    ['GBP', 2],
    ['EUR', 2],
    ['CNY', 2],
    ['UAH', 2],
    ['JPY', 0],
    ['KRW', 0],
    ['KWD', 3],
    ['CLF', 4],
  ] as const)('gives the required test value %s = %i', (code, digits) => {
    expect(minorUnits(code)).toBe(digits);
  });

  it.each(NOT_APPLICABLE)('rejects the N.A. code %s', (code) => {
    expect(minorUnits(code)).toBeUndefined();
  });

  it('rejects unknown, malformed and historic codes', () => {
    for (const code of [
      '',
      'ABC',
      'usd',
      'Usd',
      'US',
      'USDD',
      ' USD',
      'USD ',
      'DEM',
      'FRF',
      'ITL',
    ]) {
      expect(minorUnits(code), code).toBeUndefined();
    }
  });

  it('does not answer for inherited object properties', () => {
    for (const code of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(minorUnits(code), code).toBeUndefined();
    }
  });

  it('lists exactly the zero-, three- and four-digit currencies of ISO 4217', () => {
    const byDigits = (digits: number): string[] =>
      CURRENCY_CODES.filter((code) => minorUnits(code) === digits);
    expect(byDigits(0)).toEqual([
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'ISK',
      'JPY',
      'KMF',
      'KRW',
      'PYG',
      'RWF',
      'UGX',
      'UYI',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ]);
    expect(byDigits(3)).toEqual(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
    expect(byDigits(4)).toEqual(['CLF', 'UYW']);
  });
});

describe('CURRENCY_CODES', () => {
  it('is a frozen, sorted list of unique three-letter codes', () => {
    expect(Object.isFrozen(CURRENCY_CODES)).toBe(true);
    expect([...CURRENCY_CODES].sort()).toEqual(CURRENCY_CODES);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(CURRENCY_CODES).toHaveLength(165);
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3, 4]).toContain(minorUnits(code));
    }
  });

  it('contains no N.A. code', () => {
    for (const code of NOT_APPLICABLE) {
      expect(CURRENCY_CODES).not.toContain(code);
    }
  });
});
