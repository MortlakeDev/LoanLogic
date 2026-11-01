// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { amount, currency, date } from '../state/display';
import { t } from '../state/i18n';
import { bucketLabel, seriesName, seriesValue } from './labels';
import { type ChartBucket, type ChartView, type SeriesKey, seriesOf } from './model';
import type { ChartModel } from './view';

interface Column {
  readonly key: string;
  readonly header: string;
  readonly cell: (bucket: ChartBucket) => string;
  /** Interest columns carry the accent, as in the schedule (DESIGN §8.10). */
  readonly accent: boolean;
}

function seriesColumn(key: SeriesKey): Column {
  return {
    key,
    header: seriesName(key),
    cell: (bucket) => amount(seriesValue(bucket, key)),
    accent: key === 'interest' || key === 'cumulativeInterest',
  };
}

/**
 * The columns after the row header (the bucket): the view's series in legend order, and
 * the total of the bars or the date of the balance.
 */
function columnsOf(view: ChartView, model: ChartModel): Column[] {
  const { data } = model;
  const series = seriesOf(view, data.hasFees).map(seriesColumn);
  switch (view) {
    case 'bars':
      return [
        ...series,
        {
          key: 'total',
          header: t('chart.total'),
          cell: (bucket) => amount(bucket.total),
          accent: false,
        },
      ];
    case 'balance':
      return [
        {
          key: 'date',
          header: t(data.unit === 'year' ? 'chart.colLastDate' : 'schedule.colDate'),
          cell: (bucket) => date(bucket.lastDate),
          accent: false,
        },
        ...series,
      ];
    case 'cumulative':
      return series;
  }
}

/**
 * The chart as a table ("Show as table", DESIGN §8.11): one row per bar or point with the
 * same exact amounts, without the currency symbol (the caption names the currency, §9).
 * It scrolls inside its own focusable region when the card is narrower than the table.
 */
export function ChartTable(props: {
  readonly model: ChartModel;
  readonly view: ChartView;
  readonly title: string;
}): JSX.Element {
  const captionId = useId();
  const { model, view } = props;
  const { unit } = model.data;
  const columns = columnsOf(view, model);
  return (
    <div
      class="chart-table"
      role="region"
      aria-labelledby={captionId}
      // A keyboard user must be able to scroll the table when it is wider than the card.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <table class="chart-table__table">
        <caption id={captionId} class="visually-hidden">
          {t('chart.caption', { title: props.title, currency: currency.value })}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="chart-table__start">
              {t(unit === 'year' ? 'chart.colYear' : 'schedule.colNumber')}
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.data.buckets.map((bucket) => (
            <tr key={bucket.index}>
              <th scope="row" class="chart-table__start">
                {bucketLabel(unit, bucket)}
              </th>
              {columns.map((column) => (
                <td key={column.key} class={column.accent ? 'num chart-table__interest' : 'num'}>
                  {column.cell(bucket)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
