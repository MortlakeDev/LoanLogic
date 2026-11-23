// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The data of the chart card (DESIGN §8.11): the schedule grouped into buckets (loan years,
 * or single payments for loans shorter than 2 years) with exact sums, the annotations
 * (principal overtakes interest, cumulative crossing), the diverging stack of a bar and
 * the value range of each view. Pure functions over the engine's decimal strings: every
 * figure shown as text is an exact sum of the ledger (BigInt minor units); only positions
 * are floats.
 */

import type { FrequencyId, LedgerRow } from '../../engine';
import { fromMinor, periodsPerYear, scheduleYears, sumMoney, toMinor } from '../state/derived';

/** The views of the chart card; `bars` is the default. */
export type ChartView = 'bars' | 'balance' | 'cumulative';

/** The views in the order of the view switch. */
export const CHART_VIEWS: readonly ChartView[] = ['bars', 'balance', 'cumulative'];

/** What one bucket (bar, line point) stands for. */
export type ChartUnit = 'year' | 'payment';

/** A series of a view, named in its legend, tooltip and table. */
export type SeriesKey =
  'principal' | 'fees' | 'interest' | 'balance' | 'cumulativePrincipal' | 'cumulativeInterest';

/** A segment of the stacked bars: principal, fees and insurance, interest. */
export type StackKey = 'principal' | 'fees' | 'interest';

/** One bar or line point: a loan year or a single payment. Money as engine strings. */
export interface ChartBucket {
  /**
   * The label number, 1-based: the loan year (unit `year`: payments (y − 1)·m + 1 … y·m)
   * or the payment number (unit `payment`). Always the bucket's position + 1.
   */
  readonly index: number;
  /** Dates of the bucket's first and last payment (YYYY-MM-DD); equal for a payment. */
  readonly firstDate: string;
  readonly lastDate: string;
  /** Exact sums of the bucket's rows: principal, interest paid, fees + insurance, payment. */
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly total: string;
  /** The balance after the bucket's last payment. */
  readonly closing: string;
  /** The engine's running totals after the bucket's last payment. */
  readonly cumulativePrincipal: string;
  readonly cumulativeInterest: string;
}

/** The start of the line views, before the first payment (x = 0): drawn, never focused. */
export interface ChartOrigin {
  /** The first row's opening balance. */
  readonly balance: string;
  /** Zero, at the currency's minor units. */
  readonly cumulativePrincipal: string;
  readonly cumulativeInterest: string;
}

/** The chart data of a schedule. */
export interface ChartData {
  readonly unit: ChartUnit;
  /** Payments per year `m` of the frequency. */
  readonly periodsPerYear: number;
  /** Consecutive buckets from 1. */
  readonly buckets: readonly ChartBucket[];
  readonly origin: ChartOrigin;
  /** Whether any bucket has fees or insurance: the bars then get a third segment. */
  readonly hasFees: boolean;
}

/** One payment as a bucket. */
function paymentBucket(row: LedgerRow, minorUnits: number): ChartBucket {
  return {
    index: row.index,
    firstDate: row.date,
    lastDate: row.date,
    principal: row.principal,
    interest: row.interestPaid,
    fees: sumMoney([row.fees, row.insurance], minorUnits),
    total: row.payment,
    closing: row.closing,
    cumulativePrincipal: row.cumulativePrincipal,
    cumulativeInterest: row.cumulativeInterest,
  };
}

/**
 * Groups a schedule into chart buckets: loan years (DESIGN §8.10) when it has at least
 * 2·m payments, otherwise one bucket per payment ("Payment N").
 *
 * @param rows The engine's ledger rows.
 * @param frequency The payment frequency (gives m).
 * @param minorUnits Digits of the currency's minor unit.
 * @throws RangeError without rows: a computed loan always has at least one payment.
 */
