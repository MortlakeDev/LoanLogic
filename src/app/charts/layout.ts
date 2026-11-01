// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The geometry of the chart card's SVG (DESIGN §8.11): its size from the container width,
 * the plot area, the y axis with nice ticks, the thinned x labels and the placement of
 * annotation labels. Pure functions in CSS pixels (no viewBox scaling, so text keeps its
 * size); the labels' text comes in through formatter callbacks, so every figure shown is
 * formatted from an exact decimal string.
 */

import type { ValueExtent } from './model';
import {
  type LinearScale,
  estimateTextWidth,
  isWide,
  linearScale,
  niceTicks,
  xLabelNumbers,
} from './scale';

/** The width drawn when the container cannot be measured (no ResizeObserver, or 0 in jsdom). */
export const FALLBACK_WIDTH = 640;

/** From this width on the chart is taller and has more y ticks (T04: fewer ticks below). */
export const WIDE_WIDTH = 640;

/** Narrower containers are drawn at this width (and clipped) rather than collapsing the plot. */
const MIN_WIDTH = 200;

/**
 * Axis and annotation labels: xs, 12 px at the default root size. The labels are sized in
 * rem, so they grow with the browser's font size; the chart measures their size and scales
 * the bands below with it (the sizes here are for 12 px labels).
 */
export const LABEL_PX = 12;

/**
 * The band above the plot that holds the annotation label. The top tick label is centred
 * on the plot's top edge and rises about 8 px into the band, under the left part of a
 * long annotation; the band keeps the label's text box (4–20 px from the top at xs) clear
 * of it. Each further line of a wrapped label adds a line height.
 */
const TOP_BAND = 30;

/** The annotation label's (last line's) baseline, in pixels above the plot's top edge. */
const ANNOTATION_RISE = 14;

/** Line height of a wrapped annotation label, in ems of the label. */
const LINE_EM = 1.25;

/** The band under the plot that holds the x labels, and their baseline below the plot. */
const BOTTOM_BAND = 24;
const X_LABEL_DROP = 16;

/** Space right of the plot: the last line point and its marker stay inside. */
const RIGHT_PAD = 12;

/** Space between the y tick labels and the plot. */
const TICK_GAP = 8;

/** Bars take this share of their column, up to `MAX_BAR` pixels. */
const BAR_SHARE = 0.64;
const MAX_BAR = 48;

/** A y-axis tick: pixel position and label. */
export interface YTick {
  readonly y: number;
  readonly text: string;
}

/** An x-axis label: centre position and text. */
export interface XLabel {
  readonly x: number;
  readonly text: string;
}

/** The chart's frame and axes. */
export interface ChartLayout {
  /** SVG size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Plot edges: x of the left and right edge, y of the top and bottom edge. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Width of one bucket's column. */
  readonly slot: number;
  readonly barWidth: number;
  /** Value → pixel y. */
  readonly y: LinearScale;
  readonly yTicks: readonly YTick[];
  readonly xLabels: readonly XLabel[];
  /** Font size of the axis and annotation labels in CSS pixels. */
  readonly labelPx: number;
  /** Baseline of the x labels. */
  readonly xLabelY: number;
  /** The annotation label's lines (none without a label), each fitting the SVG's width. */
  readonly annotationLines: readonly string[];
  /** Baseline of the annotation's first line; the next lines follow `lineHeight` apart. */
  readonly annotationY: number;
  readonly lineHeight: number;
}

/** What a layout needs. */
export interface LayoutInput {
  /** The measured container width in CSS pixels; 0 when unknown. */
  readonly width: number;
  /** Number of buckets (bars or line points), at least 1. */
  readonly count: number;
  /** The value range of the view (`valueExtent`). */
  readonly extent: ValueExtent;
  /** Digits of the currency's minor unit: no tick falls between two minor units. */
  readonly digits: number;
  /** `true` for the line views: point n at the end of column n, the origin at the left edge. */
  readonly points: boolean;
  /** The label of a tick from its exact decimal string (`moneyCompact`). */
  readonly tickText: (text: string, fractionDigits: number) => string;
  /** The label of bucket number n (1-based). */
  readonly xText: (number: number) => string;
  /** Font size of the labels as rendered, in CSS pixels; `LABEL_PX` when not given. */
  readonly labelPx?: number;
  /** The view's annotation label, if any: one wider than the SVG wraps onto more lines. */
  readonly annotation?: string | null;
}

/** The width to draw for a measured container width. */
export function chartWidth(measured: number): number {
  return measured > 0 ? Math.max(MIN_WIDTH, Math.floor(measured)) : FALLBACK_WIDTH;
}

