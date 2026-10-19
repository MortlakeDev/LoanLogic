// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DECIMAL_PRECISION,
  EngineDecimal,
  GUARD_DIGITS,
  decimalRounding,
  decimalWithDigits,
  digitCount,
  decimalToExplainString,
  fromRational,
  roundDecimalToInteger,
} from './decimal';
import { fromInteger, rational, toExplainString } from './rational';
import type { RoundingMode } from './types';

describe('EngineDecimal configuration (SPEC §1.1)', () => {
  it('carries at least the 40 significant digits the SPEC requires', () => {
    expect(DECIMAL_PRECISION).toBeGreaterThanOrEqual(40);
    expect(EngineDecimal.precision).toBe(DECIMAL_PRECISION);
    expect(new EngineDecimal(1).div(3).toString()).toBe(`0.${'3'.repeat(DECIMAL_PRECISION)}`);
  });

  it('is isolated from the global decimal.js configuration', () => {
    const saved = { precision: Decimal.precision, rounding: Decimal.rounding };
    try {
      Decimal.set({ precision: 5, rounding: Decimal.ROUND_DOWN });
      expect(new EngineDecimal(2).div(3).toString()).toBe(
        `0.${'6'.repeat(DECIMAL_PRECISION - 1)}7`,
      );
    } finally {
      Decimal.set(saved);
    }
  });

  it('ignores a global configuration made before the engine loads', async () => {
    // Decimal.clone copies every unset option from the global constructor at load time.
    const saved = { minE: Decimal.minE, maxE: Decimal.maxE, modulo: Decimal.modulo };
    try {
      Decimal.set({ minE: -5, maxE: 5, modulo: Decimal.ROUND_DOWN });
      vi.resetModules();
      const fresh = await import('./decimal');
      expect(new fresh.EngineDecimal('1e-30').toString()).toBe(`0.${'0'.repeat(29)}1`);
      expect(new fresh.EngineDecimal('1e30').toString()).toBe(`1${'0'.repeat(30)}`);
      expect(new fresh.EngineDecimal(-7).mod(2).toString()).toBe('-1');
    } finally {
      Decimal.set(saved);
      vi.resetModules();
    }
  });

  it('never writes exponent notation', () => {
    expect(new EngineDecimal('1e-30').toString()).toBe(`0.${'0'.repeat(29)}1`);
    expect(new EngineDecimal('1e30').toString()).toBe(`1${'0'.repeat(30)}`);
  });
});

describe('decimalRounding (SPEC §1.3 table)', () => {
  it('maps every mode to its decimal.js constant', () => {
    expect(decimalRounding('half-up')).toBe(Decimal.ROUND_HALF_UP);
    expect(decimalRounding('half-even')).toBe(Decimal.ROUND_HALF_EVEN);
    expect(decimalRounding('ceil')).toBe(Decimal.ROUND_CEIL);
    expect(decimalRounding('floor')).toBe(Decimal.ROUND_FLOOR);
  });
});

describe('fromRational', () => {
  it('is exact for terminating values that fit', () => {
    expect(fromRational(rational(13n, 200n)).toString()).toBe('0.065');
    expect(fromRational(rational(12065n, 8n)).toString()).toBe('1508.125');
    expect(fromRational(fromInteger(10n ** 49n + 1n)).toString()).toBe(`1${'0'.repeat(48)}1`);
  });

  it('rounds other values to 50 significant digits', () => {
    expect(fromRational(rational(1n, 3n)).toString()).toBe(`0.${'3'.repeat(50)}`);
    expect(fromRational(rational(-2n, 3n)).toString()).toBe(`-0.${'6'.repeat(49)}7`);
    expect(fromRational(fromInteger(10n ** 60n + 1n)).toString()).toBe(`1${'0'.repeat(60)}`);
  });
});

