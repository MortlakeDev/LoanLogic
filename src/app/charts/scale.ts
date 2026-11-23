// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Scales, axis ticks and label thinning for the chart card (DESIGN §8.11). Pure functions
 * over plain numbers: positions are geometry and may be floats, but every tick's text is an
 * exact decimal string built from integers, so an axis never reads "0.30000000000000004".
 */

/** Maps a domain value to a pixel position. */
export type LinearScale = (value: number) => number;

/**
 * A linear scale from `domain` to `range` (either may be reversed: an SVG y axis maps the
 * domain's minimum to the bottom pixel). A zero-width domain maps every value to the middle
 * of the range, so a degenerate series is drawn level instead of dividing by zero.
 *
 * @param domain Values at the two ends, `[d0, d1]`.
 * @param range Pixel positions of `d0` and `d1`.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const width = d1 - d0;
  if (width === 0) {
    const middle = (r0 + r1) / 2;
    return () => middle;
  }
  return (value) => r0 + ((value - d0) / width) * (r1 - r0);
}

/** One axis tick. */
export interface Tick {
  /** The tick's value, for positioning. */
  readonly value: number;
  /** The same value as an exact decimal string ("0.3", "-20000", "0"), for the label. */
  readonly text: string;
}

/** Nice ticks of an axis and the domain to draw. */
export interface NiceTicks {
  /** Ascending; the first and last are the domain's ends. */
  readonly ticks: readonly Tick[];
  /** `[first tick, last tick]`: covers the requested range. */
  readonly domain: readonly [number, number];
  /** The step, 1, 2 or 5 × 10^k, as an exact decimal string ("0.5", "5000"). */
  readonly step: string;
  /**
   * Fraction digits of the step (0 for steps ≥ 1). A compact label needs
   * `max(1, fractionDigits)` fraction digits to keep neighbouring ticks distinct.
   */
  readonly fractionDigits: number;
}

/**
 * Slack for rounding a value ÷ step to a tick index: an exact multiple divided in floats
 * can land a few ulps off the integer, so a bound that is a tick does not get another one.
 */
function slack(quotient: number): number {
  return Math.abs(quotient) * 1e-12;
}

/** The decimal string of `units` × 10^exponent, without trailing fraction zeros. */
function decimalText(units: bigint, exponent: number): string {
  if (exponent >= 0) {
    return (units * 10n ** BigInt(exponent)).toString();
  }
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(1 - exponent, '0');
  const whole = digits.slice(0, exponent);
  const fraction = digits.slice(exponent).replace(/0+$/u, '');
  const text = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

/**
 * Nice ticks for an axis covering `[min, max]`: multiples of a step of 1, 2 or 5 × 10^k,
 * the step nearest to `(max − min) / targetCount` (so the tick count is near the target,
 * not exactly it). The domain to draw runs from the last tick at or below `min` to the
 * first at or above `max`. Meant for chart ranges that include zero (every chart domain
 * does); a narrow range far from zero would need tick indices beyond float precision.
 *
 * A zero-width range is widened first: `[0, 0]` to `[0, 1]`, any other single value to
 * the range between it and zero.
 *
 * @param min Smallest value to cover.
 * @param max Largest value to cover; at least `min`.
 * @param targetCount Wanted number of intervals (≥ 1), e.g. 5 on wide charts, 3 on narrow.
 * @param minExponent The step is never below 10^minExponent; pass the currency's minor
 *   units negated (−2 for USD) so no tick falls between two minor units.
 * @throws RangeError for a non-finite bound, `min > max`, `targetCount < 1`, or a range
 *   so narrow that its step underflows (far below any currency's minor unit).
 */
export function niceTicks(
  min: number,
  max: number,
  targetCount: number,
  minExponent?: number,
): NiceTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`Not an axis range: [${String(min)}, ${String(max)}]`);
  }
  if (!(targetCount >= 1)) {
    throw new RangeError(`Not a tick count: ${String(targetCount)}`);
  }
  let low = min;
  let high = max;
  if (low === high) {
    if (low === 0) {
      high = 1;
    } else {
      low = Math.min(low, 0);
      high = Math.max(high, 0);
    }
  }
  const raw = (high - low) / targetCount;
  if (!(raw > 0)) {
    throw new RangeError(`Axis range too narrow: [${String(min)}, ${String(max)}]`);
  }
  // log10 may land a hair off near a power of ten; a mantissa just under 1 or 10 still
  // picks that power of ten as the step below.
  let exponent = Math.floor(Math.log10(raw));
  const mantissa = raw / 10 ** exponent;
  let digit: bigint;
  if (mantissa < 1.5) {
    digit = 1n;
  } else if (mantissa < 3) {
    digit = 2n;
  } else if (mantissa < 7) {
    digit = 5n;
  } else {
    digit = 1n;
    exponent += 1;
  }
  if (minExponent !== undefined && exponent < minExponent) {
    digit = 1n;
    exponent = minExponent;
  }
  const step = decimalText(digit, exponent);
  const stepValue = Number(step);
  const lowQuotient = low / stepValue;
  const highQuotient = high / stepValue;
  const first = Math.floor(lowQuotient + slack(lowQuotient));
  const last = Math.ceil(highQuotient - slack(highQuotient));
  const ticks: Tick[] = [];
  for (let index = first; index <= last; index += 1) {
    const text = decimalText(BigInt(index) * digit, exponent);
    ticks.push({ value: Number(text), text });
  }
  const start = ticks[0]?.value ?? 0;
  const end = ticks[ticks.length - 1]?.value ?? 0;
  return { ticks, domain: [start, end], step, fractionDigits: Math.max(0, -exponent) };
}

