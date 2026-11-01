// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import {
  type LayoutInput,
  FALLBACK_WIDTH,
  LABEL_PX,
  bucketX,
  chartLayout,
  chartWidth,
  linePath,
  placeLabel,
  placeTooltip,
  wrapLabel,
} from './layout';
import { estimateTextWidth } from './scale';

/** A plain tick label ("30000" → "$30000") and x label, enough to check the geometry. */
function input(patch: Partial<LayoutInput> = {}): LayoutInput {
  return {
    width: 640,
    count: 30,
    extent: { min: 0, max: 27591 },
    digits: 2,
    points: false,
    tickText: (text) => `$${text}`,
    xText: (number) => String(number),
    ...patch,
  };
}

describe('chartWidth', () => {
  it('falls back to 640 px when the container is not measured', () => {
    expect(chartWidth(0)).toBe(FALLBACK_WIDTH);
    expect(chartWidth(-1)).toBe(FALLBACK_WIDTH);
  });

  it('draws whole pixels and never narrower than 200 px', () => {
    expect(chartWidth(359.7)).toBe(359);
    expect(chartWidth(1280)).toBe(1280);
    expect(chartWidth(120)).toBe(200);
  });
});

describe('chartLayout', () => {
  it('is 240 px high with about 5 y intervals from 640 px, 200 px with about 3 below', () => {
    const wide = chartLayout(input({ width: 640 }));
    const narrow = chartLayout(input({ width: 639 }));
    expect([wide.width, wide.height]).toEqual([640, 240]);
    expect([narrow.width, narrow.height]).toEqual([639, 200]);
    expect(wide.yTicks.map((tick) => tick.text)).toEqual([
      '$0',
      '$5000',
      '$10000',
      '$15000',
      '$20000',
      '$25000',
      '$30000',
    ]);
    expect(narrow.yTicks.map((tick) => tick.text)).toEqual(['$0', '$10000', '$20000', '$30000']);
  });

  it('runs the y axis from the plot bottom (lowest tick) to the plot top (highest)', () => {
    const layout = chartLayout(input());
    expect(layout.yTicks[0]?.y).toBe(layout.bottom);
    expect(layout.yTicks.at(-1)?.y).toBe(layout.top);
    expect(layout.y(0)).toBe(layout.bottom);
    expect(layout.y(30000)).toBe(layout.top);
  });

  it('leaves room left of the plot for the widest y label', () => {
    const layout = chartLayout(input({ tickText: (text) => `USD ${text}` }));
    const widest = Math.max(...layout.yTicks.map((tick) => estimateTextWidth(tick.text, LABEL_PX)));
    expect(layout.left).toBe(Math.ceil(widest) + 8);
  });

  it('passes the tick fraction digits (at least 1) to the label formatter', () => {
    const digits: number[] = [];
    chartLayout(
      input({
        extent: { min: 0, max: 0.05 },
        tickText: (text, fractionDigits) => {
          digits.push(fractionDigits);
          return text;
        },
      }),
    );
    expect(new Set(digits)).toEqual(new Set([2]));
    digits.length = 0;
    chartLayout(
      input({
        tickText: (text, fractionDigits) => {
          digits.push(fractionDigits);
          return text;
        },
      }),
    );
    expect(new Set(digits)).toEqual(new Set([1]));
  });

  it('covers negative values with the baseline inside the plot', () => {
    const layout = chartLayout(input({ extent: { min: -600, max: 2600 } }));
    expect(layout.y(0)).toBeGreaterThan(layout.top);
    expect(layout.y(0)).toBeLessThan(layout.bottom);
    expect(layout.yTicks[0]?.text).toBe('$-1000');
  });

  it('splits the plot into equal columns and centres the bars in them', () => {
    const layout = chartLayout(input({ count: 4 }));
    expect(layout.slot).toBeCloseTo((layout.right - layout.left) / 4, 10);
    expect(bucketX(layout, 1, false)).toBeCloseTo(layout.left + layout.slot / 2, 10);
    expect(bucketX(layout, 4, false)).toBeCloseTo(layout.right - layout.slot / 2, 10);
    expect(layout.barWidth).toBe(48);
  });

  it('puts line points at the column ends, the origin on the left edge', () => {
    const layout = chartLayout(input({ count: 4, points: true }));
    expect(bucketX(layout, 0, true)).toBe(layout.left);
    expect(bucketX(layout, 4, true)).toBeCloseTo(layout.right, 10);
  });

  it('labels every bucket of a short loan and thins the labels of a long one', () => {
    expect(chartLayout(input({ count: 10 })).xLabels.map((label) => label.text)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(
      chartLayout(input({ width: 1280, count: 30 })).xLabels.map((label) => label.text),
    ).toEqual(['1', '5', '10', '15', '20', '25', '30']);
    const crowded = chartLayout(input({ width: 360, count: 100 })).xLabels;
    expect(crowded.length).toBeLessThan(21);
    expect(crowded[0]?.text).toBe('1');
  });

  it.each([360, 640, 1280])('keeps bars and labels inside a %i px SVG', (width) => {
    for (const count of [1, 3, 12, 30, 100, 103]) {
      for (const points of [false, true]) {
        const layout = chartLayout(input({ width, count, points }));
        const half = layout.barWidth / 2;
        expect(bucketX(layout, 1, points) - (points ? 0 : half)).toBeGreaterThanOrEqual(0);
        expect(bucketX(layout, count, points) + (points ? 0 : half)).toBeLessThanOrEqual(width);
        let previousEnd = -Infinity;
        for (const label of layout.xLabels) {
          const labelWidth = estimateTextWidth(label.text, LABEL_PX);
          expect(label.x - labelWidth / 2).toBeGreaterThanOrEqual(0);
          expect(label.x + labelWidth / 2).toBeLessThanOrEqual(width);
          expect(label.x - labelWidth / 2).toBeGreaterThan(previousEnd);
          previousEnd = label.x + labelWidth / 2;
        }
      }
    }
  });
});

describe('the label size', () => {
  it('sizes the margins, the bands and the x label thinning for the rendered label size', () => {
    // A 20 px browser font: xs is 15 px.
    const base = chartLayout(input({ width: 360, count: 100 }));
    const large = chartLayout(input({ width: 360, count: 100, labelPx: 15 }));
    expect(base.labelPx).toBe(LABEL_PX);
    expect(large.labelPx).toBe(15);
    const widest = Math.max(...large.yTicks.map((tick) => estimateTextWidth(tick.text, 15)));
    expect(large.left).toBe(Math.ceil(widest) + 8);
    expect(large.left).toBeGreaterThan(base.left);
    expect(large.top).toBe(37.5);
    // The plot keeps its height; the SVG grows by the larger bands.
    expect(large.bottom).toBe(37.5 + 146);
    expect(large.height).toBe(large.bottom + 30);
    expect(large.xLabelY).toBe(large.bottom + 20);
    expect(base.xLabelY).toBe(base.bottom + 16);
    // The y labels end 6 px left of the plot and start inside the SVG.
    expect(large.left - 6 - widest).toBeGreaterThanOrEqual(0);
    let previousEnd = -Infinity;
    for (const label of large.xLabels) {
      const half = estimateTextWidth(label.text, 15) / 2;
      expect(label.x - half).toBeGreaterThan(previousEnd);
      previousEnd = label.x + half;
    }
    expect(large.xLabels.length).toBeLessThanOrEqual(base.xLabels.length);
  });

  it('keeps the plot height at 200% text with a wrapped annotation: the SVG grows', () => {
    const annotation = 'Year 21 · principal overtakes interest';
    const base = chartLayout(input({ width: 232 }));
    const large = chartLayout(input({ width: 232, labelPx: 24, annotation }));
    expect(base.height).toBe(200);
    expect(large.annotationLines.length).toBeGreaterThan(1);
    expect(large.bottom - large.top).toBe(base.bottom - base.top);
    expect(large.height).toBe(large.bottom + 48);
  });

  it('keeps the last x label off its neighbour at a large label size', () => {
    // A line view of 100 years at 200% text, with compact tick labels ("$400K").
    const layout = chartLayout(
      input({
        width: 307,
        count: 100,
        points: true,
        labelPx: 24,
        extent: { min: 0, max: 350000 },
        tickText: (text) => `$${String(Number(text) / 1000)}K`,
      }),
    );
    expect(layout.xLabels.length).toBeGreaterThan(1);
    let previousEnd = -Infinity;
    for (const label of layout.xLabels) {
      const half = estimateTextWidth(label.text, 24) / 2;
      expect(label.x - half).toBeGreaterThan(previousEnd);
      expect(label.x + half).toBeLessThanOrEqual(307);
      previousEnd = label.x + half;
    }
  });
});

describe('the annotation band', () => {
  it.each([LABEL_PX, 15])(
    "keeps the annotation label's text box above the top tick label's at %i px",
    (labelPx) => {
      const layout = chartLayout(input({ width: 360, labelPx, annotation: 'Year 21 · x' }));
      const baseline = layout.annotationY;
      expect(layout.annotationLines).toEqual(['Year 21 · x']);
      // Text boxes: an em above the baseline and a third of an em below; the top tick
      // label's box (an em and a third tall) is centred on the plot's top edge.
      expect(baseline - labelPx).toBeGreaterThanOrEqual(0);
      expect(baseline + labelPx / 3).toBeLessThanOrEqual(layout.top - (2 / 3) * labelPx);
    },
  );

  it('wraps a label wider than the SVG and makes the band taller by its extra lines', () => {
    const text = 'Платёж № 12 · основного долга выплачено больше, чем процентов';
    const one = chartLayout(input({ width: 360, annotation: 'Payment 12 · short' }));
    const wrapped = chartLayout(input({ width: 360, annotation: text }));
    expect(wrapped.annotationLines.length).toBeGreaterThan(1);
    expect(wrapped.annotationLines[0]).toBe('Платёж № 12');
    for (const line of wrapped.annotationLines) {
      expect(estimateTextWidth(line, LABEL_PX)).toBeLessThanOrEqual(360 - 4);
    }
    const extra = (wrapped.annotationLines.length - 1) * wrapped.lineHeight;
    expect(wrapped.top).toBeCloseTo(one.top + extra, 10);
    expect(wrapped.annotationY).toBeCloseTo(one.annotationY, 10);
    // The last line keeps the one-line label's baseline above the plot.
    expect(wrapped.annotationY + extra).toBeCloseTo(wrapped.top - (one.top - one.annotationY), 10);
    expect(chartLayout(input({ width: 1280, annotation: text })).annotationLines).toEqual([text]);
    expect(chartLayout(input({ width: 360 })).annotationLines).toEqual([]);
  });
});

describe('wrapLabel', () => {
  it('keeps a label that fits on one line', () => {
    expect(wrapLabel('Year 21 · principal overtakes interest', 300, 12)).toEqual([
      'Year 21 · principal overtakes interest',
    ]);
  });

  it('puts the bucket on its own line and wraps the phrase at spaces', () => {
    // 0.6 em per character at 10 px: 6 px each, so 10 characters fit in 60 px.
    expect(wrapLabel('Year 1 · aaaa bbbb cccc', 60, 10)).toEqual(['Year 1', 'aaaa bbbb', 'cccc']);
    expect(wrapLabel('Year 1 · aaaaaaaaaaaaaa b', 60, 10)).toEqual([
      'Year 1',
      'aaaaaaaaaaaaaa',
      'b',
    ]);
    expect(wrapLabel('aaaa bbbb cccc', 60, 10)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('breaks a Chinese phrase, which has no spaces, between its characters', () => {
    const lines = wrapLabel('第 24 年 · 累计本金超过累计利息', 228, 24);
    expect(lines[0]).toBe('第 24 年');
    expect(lines.join('')).toBe('第 24 年累计本金超过累计利息');
    for (const line of lines) {
      expect(estimateTextWidth(line, 24)).toBeLessThanOrEqual(228);
    }
  });
});

describe('placeTooltip', () => {
  const chart = { width: 1280, height: 240 };
  const box = { width: 200, height: 100 };

  it('sits beside the mark on the side with more room, never past its column', () => {
    const mark = { left: 100, right: 120, top: 150, bottom: 216 };
    // A narrow column: the box starts at its edge.
    expect(placeTooltip(mark, 15, box, chart)).toEqual({ left: 125, top: 4 });
    // A wide column: the box keeps 8 px from the mark.
    expect(placeTooltip(mark, 100, box, chart)).toEqual({ left: 128, top: 4 });
    const right = { left: 1100, right: 1120, top: 150, bottom: 216 };
    expect(placeTooltip(right, 15, box, chart)).toEqual({ left: 1110 - 15 - 200, top: 4 });
  });

  it('moves below or above a mark it would cover in a narrow chart, else covers it least', () => {
    const narrow = { width: 300, height: 200 };
    const tall = { width: 200, height: 74 };
    // Clamped inside the chart, the box comes over a balance point high up: it goes below.
    expect(placeTooltip({ left: 92, right: 110, top: 50, bottom: 68 }, 5, tall, narrow)).toEqual({
      left: 100,
      top: 76,
    });
    // A point low enough for the usual top.
    expect(placeTooltip({ left: 92, right: 110, top: 90, bottom: 108 }, 5, tall, narrow)).toEqual({
      left: 100,
      top: 4,
    });
    // Two points with no room above or below them for this box: where it covers least.
    const big = { width: 200, height: 120 };
    expect(placeTooltip({ left: 92, right: 110, top: 60, bottom: 100 }, 5, big, narrow)).toEqual({
      left: 100,
      top: 80,
    });
    // Off the mark horizontally: the usual top.
    expect(placeTooltip({ left: 10, right: 28, top: 50, bottom: 68 }, 20, tall, narrow)).toEqual({
      left: 36,
      top: 4,
    });
  });
});

describe('placeLabel', () => {
  it('puts the label right of a mark in the left half, left of it in the right half', () => {
    expect(placeLabel(100, 80, 640)).toEqual({ x: 104, anchor: 'start' });
    expect(placeLabel(500, 80, 640)).toEqual({ x: 496, anchor: 'end' });
  });

  it('uses the whole side up to the edge', () => {
    expect(placeLabel(300, 334, 640)).toEqual({ x: 304, anchor: 'start' });
    expect(placeLabel(340, 334, 640)).toEqual({ x: 336, anchor: 'end' });
  });

  it('pushes a label wider than its side back inside, over the mark', () => {
    expect(placeLabel(100, 300, 360)).toEqual({ x: 58, anchor: 'start' });
    expect(placeLabel(250, 300, 360)).toEqual({ x: 58, anchor: 'start' });
    expect(placeLabel(180, 400, 360)).toEqual({ x: 2, anchor: 'start' });
  });
});

describe('linePath', () => {
  it('draws through the points in order, rounded to 0.01 px', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 10.123, y: 5.678 },
        { x: 20, y: 0 },
      ]),
    ).toBe('M0 10 L10.12 5.68 L20 0');
    expect(linePath([])).toBe('');
  });
});