export function chartBuckets(
  rows: readonly LedgerRow[],
  frequency: FrequencyId,
  minorUnits: number,
): ChartData {
  const first = rows[0];
  if (first === undefined) {
    throw new RangeError('A computed loan has at least one payment');
  }
  const m = periodsPerYear(frequency);
  const unit: ChartUnit = rows.length >= 2 * m ? 'year' : 'payment';
  const buckets =
    unit === 'payment'
      ? rows.map((row) => paymentBucket(row, minorUnits))
      : scheduleYears(rows, frequency, minorUnits).map((year): ChartBucket => {
          const last = year.rows[year.rows.length - 1] ?? first;
          return {
            index: year.year,
            firstDate: year.firstDate,
            lastDate: year.lastDate,
            principal: year.principal,
            interest: year.interest,
            fees: sumMoney([year.fees, year.insurance], minorUnits),
            total: year.payment,
            closing: year.closing,
            cumulativePrincipal: last.cumulativePrincipal,
            cumulativeInterest: last.cumulativeInterest,
          };
        });
  const zero = fromMinor(0n, minorUnits);
  return {
    unit,
    periodsPerYear: m,
    buckets,
    origin: { balance: first.opening, cumulativePrincipal: zero, cumulativeInterest: zero },
    hasFees: buckets.some((bucket) => toMinor(bucket.fees, minorUnits) !== 0n),
  };
}

/**
 * The position of the first bucket whose principal exceeds its interest (exact compare),
 * for the annotation "Year 21 · principal overtakes interest"; the first bucket counts.
 *
 * @returns A position in `buckets` (the label is `buckets[position].index`), or `null`.
 */
export function principalOvertakes(
  buckets: readonly ChartBucket[],
  minorUnits: number,
): number | null {
  const position = buckets.findIndex(
    (bucket) => toMinor(bucket.principal, minorUnits) > toMinor(bucket.interest, minorUnits),
  );
  return position === -1 ? null : position;
}

/**
 * The position of the first bucket where the principal paid so far passes the interest
 * paid so far, after an earlier bucket where interest was ahead (exact compare). A loan
 * whose principal leads from the start (low or zero rate), or whose interest stays ahead,
 * has no crossing.
 *
 * @returns A position in `buckets`, or `null`.
 */
export function cumulativeCrossing(
  buckets: readonly ChartBucket[],
  minorUnits: number,
): number | null {
  let interestAhead = false;
  for (const [position, bucket] of buckets.entries()) {
    const principal = toMinor(bucket.cumulativePrincipal, minorUnits);
    const interest = toMinor(bucket.cumulativeInterest, minorUnits);
    if (interestAhead && principal > interest) {
      return position;
    }
    interestAhead ||= interest > principal;
  }
  return null;
}

/** The segments of the bars in stack order, bottom to top; fees only when `hasFees`. */
export function stackKeys(hasFees: boolean): readonly StackKey[] {
  return hasFees ? ['principal', 'fees', 'interest'] : ['principal', 'interest'];
}

/** The series of a view in legend order (for the bars: stack order). */
export function seriesOf(view: ChartView, hasFees: boolean): readonly SeriesKey[] {
  switch (view) {
    case 'bars':
      return stackKeys(hasFees);
    case 'balance':
      return ['balance'];
    case 'cumulative':
      return ['cumulativePrincipal', 'cumulativeInterest'];
  }
}

/** A segment of a stacked bar in value space. */
export interface StackPart {
  readonly key: StackKey;
  /** The segment's exact amount (engine string); negative for a downward segment. */
  readonly value: string;
  /** Value at the segment's end nearer zero, and at its far end (`to < from` downwards). */
  readonly from: number;
  readonly to: number;
}

/**
 * The diverging stack of a bar: positive segments stack up from zero and negative ones
 * (the negative principal of an exact-basis loan, negative interest) down from zero, each
 * direction in the order principal, fees and insurance, interest, so interest is always the
 * outer segment. Zero segments are left out; fees only count when `hasFees`.
 */
export function stackBar(
  bucket: ChartBucket,
  hasFees: boolean,
  minorUnits: number,
): readonly StackPart[] {
  let up = 0n;
  let down = 0n;
  const parts: StackPart[] = [];
  for (const key of stackKeys(hasFees)) {
    const units = toMinor(bucket[key], minorUnits);
    if (units === 0n) {
      continue;
    }
    const start = units > 0n ? up : down;
    const end = start + units;
    if (units > 0n) {
      up = end;
    } else {
      down = end;
    }
    parts.push({
      key,
      value: bucket[key],
      from: Number(fromMinor(start, minorUnits)),
      to: Number(fromMinor(end, minorUnits)),
    });
  }
  return parts;
}