/** Whether a code point is drawn two columns wide (East Asian Wide and Fullwidth). */
export function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** Whether a code point takes no width: soft hyphen, zero-width spaces and joiners, marks. */
function isZeroWidth(codePoint: number): boolean {
  return (
    codePoint === 0xad ||
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0x2060 ||
    codePoint === 0xfeff
  );
}

/**
 * The estimated width of a label in the monospaced font (DESIGN §4.1): 0.6 em per
 * character, 1 em for wide CJK characters (Chinese uses system fonts), nothing for
 * invisible ones. Good enough to keep labels apart without measuring the DOM.
 *
 * @param text The label as shown.
 * @param fontPx Font size in CSS pixels (xs = 12).
 * @returns Width in CSS pixels.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  let ems = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    ems += isWide(codePoint) ? 1 : isZeroWidth(codePoint) ? 0 : 0.6;
  }
  return ems * fontPx;
}

/** The labelled numbers for a step: all for step 1, else 1 and every multiple of `step`. */
function labelsForStep(count: number, step: number): number[] {
  if (step === 1) {
    return Array.from({ length: count }, (_, position) => position + 1);
  }
  const labels = [1];
  for (let number = step; number <= count; number += step) {
    labels.push(number);
  }
  return labels;
}

/** Whether neighbouring labels keep at least `minGap` pixels between them. */
function labelsFit(
  labels: readonly number[],
  slot: number,
  labelWidth: (number: number) => number,
  minGap: number,
): boolean {
  for (let position = 1; position < labels.length; position += 1) {
    const left = labels[position - 1] ?? 0;
    const right = labels[position] ?? 0;
    if ((right - left) * slot < (labelWidth(left) + labelWidth(right)) / 2 + minGap) {
      return false;
    }
  }
  return true;
}

/**
 * The x-axis labels to show for evenly spaced buckets numbered 1…count: every bucket when
 * there are at most 10, otherwise 1, 5, 10, 15, …; then coarser (1, 10, 20, … ; 20; 25;
 * 50; 100; 200; 250; 500; …) until no two neighbouring labels can overlap.
 *
 * @param count Number of buckets.
 * @param plotWidth Width of the plot area in CSS pixels; each bucket gets an equal slot.
 * @param labelWidth Width in CSS pixels of the label of bucket number n (estimateTextWidth).
 * @param minGap Pixels to keep between two labels.
 * @returns The bucket numbers to label, ascending; `[1]` alone when no step fits.
 */
export function xLabelNumbers(
  count: number,
  plotWidth: number,
  labelWidth: (number: number) => number,
  minGap = 4,
): number[] {
  if (count < 1) {
    return [];
  }
  const slot = plotWidth / count;
  let candidate = count <= 10 ? 0 : 1;
  let labels = labelsForStep(count, stepAt(candidate));
  // Ends at the latest once the step exceeds `count`: a single label always fits.
  while (!labelsFit(labels, slot, labelWidth, minGap)) {
    candidate += 1;
    labels = labelsForStep(count, stepAt(candidate));
  }
  return labels;
}

const COARSER_STEPS = [10, 20, 25, 50] as const;

/** The n-th candidate label step: 1, 5, 10, 20, 25, 50, 100, 200, 250, 500, … */
function stepAt(candidate: number): number {
  if (candidate < 2) {
    return candidate === 0 ? 1 : 5;
  }
  const coarser = candidate - 2;
  return (COARSER_STEPS[coarser % 4] ?? 10) * 10 ** Math.floor(coarser / 4);
}
