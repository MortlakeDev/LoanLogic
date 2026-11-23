// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { estimateTextWidth, linearScale, niceTicks, xLabelNumbers } from './scale';

const texts = (min: number, max: number, target: number, minExponent?: number): string[] =>
  niceTicks(min, max, target, minExponent).ticks.map((tick) => tick.text);

describe('linearScale', () => {
  it('maps the domain onto the range, also reversed (an SVG y axis)', () => {
    const x = linearScale([0, 10], [20, 120]);
    expect(x(0)).toBe(20);
    expect(x(5)).toBe(70);
    expect(x(10)).toBe(120);
    const y = linearScale([-1000, 3000], [200, 0]);
    expect(y(-1000)).toBe(200);
    expect(y(0)).toBe(150);
    expect(y(3000)).toBe(0);
  });

  it('extrapolates outside the domain', () => {
    expect(linearScale([0, 10], [0, 100])(12)).toBe(120);
  });

  it('maps every value of a zero-width domain to the middle of the range', () => {
    const scale = linearScale([5, 5], [0, 200]);
    expect(scale(5)).toBe(100);
    expect(scale(-3)).toBe(100);
  });
});

describe('niceTicks', () => {
  it('covers a loan-year range with steps of 1, 2 or 5 × 10^k', () => {
    const result = niceTicks(0, 27591.25, 5);
    expect(result.ticks.map((tick) => tick.text)).toEqual([
      '0',
      '5000',
      '10000',
      '15000',
      '20000',
      '25000',
      '30000',
    ]);
    expect(result.domain).toEqual([0, 30000]);
    expect(result.step).toBe('5000');
    expect(result.fractionDigits).toBe(0);
  });

  it('gives fewer ticks for a smaller target count (narrow charts)', () => {
    expect(texts(0, 27591.25, 3)).toEqual(['0', '10000', '20000', '30000']);
  });

  it('writes decimal steps exactly, without float artifacts', () => {
    expect(texts(0, 0.9, 3)).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1']);
    expect(texts(0, 1, 10)).toEqual([
      '0',
      '0.1',
      '0.2',
      '0.3',
      '0.4',
      '0.5',
      '0.6',
      '0.7',
      '0.8',
      '0.9',
      '1',
    ]);
    expect(texts(0, 0.75, 3)).toEqual(['0', '0.2', '0.4', '0.6', '0.8']);
    expect(niceTicks(0, 0.75, 3).fractionDigits).toBe(1);
    expect(niceTicks(0, 1, 10).ticks[3]?.value).toBe(0.3);
  });

  it('handles tiny ranges', () => {
    const result = niceTicks(0, 0.0003, 3);
    expect(result.ticks.map((tick) => tick.text)).toEqual(['0', '0.0001', '0.0002', '0.0003']);
    expect(result.step).toBe('0.0001');
    expect(result.fractionDigits).toBe(4);
  });

  it('keeps the step at or above 10^minExponent (no tick between minor units)', () => {
    expect(texts(0, 0.03, 5, -2)).toEqual(['0', '0.01', '0.02', '0.03']);
    expect(texts(0, 3, 5, 0)).toEqual(['0', '1', '2', '3']);
    expect(niceTicks(0, 3, 5, 0).step).toBe('1');
    // A coarser step than the floor is left alone.
    expect(texts(0, 30000, 3, -2)).toEqual(['0', '10000', '20000', '30000']);
  });

  it('covers negative-only ranges', () => {
    const result = niceTicks(-2350, 0, 5);
    expect(result.ticks.map((tick) => tick.text)).toEqual([
      '-2500',
      '-2000',
      '-1500',
      '-1000',
      '-500',
      '0',
    ]);
    expect(result.domain).toEqual([-2500, 0]);
    expect(texts(-0.35, -0.05, 3)).toEqual(['-0.4', '-0.3', '-0.2', '-0.1', '0']);
  });

  it('covers mixed-sign ranges with zero as a tick', () => {
    const result = niceTicks(-1200, 27000, 5);
    expect(result.ticks.map((tick) => tick.text)).toEqual([
      '-5000',
      '0',
      '5000',
      '10000',
      '15000',
      '20000',
      '25000',
      '30000',
    ]);
    expect(result.domain).toEqual([-5000, 30000]);
  });

  it('widens a zero-width range: [0, 0] to [0, 1], a single value to zero', () => {
    expect(niceTicks(0, 0, 5).domain).toEqual([0, 1]);
    expect(texts(0, 0, 5)).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1']);
    expect(niceTicks(350000, 350000, 5).domain).toEqual([0, 400000]);
    expect(niceTicks(-40, -40, 4).domain).toEqual([-40, 0]);
  });

  it('does not add a tick past a bound that is itself a multiple of the step', () => {
    expect(texts(0, 1000, 5)).toEqual(['0', '200', '400', '600', '800', '1000']);
    expect(texts(-1000, 0, 2)).toEqual(['-1000', '-500', '0']);
  });

  it.each([
    [Number.NaN, 1, 5],
    [0, Number.POSITIVE_INFINITY, 5],
    [5, 1, 5],
    [0, 1, 0],
    [0, 1, Number.NaN],
    [0, Number.MIN_VALUE, 2],
  ])('rejects the range [%s, %s] with target %s', (min, max, target) => {
    expect(() => niceTicks(min, max, target)).toThrow(RangeError);
  });

  it('returns ascending exact multiples of the step that cover the range (property)', () => {
    // Money in minor units of four decimals (CLF), up to 10^11 major units; chart domains
    // always include zero.
    const bound = fc
      .bigInt({ min: -(10n ** 15n), max: 10n ** 15n })
      .map((units) => Number(units) / 10_000);
    fc.assert(
      fc.property(bound, bound, fc.integer({ min: 1, max: 10 }), (a, b, target) => {
        const min = Math.min(a, b, 0);
        const max = Math.max(a, b, 0);
        const result = niceTicks(min, max, target);
        expect(result.step).toMatch(/^(1|2|5)(0*|\.?)$|^0\.0*(1|2|5)$/u);
        const [start, end] = result.domain;
        expect(start).toBeLessThanOrEqual(min);
        expect(end).toBeGreaterThanOrEqual(max);
        expect(result.ticks.length).toBeGreaterThanOrEqual(2);
        expect(result.ticks.length).toBeLessThanOrEqual(2 * target + 3);
        result.ticks.forEach((tick, position) => {
          expect(tick.text).toMatch(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/u);
          expect(tick.value).toBe(Number(tick.text));
          if (position > 0) {
            expect(tick.value).toBeGreaterThan(result.ticks[position - 1]?.value ?? Infinity);
          }
        });
      }),
    );
  });
});

