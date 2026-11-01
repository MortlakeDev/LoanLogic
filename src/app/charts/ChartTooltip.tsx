// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { money } from '../state/display';
import { t } from '../state/i18n';
import { ChartSwatch } from './ChartLegend';
import { bucketHeading, seriesName, seriesValue } from './labels';
import { type Box, placeTooltip } from './layout';
import { type ChartData, type ChartView, seriesOf } from './model';

/** Whether an event's target lies inside a chart item (a bar or line point). */
function isChartItem(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.chart__item') !== null;
}

/**
 * The tooltip of the active bar or point (hover or keyboard focus): the bucket with its
 * dates and the exact amounts of the view's series in legend order (the bars add the
 * total). It sits beside the mark, reachable from it without crossing another item, and
 * moves off the mark when the chart is too narrow for both (`placeTooltip`).
 *
 * The live region is always rendered, so a screen reader announces the content as it
 * changes, whole with the series names (`aria-atomic`); the tooltip itself only while an
 * item is active. WCAG 1.4.13: it stays while the pointer or focus stays on the item or the
 * pointer is on the tooltip, and hides on leaving both, on blur and on Escape.
 */
export function ChartTooltip(props: {
  readonly data: ChartData;
  readonly view: ChartView;
  /** The active bucket's position, or `null` when nothing is shown. */
  readonly position: number | null;
  /** The active mark's box with room for its focus ring, in chart pixels. */
  readonly mark: Box | null;
  /** Half the width of the mark's column. */
  readonly column: number;
  /** The chart's size in pixels. */
  readonly width: number;
  readonly height: number;
  readonly hatchId: string;
  /** The pointer left the tooltip for somewhere other than a chart item. */
  readonly onLeave: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0;
    const height = ref.current?.offsetHeight ?? 0;
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
  });
  const bucket = props.position === null ? undefined : props.data.buckets[props.position];
  let content: JSX.Element | null = null;
  if (bucket !== undefined && props.mark !== null) {
    const place = placeTooltip(props.mark, props.column, size, {
      width: props.width,
      height: props.height,
    });
    content = (
      // Not a control: the pointer may rest on the tooltip (WCAG 1.4.13), and leaving it ends
      // the hover; the keyboard works on the items and Escape.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        ref={ref}
        class="chart__tooltip"
        style={{ left: `${String(place.left)}px`, top: `${String(place.top)}px` }}
        onMouseLeave={(event) => {
          // An item entered from here takes the tooltip over with its own mousemove.
          if (!isChartItem(event.relatedTarget)) {
            props.onLeave();
          }
        }}
      >
        <p class="chart__tooltip-title">{bucketHeading(props.data.unit, bucket)}</p>
        <dl class="chart__tooltip-list">
          {seriesOf(props.view, props.data.hasFees).map((key) => (
            <div key={key} class="chart__tooltip-row">
              <dt class="chart__tooltip-name">
                <ChartSwatch series={key} hatchId={props.hatchId} />
                {seriesName(key)}
              </dt>
              <dd class="chart__tooltip-value num">{money(seriesValue(bucket, key))}</dd>
            </div>
          ))}
          {props.view === 'bars' && (
            <div class="chart__tooltip-row chart__tooltip-row--total">
              <dt class="chart__tooltip-name">{t('chart.total')}</dt>
              <dd class="chart__tooltip-value num">{money(bucket.total)}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }
  return (
    <div class="chart__tooltip-region" aria-live="polite" aria-atomic="true">
      {content}
    </div>
  );
}
