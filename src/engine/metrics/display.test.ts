// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  METHOD_PRECISION,
  NO_CONVERGENCE,
  buildMetric,
  formatNominalDisplay,
  formatRateDisplay,
  numberToExplainString,
} from './display';

const EXPLAIN = { formulaId: 'rate.annual-irr', values: { X: '0.1', timeBasis: 'periods' } };

describe('METHOD_PRECISION (SPEC §9.2–§9.3)', () => {
  it('shows generic metrics with 2, the US APR with 3 and the APRCs with 1 decimal', () => {
    expect(METHOD_PRECISION).toEqual({
      effective: 2,
      irrNominal: 2,
      irrEffective: 2,
      xirr: 2,
      usRegZApr: 3,
      ukAprc: 1,
      euAprc: 1,
      cnAnnualized: 2,
      uaRealAnnual: 2,
      international: 2,
    });
  });
});

describe('formatRateDisplay (SPEC §9.4)', () => {
  it('rounds half-up, ties away from zero', () => {
    expect(formatRateDisplay(0.125, 2)).toBe('0.13');
    expect(formatRateDisplay(-0.125, 2)).toBe('-0.13');
    expect(formatRateDisplay(6.9745, 3)).toBe('6.975');
    expect(formatRateDisplay(12.25, 1)).toBe('12.3');
    expect(formatRateDisplay(-12.25, 1)).toBe('-12.3');
  });

  it('rounds from the shortest decimal representation of the double', () => {
    // 1.005 is stored as 1.00499999999999989…; its shortest form "1.005" rounds up.
    expect(formatRateDisplay(1.005, 2)).toBe('1.01');
    expect(formatRateDisplay(391.07142857142856, 3)).toBe('391.071');
  });

  it('shows zero without a sign', () => {
    expect(formatRateDisplay(0, 2)).toBe('0.00');
    expect(formatRateDisplay(-0, 3)).toBe('0.000');
    expect(formatRateDisplay(-0.001, 2)).toBe('0.00');
    expect(formatRateDisplay(-4e-11, 1)).toBe('0.0');
    expect(formatRateDisplay(5e-15, 2)).toBe('0.00');
  });

  it('pads to the precision and never uses exponent notation', () => {
    expect(formatRateDisplay(5, 2)).toBe('5.00');
    expect(formatRateDisplay(1e-7, 3)).toBe('0.000');
    expect(formatRateDisplay(937881.4, 1)).toBe('937881.4');
    expect(formatRateDisplay(1e21, 2)).toBe('1000000000000000000000.00');
    expect(formatRateDisplay(2.5, 0)).toBe('3');
  });

  it('always has exactly `precision` decimals and never "-0"', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.integer({ min: 1, max: 4 }),
        (value, precision) => {
          const text = formatRateDisplay(value, precision);
          expect(text).toMatch(new RegExp(`^-?\\d+\\.\\d{${String(precision)}}$`));
          expect(text).not.toMatch(/^-0\.0+$/);
          expect(Math.abs(Number(text) - value)).toBeLessThanOrEqual(
            0.5 * 10 ** -precision * (1 + 1e-9) + Math.abs(value) * 1e-15,
          );
        },
      ),
    );
  });
});

describe('formatNominalDisplay (SPEC §9.2)', () => {
  it('shows the entered rate with at least two decimals', () => {
    expect(formatNominalDisplay('12')).toEqual({ display: '12.00', precision: 2 });
    expect(formatNominalDisplay('6.875')).toEqual({ display: '6.875', precision: 3 });
    expect(formatNominalDisplay('6.50')).toEqual({ display: '6.50', precision: 2 });
    expect(formatNominalDisplay('6.5')).toEqual({ display: '6.50', precision: 2 });
    expect(formatNominalDisplay('3.10')).toEqual({ display: '3.10', precision: 2 });
    expect(formatNominalDisplay('0.0001')).toEqual({ display: '0.0001', precision: 4 });
    expect(formatNominalDisplay('1000')).toEqual({ display: '1000.00', precision: 2 });
  });

  it('keeps the sign of negative rates and drops it from zero', () => {
    expect(formatNominalDisplay('-0.5')).toEqual({ display: '-0.50', precision: 2 });
    expect(formatNominalDisplay('-20')).toEqual({ display: '-20.00', precision: 2 });
    expect(formatNominalDisplay('-0')).toEqual({ display: '0.00', precision: 2 });
    expect(formatNominalDisplay('-0.000')).toEqual({ display: '0.000', precision: 3 });
    expect(formatNominalDisplay('0')).toEqual({ display: '0.00', precision: 2 });
  });

  it('rejects text that is not a plain decimal', () => {
    expect(() => formatNominalDisplay('1e3')).toThrow(RangeError);
    expect(() => formatNominalDisplay('6,5')).toThrow(RangeError);
    expect(() => formatNominalDisplay('')).toThrow(RangeError);
  });
});

describe('numberToExplainString (SPEC §9.6)', () => {
  it('prints the shortest round-trip digits in plain notation', () => {
    expect(numberToExplainString(0.1)).toBe('0.1');
    expect(numberToExplainString(0.065 / 12)).toBe(String(0.065 / 12));
    expect(numberToExplainString(0.065 / 12)).toBe('0.005416666666666667');
    expect(numberToExplainString(1e-15)).toBe('0.000000000000001');
    expect(numberToExplainString(-2.5e-7)).toBe('-0.00000025');
    expect(numberToExplainString(1e21)).toBe('1000000000000000000000');
    expect(numberToExplainString(12)).toBe('12');
  });

  it('prints negative zero as "0"', () => {
    expect(numberToExplainString(-0)).toBe('0');
    expect(numberToExplainString(0)).toBe('0');
  });

  it('round-trips every finite double', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const text = numberToExplainString(value);
        expect(text).toMatch(/^-?\d+(\.\d+)?$/);
        expect(Number(text)).toBe(value === 0 ? 0 : value);
      }),
    );
  });
});

describe('buildMetric', () => {
  it('builds value, display, precision and explanation', () => {
    expect(buildMetric(6.97421, 3, EXPLAIN)).toEqual({
      value: 6.97421,
      display: '6.974',
      precision: 3,
      explain: EXPLAIN,
    });
  });

  it('omits warnings unless the root was chosen among several', () => {
    expect('warnings' in buildMetric(5, 2, EXPLAIN)).toBe(false);
    expect(buildMetric(5, 2, EXPLAIN, true)).toEqual({
      value: 5,
      display: '5.00',
      precision: 2,
      warnings: ['IRR_MULTIPLE'],
      explain: EXPLAIN,
    });
  });

  it('fails a value beyond the range of doubles instead of substituting one', () => {
    expect(buildMetric(Number.POSITIVE_INFINITY, 2, EXPLAIN)).toBe(NO_CONVERGENCE);
    expect(buildMetric(Number.NaN, 2, EXPLAIN, true)).toBe(NO_CONVERGENCE);
    expect(NO_CONVERGENCE).toEqual({ ok: false, reason: 'IRR_NO_CONVERGENCE' });
  });
});