describe('roundDecimalToInteger', () => {
  // value; half-up, half-even, ceil, floor.
  const table: readonly (readonly [string, bigint, bigint, bigint, bigint])[] = [
    ['2.5', 3n, 2n, 3n, 2n],
    ['-2.5', -3n, -2n, -2n, -3n],
    ['3.5', 4n, 4n, 4n, 3n],
    ['-3.5', -4n, -4n, -3n, -4n],
    ['0.5', 1n, 0n, 1n, 0n],
    ['-0.5', -1n, 0n, 0n, -1n],
    ['-0.4', 0n, 0n, 0n, -1n],
    ['2.4', 2n, 2n, 3n, 2n],
    ['-2.6', -3n, -3n, -2n, -3n],
    ['7', 7n, 7n, 7n, 7n],
    ['0', 0n, 0n, 0n, 0n],
  ];
  const modes: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];

  it.each(table)('%s rounds per mode', (text, ...expected) => {
    modes.forEach((mode, index) => {
      expect(roundDecimalToInteger(new EngineDecimal(text), mode)).toBe(expected[index]);
    });
  });

  it('keeps every digit of a 41-digit tie', () => {
    const tie = new EngineDecimal(`${'1'.repeat(40)}.5`);
    const below = BigInt('1'.repeat(40));
    expect(roundDecimalToInteger(tie, 'half-up')).toBe(below + 1n);
    expect(roundDecimalToInteger(tie, 'half-even')).toBe(below + 1n);
    expect(roundDecimalToInteger(tie, 'floor')).toBe(below);
  });
});

describe('decimalToExplainString (SPEC §9.6)', () => {
  it('writes 20 significant digits without trailing zeros', () => {
    expect(decimalToExplainString(new EngineDecimal(1).div(3))).toBe('0.33333333333333333333');
    expect(decimalToExplainString(new EngineDecimal(-2).div(3))).toBe('-0.66666666666666666667');
    expect(decimalToExplainString(new EngineDecimal('1508.125'))).toBe('1508.125');
    expect(decimalToExplainString(new EngineDecimal('2.500'))).toBe('2.5');
    expect(decimalToExplainString(new EngineDecimal('3.000'))).toBe('3');
  });

  it('keeps the zeros of an integer and never uses exponent notation', () => {
    expect(decimalToExplainString(new EngineDecimal(100))).toBe('100');
    expect(decimalToExplainString(new EngineDecimal(0))).toBe('0');
    expect(decimalToExplainString(new EngineDecimal('-0'))).toBe('0');
    expect(decimalToExplainString(new EngineDecimal('1e-30'))).toBe(`0.${'0'.repeat(29)}1`);
    expect(decimalToExplainString(new EngineDecimal('1.23456789012345678901234e30'))).toBe(
      `12345678901234567890${'0'.repeat(11)}`,
    );
  });

  it('agrees with the exact explanation of rationals', () => {
    for (const [n, d] of [
      [1n, 3n],
      [2n, 3n],
      [1n, 7n],
      [-22n, 7n],
      [13n, 200n],
    ] as const) {
      expect(decimalToExplainString(fromRational(rational(n, d)))).toBe(
        toExplainString(rational(n, d)),
      );
    }
  });
});

describe('decimalWithDigits and digitCount', () => {
  it('widens the precision by the extra digits, ignoring negative counts', () => {
    expect(decimalWithDigits().precision).toBe(DECIMAL_PRECISION + GUARD_DIGITS);
    expect(decimalWithDigits(5, 7).precision).toBe(DECIMAL_PRECISION + GUARD_DIGITS + 12);
    expect(decimalWithDigits(-3, 4).precision).toBe(DECIMAL_PRECISION + GUARD_DIGITS + 4);
  });

  it('counts the decimal digits of a bigint magnitude', () => {
    expect(digitCount(0n)).toBe(1);
    expect(digitCount(12345n)).toBe(5);
    expect(digitCount(-12345n)).toBe(5);
    expect(digitCount(10n ** 60n)).toBe(61);
  });
});