/** Space between a mark and its label, and between a label and the SVG's edge. */
const LABEL_PAD = 4;
const EDGE = 2;

/** Between the bucket and the phrase of an annotation ("Year 21 · principal overtakes interest"). */
const LABEL_SEPARATOR = ' · ';

/**
 * The lines of a word too wide for one, broken only between two wide (CJK) characters:
 * Chinese has no spaces to wrap at. A word without such a break stays whole.
 */
function breakWide(word: string, fits: (line: string) => boolean): string[] {
  const lines: string[] = [];
  let line = '';
  let previousWide = false;
  for (const character of word) {
    const wide = isWide(character.codePointAt(0) ?? 0);
    if (previousWide && wide && !fits(line + character)) {
      lines.push(line);
      line = character;
    } else {
      line += character;
    }
    previousWide = wide;
  }
  lines.push(line);
  return lines;
}

/**
 * The lines of a label at most `maxWidth` pixels wide (estimated at `fontPx`): the label
 * itself when it fits; otherwise the bucket on the first line and the phrase after the
 * " · " wrapped at spaces. A word wider than `maxWidth` breaks between wide (CJK)
 * characters; one without such a break keeps a line of its own.
 */
export function wrapLabel(text: string, maxWidth: number, fontPx: number): string[] {
  const fits = (line: string): boolean => estimateTextWidth(line, fontPx) <= maxWidth;
  if (fits(text)) {
    return [text];
  }
  const cut = text.indexOf(LABEL_SEPARATOR);
  const parts = cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + LABEL_SEPARATOR.length)];
  const lines: string[] = [];
  for (const part of parts) {
    let line = '';
    for (const word of part.split(' ')) {
      const longer = line === '' ? word : `${line} ${word}`;
      if (line !== '' && !fits(longer)) {
        lines.push(line);
        line = word;
      } else {
        line = longer;
      }
      if (!fits(line)) {
        // Only a lone word can overflow here: a line of several words is pushed before it would.
        const pieces = breakWide(line, fits);
        line = pieces.pop() ?? '';
        lines.push(...pieces);
      }
    }
    lines.push(line);
  }
  return lines;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * The x of bucket n's mark (1-based): the bar's centre, or the line point at the end of
 * its column.
 */
export function bucketX(layout: ChartLayout, number: number, points: boolean): number {
  return layout.left + (points ? number : number - 0.5) * layout.slot;
}

/**
 * The frame, scales and axis labels of a chart: 240 px high from `WIDE_WIDTH` on (target 5
 * y intervals), 200 px below (target 3), with 12 px labels on one annotation line; the y
 * labels set the left margin; the x labels are thinned so they never overlap
 * (`xLabelNumbers`) and kept inside the SVG. The bands above and below the plot grow with
 * the label size and the annotation's lines, and the SVG grows with them: the plot keeps
 * its height, so large text never squeezes it away.
 */
export function chartLayout(input: LayoutInput): ChartLayout {
  const width = chartWidth(input.width);
  const wide = width >= WIDE_WIDTH;
  const plotHeight = (wide ? 240 : 200) - TOP_BAND - BOTTOM_BAND;
  const labelPx = input.labelPx ?? LABEL_PX;
  const scale = labelPx / LABEL_PX;
  const lineHeight = LINE_EM * labelPx;
  const annotationLines =
    input.annotation === undefined || input.annotation === null
      ? []
      : wrapLabel(input.annotation, width - 2 * EDGE, labelPx);
  const extraLines = Math.max(0, annotationLines.length - 1) * lineHeight;
  const ticks = niceTicks(input.extent.min, input.extent.max, wide ? 5 : 3, -input.digits);
  const fractionDigits = Math.max(1, ticks.fractionDigits);
  const labelled = ticks.ticks.map((tick) => ({
    value: tick.value,
    text: input.tickText(tick.text, fractionDigits),
  }));
  const labelWidth = Math.max(0, ...labelled.map((tick) => estimateTextWidth(tick.text, labelPx)));
  const left = Math.ceil(labelWidth) + TICK_GAP;
  const count = Math.max(1, input.count);
  // Room for half the last x label (the widest it can be): the label is thinned against its
  // neighbour at its centre, so it must not be pushed back inside the SVG onto it.
  const right = width - Math.max(RIGHT_PAD, estimateTextWidth(input.xText(count), labelPx) / 2);
  const top = TOP_BAND * scale + extraLines;
  const bottom = top + plotHeight;
  const height = bottom + BOTTOM_BAND * scale;
  const slot = (right - left) / count;
  const y = linearScale(ticks.domain, [bottom, top]);
  const frame = {
    width,
    height,
    left,
    right,
    top,
    bottom,
    slot,
    barWidth: Math.max(1, Math.min(slot * BAR_SHARE, MAX_BAR)),
    y,
    yTicks: labelled.map((tick) => ({ y: y(tick.value), text: tick.text })),
    xLabels: [],
    labelPx,
    xLabelY: bottom + X_LABEL_DROP * scale,
    annotationLines,
    annotationY: top - ANNOTATION_RISE * scale - extraLines,
    lineHeight,
  };
  const xLabels = xLabelNumbers(count, right - left, (number) =>
    estimateTextWidth(input.xText(number), labelPx),
  ).map((number): XLabel => {
    const text = input.xText(number);
    const half = estimateTextWidth(text, labelPx) / 2;
    return { x: clamp(bucketX(frame, number, input.points), half, width - half), text };
  });
  return { ...frame, xLabels };
}

