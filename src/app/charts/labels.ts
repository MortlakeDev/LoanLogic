// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The words of the chart card: titles, bucket labels, series names, the accessible names
 * of bars and points, annotations and the summary sentence. Every amount is formatted by
 * the display helpers from the model's exact decimal strings; these functions only pick
 * the message and its parameters.
 */

import type { MessageKey } from '../../i18n';
import { date, money, monthYear } from '../state/display';
import { t } from '../state/i18n';
import type { ChartBucket, ChartData, ChartUnit, ChartView, SeriesKey } from './model';
import type { ChartModel } from './view';

const SERIES_NAMES = {
  principal: 'chart.principal',
  fees: 'chart.fees',
  interest: 'chart.interest',
  balance: 'chart.balance',
  cumulativePrincipal: 'chart.principalPaid',
  cumulativeInterest: 'chart.interestPaid',
} as const satisfies Record<SeriesKey, MessageKey>;

/** The name of a series, as the legend, tooltip and table show it. */
export function seriesName(key: SeriesKey): string {
  return t(SERIES_NAMES[key]);
}

/** A bucket's exact amount of a series (engine string). */
export function seriesValue(bucket: ChartBucket, key: SeriesKey): string {
  return key === 'balance' ? bucket.closing : bucket[key];
}

/** "Year 21" or "Payment 3". */
export function bucketLabel(unit: ChartUnit, bucket: ChartBucket): string {
  return unit === 'year'
    ? t('schedule.year', { year: bucket.index })
    : t('chart.payment', { number: bucket.index });
}

/** The tooltip's heading: "Year 1 · Dec 2026 – Nov 2027", "Payment 3 · Feb 1, 2027". */
export function bucketHeading(unit: ChartUnit, bucket: ChartBucket): string {
  return t('chart.itemHeading', {
    label: bucketLabel(unit, bucket),
    dates:
      unit === 'year'
        ? t('schedule.yearRange', {
            from: monthYear(bucket.firstDate),
            to: monthYear(bucket.lastDate),
          })
        : date(bucket.firstDate),
  });
}

/**
 * The accessible name of a bar or line point, with exact amounts:
 * "Year 1: principal $3,641.84, interest $23,949.16".
 */
export function itemLabel(view: ChartView, data: ChartData, bucket: ChartBucket): string {
  const label = bucketLabel(data.unit, bucket);
  switch (view) {
    case 'bars':
      return data.hasFees
        ? t('chart.barItemFees', {
            label,
            principal: money(bucket.principal),
            fees: money(bucket.fees),
            interest: money(bucket.interest),
          })
        : t('chart.barItem', {
            label,
            principal: money(bucket.principal),
            interest: money(bucket.interest),
          });
    case 'balance':
      return t('chart.balanceItem', { label, balance: money(bucket.closing) });
    case 'cumulative':
      return t('chart.cumulativeItem', {
        label,
        principal: money(bucket.cumulativePrincipal),
        interest: money(bucket.cumulativeInterest),
      });
  }
}

/** The card's title for a view. */
export function chartTitle(view: ChartView, unit: ChartUnit): string {
  switch (view) {
    case 'bars':
      return t(unit === 'year' ? 'chart.titleBarsYears' : 'chart.titleBarsPayments');
    case 'balance':
      return t('chart.titleBalance');
    case 'cumulative':
      return t('chart.titleCumulative');
  }
}

/** "Loan years 1–30 · 12 payments a year" or "12 payments". */
export function chartSubtitle(data: ChartData): string {
  return data.unit === 'year'
    ? t('chart.subtitleYears', { last: data.buckets.length, count: data.periodsPerYear })
    : t('chart.subtitlePayments', { count: data.buckets.length });
}

/** The bucket at a position; the model's positions always exist. */
function bucketAt(data: ChartData, position: number): ChartBucket {
  const bucket = data.buckets[position];
  if (bucket === undefined) {
    throw new RangeError(`No chart bucket at ${String(position)}`);
  }
  return bucket;
}

/**
 * The label of a view's mark: "Year 21 · principal overtakes interest" (bars), the
 * crossing of the cumulative lines, "Paid off Nov 2056" (balance); `null` without a mark.
 */
export function annotationText(view: ChartView, model: ChartModel): string | null {
  const { data } = model;
  switch (view) {
    case 'bars':
      return model.overtake === null
        ? null
        : t('chart.overtakes', { label: bucketLabel(data.unit, bucketAt(data, model.overtake)) });
    case 'cumulative':
      return model.crossing === null
        ? null
        : t('chart.crossing', { label: bucketLabel(data.unit, bucketAt(data, model.crossing)) });
    case 'balance':
      return t('chart.paidOff', { date: monthYear(model.payoffDate) });
  }
}

/** A whole-unit amount for the summary sentence ("$23,949"), from an exact string. */
function whole(value: string): string {
  return money(value, 0);
}

/**
 * The summary that describes a chart to assistive technology, in whole currency units:
 * "Interest goes from $23,949 in year 1 to $1,001 in year 30, principal from $3,642 to
 * $26,591. Principal first exceeds interest in year 21."
 */
export function chartSummary(view: ChartView, model: ChartModel): string {
  const { data } = model;
  const years = data.unit === 'year';
  const first = bucketAt(data, 0);
  const last = bucketAt(data, data.buckets.length - 1);
  if (view === 'balance') {
    return t('chart.summaryBalance', {
      start: whole(data.origin.balance),
      end: whole(last.closing),
      date: monthYear(model.payoffDate),
    });
  }
  if (view === 'cumulative') {
    const sentence = t('chart.summaryCumulative', {
      principal: whole(last.cumulativePrincipal),
      interest: whole(last.cumulativeInterest),
    });
    if (model.crossing === null) {
      return sentence;
    }
    const crossing = t(years ? 'chart.summaryCrossingYears' : 'chart.summaryCrossingPayments', {
      number: bucketAt(data, model.crossing).index,
    });
    return t('chart.sentences', { first: sentence, second: crossing });
  }
  // One bar has no trend: its name says it all.
  const sentence =
    data.buckets.length === 1
      ? itemLabel(view, data, first)
      : t(years ? 'chart.summaryBarsYears' : 'chart.summaryBarsPayments', {
          first: first.index,
          last: last.index,
          interestFirst: whole(first.interest),
          interestLast: whole(last.interest),
          principalFirst: whole(first.principal),
          principalLast: whole(last.principal),
        });
  if (model.overtake === null || data.buckets.length === 1) {
    return sentence;
  }
  const overtake = t(years ? 'chart.summaryOvertakesYears' : 'chart.summaryOvertakesPayments', {
    number: bucketAt(data, model.overtake).index,
  });
  return t('chart.sentences', { first: sentence, second: overtake });
}