describe('estimateTextWidth', () => {
  it('counts 0.6 em per character of the monospaced font', () => {
    expect(estimateTextWidth('$30K', 12)).toBeCloseTo(28.8);
    expect(estimateTextWidth('', 12)).toBe(0);
    expect(estimateTextWidth('30 тыс. ₽', 10)).toBeCloseTo(54);
  });

  it('counts wide CJK characters as 1 em', () => {
    expect(estimateTextWidth('¥3万', 12)).toBeCloseTo(0.6 * 12 * 2 + 12);
    expect(estimateTextWidth('第9年', 10)).toBeCloseTo(26);
    expect(estimateTextWidth(String.fromCodePoint(0xff04, 0x20bb7), 10)).toBeCloseTo(20);
  });

  it('gives invisible characters no width', () => {
    const softHyphen = String.fromCodePoint(0xad);
    const zeroWidthSpace = String.fromCodePoint(0x200b);
    expect(estimateTextWidth(`ab${softHyphen}c${zeroWidthSpace}`, 10)).toBeCloseTo(18);
  });
});

describe('xLabelNumbers', () => {
  const width = (number: number): number => estimateTextWidth(String(number), 12);

  it('labels every bucket when there are at most 10 and they fit', () => {
    expect(xLabelNumbers(10, 600, width)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(xLabelNumbers(1, 600, width)).toEqual([1]);
  });

  it('labels 1, 5, 10, … for more than 10 buckets', () => {
    expect(xLabelNumbers(30, 800, width)).toEqual([1, 5, 10, 15, 20, 25, 30]);
    expect(xLabelNumbers(11, 800, width)).toEqual([1, 5, 10]);
  });

  it('thins further until neighbouring labels cannot overlap', () => {
    // 100 buckets over 300 px: 3 px per bucket.
    expect(xLabelNumbers(30, 120, width)).toEqual([1, 5, 10, 15, 20, 25, 30]);
    expect(xLabelNumbers(30, 60, width)).toEqual([1, 10, 20, 30]);
    expect(xLabelNumbers(30, 40, width)).toEqual([1, 20]);
    expect(xLabelNumbers(100, 300, width)).toEqual([1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(xLabelNumbers(100, 150, width)).toEqual([1, 20, 40, 60, 80, 100]);
    expect(xLabelNumbers(100, 100, width)).toEqual([1, 25, 50, 75, 100]);
    // Ten narrow buckets fall back to 1, 5, 10.
    expect(xLabelNumbers(10, 60, width)).toEqual([1, 5, 10]);
  });

  it('steps through 100, 200, 250, 500, 1000, … for long axes', () => {
    expect(xLabelNumbers(1200, 300, width)).toEqual([1, 200, 400, 600, 800, 1000, 1200]);
    expect(xLabelNumbers(1200, 120, width)).toEqual([1, 500, 1000]);
    expect(xLabelNumbers(1200, 60, width)).toEqual([1, 1000]);
    expect(xLabelNumbers(1200, 1, width)).toEqual([1]);
  });

  it('keeps labels apart for any count and width (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1500 }),
        fc.integer({ min: 40, max: 2000 }),
        (count, plotWidth) => {
          const labels = xLabelNumbers(count, plotWidth, width);
          expect(labels[0]).toBe(1);
          const slot = plotWidth / count;
          for (let position = 1; position < labels.length; position += 1) {
            const left = labels[position - 1] ?? 0;
            const right = labels[position] ?? 0;
            expect(right).toBeLessThanOrEqual(count);
            expect((right - left) * slot).toBeGreaterThanOrEqual(
              (width(left) + width(right)) / 2 + 4,
            );
          }
        },
      ),
    );
  });

  it('returns no labels for no buckets', () => {
    expect(xLabelNumbers(0, 600, width)).toEqual([]);
  });
});