/** A drawn bar segment in pixels. */
export interface BarRect {
  readonly key: StackKey;
  /** The segment's exact amount (engine string). */
  readonly value: string;
  /** Top edge and height in CSS pixels. */
  readonly y: number;
  readonly height: number;
}

/**
 * The rectangles of a stacked bar: each segment after the first of its direction leaves
 * `gap` pixels towards the previous one (DESIGN §8.11: 2 px). A segment thinner than
 * `minHeight` is drawn `minHeight` tall, and the segments beyond it start after it (they
 * lose those pixels, so the stack's outer end stays at its value unless the outermost
 * segment is the thin one). With `minHeight` 0 a segment thinner than the gap is not drawn
 * (the tooltip and table still show it).
 *
 * @param parts From `stackBar`.
 * @param y The y scale (value → pixel; larger values higher, i.e. smaller pixels).
 * @param gap Pixels between neighbouring segments.
 * @param minHeight The least height in pixels of a drawn segment, so a small fee stays
 *   visible next to its legend entry.
 */
export function barRects(
  parts: readonly StackPart[],
  y: (value: number) => number,
  gap = 2,
  minHeight = 0,
): BarRect[] {
  const rects: BarRect[] = [];
  // Pixel y where the last drawn segment of each direction ends (its outer edge).
  let upEdge: number | undefined;
  let downEdge: number | undefined;
  for (const part of parts) {
    const upward = part.to > part.from;
    const previous = upward ? upEdge : downEdge;
    let inner = y(part.from);
    if (previous !== undefined) {
      inner = upward ? Math.min(inner, previous) - gap : Math.max(inner, previous) + gap;
    }
    let outer = y(part.to);
    if ((upward ? inner - outer : outer - inner) < minHeight) {
      outer = upward ? inner - minHeight : inner + minHeight;
    }
    const height = upward ? inner - outer : outer - inner;
    if (height > 0) {
      rects.push({ key: part.key, value: part.value, y: upward ? outer : inner, height });
      if (upward) {
        upEdge = outer;
      } else {
        downEdge = outer;
      }
    }
  }
  return rects;
}

/** A line series of the balance or cumulative view. */
export interface LineSeries {
  readonly key: SeriesKey;
  /** Point values (engine strings): `values[0]` is the origin, `values[i]` bucket i − 1. */
  readonly values: readonly string[];
}

/** The lines of a line view, each starting at the origin. */
export function lineSeries(
  data: ChartData,
  view: Exclude<ChartView, 'bars'>,
): readonly LineSeries[] {
  const { origin, buckets } = data;
  if (view === 'balance') {
    return [
      { key: 'balance', values: [origin.balance, ...buckets.map((bucket) => bucket.closing)] },
    ];
  }
  return [
    {
      key: 'cumulativePrincipal',
      values: [origin.cumulativePrincipal, ...buckets.map((bucket) => bucket.cumulativePrincipal)],
    },
    {
      key: 'cumulativeInterest',
      values: [origin.cumulativeInterest, ...buckets.map((bucket) => bucket.cumulativeInterest)],
    },
  ];
}

/** The value range a view draws, for `niceTicks`; always includes zero. */
export interface ValueExtent {
  readonly min: number;
  readonly max: number;
}

/**
 * The value range of a view, for `niceTicks`: the stacks' outer ends for the bars, every
 * point (origin included) for the line views, and zero.
 */
export function valueExtent(data: ChartData, view: ChartView, minorUnits: number): ValueExtent {
  const values =
    view === 'bars'
      ? data.buckets.flatMap((bucket) =>
          stackBar(bucket, data.hasFees, minorUnits).map((part) => part.to),
        )
      : lineSeries(data, view).flatMap((series) => series.values.map(Number));
  return values.reduce(
    (extent, value) => ({ min: Math.min(extent.min, value), max: Math.max(extent.max, value) }),
    { min: 0, max: 0 },
  );
}