/** Where a label goes beside a vertical mark (every line of a wrapped label shares it). */
export interface LabelPlacement {
  readonly x: number;
  readonly anchor: 'start' | 'end';
}

/**
 * Places a label of `textWidth` pixels beside a vertical mark at `x` on the side with more
 * room, so it stays inside an SVG `width` wide: right of the mark (anchor start) in the
 * left half, left of it (anchor end) in the right half. A label wider than that side is
 * pushed back inside, over the mark (it sits in the band above the plot, so it crosses no
 * line); one wider than the SVG starts at its left edge.
 */
export function placeLabel(x: number, textWidth: number, width: number): LabelPlacement {
  if (x < width / 2) {
    if (x + LABEL_PAD + textWidth <= width - EDGE) {
      return { x: x + LABEL_PAD, anchor: 'start' };
    }
  } else if (x - LABEL_PAD - textWidth >= EDGE) {
    return { x: x - LABEL_PAD, anchor: 'end' };
  }
  return { x: Math.max(EDGE, width - EDGE - textWidth), anchor: 'start' };
}

/** A box in chart pixels. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Pixels between a mark (with its focus ring) and its tooltip, at most. */
const TOOLTIP_GAP = 8;

/** The tooltip's top when it does not have to move off its mark. */
const TOOLTIP_TOP = 4;

/** How much of `[low, high]` the span `[from, to]` covers. */
function covered(from: number, to: number, low: number, high: number): number {
  return Math.max(0, Math.min(to, high) - Math.max(from, low));
}

/**
 * Where a mark's tooltip goes (its top left corner, in chart pixels). Beside the mark on
 * the side with more room, `TOOLTIP_GAP` away but never past the edge of the mark's column
 * (`column` is half its width), so the pointer moves from the mark onto the tooltip
 * without crossing another item (WCAG 1.4.13, hoverable); clamped inside the chart. When
 * the chart is too narrow and the box comes over the mark, it goes below the mark, else
 * where it covers the least of it (the usual top or the chart's bottom; a box that fits
 * above the mark already clears it at the usual top): the mark and its focus ring stay in
 * view.
 *
 * @param mark The mark's box with room for its focus ring.
 * @param box The tooltip's measured size.
 * @param chart The chart's size.
 */
export function placeTooltip(
  mark: Box,
  column: number,
  box: { readonly width: number; readonly height: number },
  chart: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const anchor = (mark.left + mark.right) / 2;
  const reach = Math.min(column, (mark.right - mark.left) / 2 + TOOLTIP_GAP);
  const preferred = anchor > chart.width / 2 ? anchor - reach - box.width : anchor + reach;
  const left = clamp(preferred, 0, chart.width - box.width);
  if (left >= mark.right || left + box.width <= mark.left) {
    return { left, top: TOOLTIP_TOP };
  }
  const candidates = [TOOLTIP_TOP, mark.bottom + TOOLTIP_GAP, chart.height - box.height];
  let top = TOOLTIP_TOP;
  let least = Infinity;
  for (const candidate of candidates) {
    if (candidate >= 0 && candidate + box.height <= chart.height) {
      const hidden = covered(candidate, candidate + box.height, mark.top, mark.bottom);
      if (hidden < least) {
        least = hidden;
        top = candidate;
      }
    }
  }
  return { left, top };
}

/** Rounds a coordinate to 0.01 px: enough for any screen, and a shorter path string. */
function px(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** An SVG path through points, in order: "M x0 y0 L x1 y1 …". */
export function linePath(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point.x)} ${px(point.y)}`)
    .join(' ');
}
