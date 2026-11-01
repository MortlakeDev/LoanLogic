// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { seriesName } from './labels';
import { type ChartView, type SeriesKey, seriesOf } from './model';

/** The chart token a series is drawn with. */
export type SeriesTone = 'principal' | 'fees' | 'interest';

const TONES = {
  principal: 'principal',
  fees: 'fees',
  interest: 'interest',
  balance: 'principal',
  cumulativePrincipal: 'principal',
  cumulativeInterest: 'interest',
} as const satisfies Record<SeriesKey, SeriesTone>;

/** The chart token of a series. */
export function toneOf(key: SeriesKey): SeriesTone {
  return TONES[key];
}

/** Whether a series is drawn as a line (balance, cumulative) rather than a bar segment. */
export function isLineSeries(key: SeriesKey): boolean {
  return key === 'balance' || key === 'cumulativePrincipal' || key === 'cumulativeInterest';
}

/**
 * A series swatch: a square for a bar segment, a short stroke for a line. Interest uses
 * the bars' hatch pattern (seen in forced colors) and the interest line's dashes, so the
 * swatch matches what it names in every mode.
 */
export function ChartSwatch(props: {
  readonly series: SeriesKey;
  readonly hatchId: string;
}): JSX.Element {
  const tone = toneOf(props.series);
  let mark: JSX.Element;
  if (isLineSeries(props.series)) {
    mark = <line class={`chart__line chart__line--${tone}`} x1="1" y1="6" x2="11" y2="6" />;
  } else if (tone === 'interest') {
    mark = <rect width="12" height="12" rx="2" fill={`url(#${props.hatchId})`} />;
  } else {
    mark = <rect width="12" height="12" rx="2" class={`chart__${tone}`} />;
  }
  return (
    <svg class="chart__swatch" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {mark}
    </svg>
  );
}

/** The legend: only the series of the current view, in stack (legend) order. */
export function ChartLegend(props: {
  readonly view: ChartView;
  readonly hasFees: boolean;
  readonly hatchId: string;
}): JSX.Element {
  return (
    <ul class="chart__legend">
      {seriesOf(props.view, props.hasFees).map((key) => (
        <li key={key} class="chart__legend-item">
          <ChartSwatch series={key} hatchId={props.hatchId} />
          <span>{seriesName(key)}</span>
        </li>
      ))}
    </ul>
  );
}
