// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './charts.css';

import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { MessageKey } from '../../i18n';
import { type SegmentOption, SegmentedControl } from '../components/SegmentedControl';
import { t } from '../state/i18n';
import { ChartFigure } from './ChartFigure';
import { ChartLegend } from './ChartLegend';
import { ChartTable } from './ChartTable';
import { chartSubtitle, chartTitle } from './labels';
import { CHART_VIEWS, type ChartView } from './model';
import { chartModel, chartTable, chartView, setChartView, toggleChartTable } from './view';

const VIEW_LABELS = {
  bars: 'chart.viewBars',
  balance: 'chart.viewBalance',
  cumulative: 'chart.viewCumulative',
} as const satisfies Record<ChartView, MessageKey>;

/**
 * The chart card (DESIGN §8.11): a title per view with a subtitle, the view switch (quiet
 * segmented control) and the "Show as table" switch, the legend of the current view, then
 * the chart or its table. It sits after the cost structure on desktop and between the
 * inputs and the schedule on mobile (§7).
 *
 * Renders nothing without a valid result: invalid input never leaves stale figures.
 */
export function ChartCard(): JSX.Element | null {
  const id = useId();
  const model = chartModel.value;
  if (model === null) {
    return null;
  }
  const view = chartView.value;
  const table = chartTable.value;
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const hatchId = `${id}-hatch`;
  const title = chartTitle(view, model.data.unit);
  const options: SegmentOption<ChartView>[] = CHART_VIEWS.map((value) => ({
    value,
    label: t(VIEW_LABELS[value]),
  }));
  return (
    <section class="card chart" aria-labelledby={titleId}>
      <div class="chart__header">
        <div class="chart__heading">
          <h3 id={titleId} class="chart__title">
            {title}
          </h3>
          <p class="chart__subtitle">{chartSubtitle(model.data)}</p>
        </div>
        <div class="chart__controls">
          <div class="chart__switch">
            <SegmentedControl
              name="chart-view"
              legend={t('chart.viewLegend')}
              hideLegend
              variant="quiet"
              options={options}
              value={view}
              onChange={setChartView}
            />
          </div>
          <button
            type="button"
            class="btn btn--secondary chart__table-toggle"
            aria-pressed={table}
            aria-controls={bodyId}
            onClick={toggleChartTable}
          >
            {t('chart.showTable')}
          </button>
        </div>
      </div>
      {!table && <ChartLegend view={view} hasFees={model.data.hasFees} hatchId={hatchId} />}
      <div id={bodyId} class="chart__body">
        {table ? (
          <ChartTable model={model} view={view} title={title} />
        ) : (
          <ChartFigure model={model} view={view} titleId={titleId} hatchId={hatchId} />
        )}
      </div>
    </section>
  );
}
