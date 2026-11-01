// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * What the chart card shows (DESIGN §8.11): the chart data of the current result and the
 * card's view state.
 *
 * The view, the table switch and whether the bars' intro has played live in module signals
 * rather than component state, so they survive the moments when invalid input blanks the
 * results and the card unmounts (like the schedule's `view.ts`), and the intro plays once
 * per session, never on a recalculation.
 */

import { computed, signal } from '@preact/signals';
import { currencyDigits } from '../state/display';
import { form, okResult } from '../state/loan';
import {
  type ChartData,
  type ChartView,
  chartBuckets,
  cumulativeCrossing,
  principalOvertakes,
} from './model';

/** The chart figures of a result, all from the engine result and `model.ts`. */
export interface ChartModel {
  readonly data: ChartData;
  /** Digits of the currency's minor unit. */
  readonly digits: number;
  /** Position of the bucket where principal first exceeds interest, or `null`. */
  readonly overtake: number | null;
  /** Position of the bucket where principal paid so far passes interest paid, or `null`. */
  readonly crossing: number | null;
  /** `summary.payoffDate` (YYYY-MM-DD), for the balance view's mark. */
  readonly payoffDate: string;
}

/** The chart figures of the current result, or `null` when there is no valid result. */
export const chartModel = computed<ChartModel | null>(() => {
  const result = okResult.value;
  if (result === null) {
    return null;
  }
  const digits = currencyDigits.value;
  const data = chartBuckets(result.rows, form.value.frequency, digits);
  return {
    data,
    digits,
    overtake: principalOvertakes(data.buckets, digits),
    crossing: cumulativeCrossing(data.buckets, digits),
    payoffDate: result.summary.payoffDate,
  };
});

/** The view of the chart card; the bars by default. */
export const chartView = signal<ChartView>('bars');

/** Whether the card shows its table instead of the chart. */
export const chartTable = signal(false);

/** Whether the bars have grown in once this session (their intro animation). */
export const introPlayed = signal(false);

/** Switches the chart view. */
export function setChartView(view: ChartView): void {
  chartView.value = view;
}

/** The "Show as table" switch. */
export function toggleChartTable(): void {
  chartTable.value = !chartTable.value;
}

/** Back to the initial state (bars, chart, intro not played); used by tests. */
export function resetChartView(): void {
  chartView.value = 'bars';
  chartTable.value = false;
  introPlayed.value = false;
}
