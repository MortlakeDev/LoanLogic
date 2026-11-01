// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { count as formatCount, moneyCompact } from '../state/display';
import { t } from '../state/i18n';
import { toneOf } from './ChartLegend';
import { ChartTooltip } from './ChartTooltip';
import { annotationText, chartSummary, itemLabel } from './labels';
import {
  type Box,
  type ChartLayout,
  LABEL_PX,
  bucketX,
  chartLayout,
  linePath,
  placeLabel,
} from './layout';
import {
  type BarRect,
  type ChartData,
  type ChartView,
  type LineSeries as LineData,
  barRects,
  lineSeries,
  stackBar,
  valueExtent,
} from './model';
import { estimateTextWidth } from './scale';
import { type ChartModel, introPlayed } from './view';

/** Pixels between a focused mark and its focus ring. */
const RING_GAP = 3;

/** Pixels from a mark to the outer edge of its focus ring (the gap and half the 2 px stroke). */
const RING_OUTSET = RING_GAP + 1;

/** Pixels between stacked segments (DESIGN §8.11). */
const SEGMENT_GAP = 2;

/** The least height of a drawn segment: a small fee stays visible beside its legend entry. */
const MIN_SEGMENT = 1;

/** Radius of a line point's marker. */
const MARKER_R = 4;

/**
 * The width of an element in CSS pixels: read once on mount (so the first paint has the
 * right size), then kept up to date with a ResizeObserver; 0 when it has no layout (jsdom)
 * and no observer reports one (the chart then uses its fallback width).
 */
function useContainerWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }
    if (element.clientWidth > 0) {
      setWidth(element.clientWidth);
    }
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (measured > 0) {
        setWidth(measured);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/**
 * The rendered size of the axis labels in CSS pixels: xs is in rem, so it follows the
 * browser's font size, and the layout is computed for the measured size; `LABEL_PX` until
 * a label is rendered with styles (and in jsdom).
 */
function useLabelPx(ref: RefObject<SVGSVGElement>): number {
  const [labelPx, setLabelPx] = useState(LABEL_PX);
  useLayoutEffect(() => {
    const tick = ref.current?.querySelector('.chart__tick');
    const measured =
      tick === null || tick === undefined
        ? Number.NaN
        : Number.parseFloat(getComputedStyle(tick).fontSize);
    if (Number.isFinite(measured) && measured > 0 && measured !== labelPx) {
      setLabelPx(measured);
    }
  });
  return labelPx;
}

/** Whether an event's target lies inside the tooltip. */
function isTooltip(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.chart__tooltip') !== null;
}

/** What the bars and points report to the figure. */
interface ItemHandlers {
  readonly onFocus: (position: number) => void;
  readonly onBlur: () => void;
  /** The pointer left an item, and not for its tooltip. */
  readonly onLeave: () => void;
  /** The pointer moved over an item: this also brings back a tooltip hidden with Escape. */
  readonly onPointerMove: (position: number) => void;
  readonly onKey: (event: KeyboardEvent, position: number) => void;
}

/** The items' shared state: the roving tab stop and the marked item. */
interface ItemState {
  readonly roving: number;
  readonly focused: number | null;
  /** The hovered or focused item: line points show their markers. */
  readonly marked: number | null;
  readonly handlers: ItemHandlers;
}

/** A click shows the tooltip through hover; it does not move focus into the chart. */
function keepPointerFocus(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * One bar or line point: an image named with its exact amounts, in the chart's roving
 * tabindex (one tab stop; the arrow keys, Home and End move between items).
 */
function ChartItem(props: {
  readonly position: number;
  readonly label: string;
  readonly state: ItemState;
  readonly children: ComponentChildren;
}): JSX.Element {
  const { position, state } = props;
  const { handlers } = state;
  return (
    <g
      class="chart__item"
      role="img"
      aria-label={props.label}
      // Lowercase on SVG: Preact sets SVG props as attributes, and only `tabindex` is one.
      tabindex={position === state.roving ? 0 : -1}
      data-index={position}
      onFocus={() => {
        handlers.onFocus(position);
      }}
      onBlur={handlers.onBlur}
      // Only a real move over an item gives it the tooltip: boundary events also fire when
      // content moves under a resting pointer (a scroll, or the tooltip over the item hidden
      // with Escape), and would take the tooltip from the keyboard-focused item.
      onMouseMove={() => {
        handlers.onPointerMove(position);
      }}
      onMouseLeave={(event) => {
        // The pointer may move onto the item's tooltip and keep it (WCAG 1.4.13).
        if (!isTooltip(event.relatedTarget)) {
          handlers.onLeave();
        }
      }}
      onMouseDown={keepPointerFocus}
      onKeyDown={(event) => {
        handlers.onKey(event, position);
      }}
    >
      {props.children}
    </g>
  );
}

/** The 2 px focus ring around a focused mark (an SVG outline is not drawn reliably). */
function FocusRing(props: { readonly mark: Box }): JSX.Element {
  const { mark } = props;
  return (
    <rect
      class="chart__focus"
      aria-hidden="true"
      x={mark.left - RING_GAP}
      y={mark.top - RING_GAP}
      width={mark.right - mark.left + 2 * RING_GAP}
      height={mark.bottom - mark.top + 2 * RING_GAP}
      rx="3"
    />
  );
}

/** A box grown by `by` pixels on every side. */
function outset(box: Box, by: number): Box {
  return {
    left: box.left - by,
    right: box.right + by,
    top: box.top - by,
    bottom: box.bottom + by,
  };
}

/**
 * The box of a bucket's mark: its bar with the zero line, or its line points' markers
 * (`lines` is `null` in the bars view).
 */
function markBox(
  model: ChartModel,
  lines: readonly LineData[] | null,
  layout: ChartLayout,
  position: number,
): Box | null {
  const bucket = model.data.buckets[position];
  if (bucket === undefined) {
    return null;
  }
  if (lines === null) {
    const x = bucketX(layout, position + 1, false);
    const rects = barRects(
      stackBar(bucket, model.data.hasFees, model.digits),
      layout.y,
      SEGMENT_GAP,
      MIN_SEGMENT,
    );
    const zero = layout.y(0);
    return {
      left: x - layout.barWidth / 2,
      right: x + layout.barWidth / 2,
      top: Math.min(zero, ...rects.map((rect) => rect.y)),
      bottom: Math.max(zero, ...rects.map((rect) => rect.y + rect.height)),
    };
  }
  const x = bucketX(layout, position + 1, true);
  const ys = lines.map((line) => layout.y(Number(line.values[position + 1] ?? '0')));
  return {
    left: x - MARKER_R,
    right: x + MARKER_R,
    top: Math.min(...ys) - MARKER_R,
    bottom: Math.max(...ys) + MARKER_R,
  };
}

/**
 * Whether the bars grow in: only on their first render in the session, never after a
 * recalculation (new data) or once the animation has ended.
 */
function useIntro(data: ChartData): readonly [boolean, () => void] {
  const [first] = useState(() => (introPlayed.peek() ? null : data));
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    introPlayed.value = true;
  }, []);
  return [
    first === data && !ended,
    () => {
      setEnded(true);
    },
  ];
}

function segmentClass(rect: BarRect): string | undefined {
  return rect.key === 'interest' ? undefined : `chart__segment chart__${rect.key}`;
}

/**
 * The stacked bars (DESIGN §8.11): principal at the bottom, fees and insurance, interest
 * on top; negative segments hang below zero in the same order. Positive and negative parts
 * are separate groups so each grows from the baseline in the intro.
 */
function BarSeries(props: {
  readonly data: ChartData;
  readonly digits: number;
  readonly layout: ChartLayout;
  readonly hatchId: string;
  readonly state: ItemState;
}): JSX.Element {
  const { data, layout, state } = props;
  const [intro, endIntro] = useIntro(data);
  const segment = (rect: BarRect, x: number): JSX.Element => (
    <rect
      key={rect.key}
      class={segmentClass(rect)}
      fill={rect.key === 'interest' ? `url(#${props.hatchId})` : undefined}
      x={x}
      y={rect.y}
      width={layout.barWidth}
      height={rect.height}
      rx="1.5"
    />
  );
  const bars = data.buckets.map((bucket, position) => {
    const rects = barRects(
      stackBar(bucket, data.hasFees, props.digits),
      layout.y,
      SEGMENT_GAP,
      MIN_SEGMENT,
    );
    const up = rects.filter((rect) => !rect.value.startsWith('-'));
    const down = rects.filter((rect) => rect.value.startsWith('-'));
    const x = bucketX(layout, position + 1, false) - layout.barWidth / 2;
    return (
      <ChartItem
        key={bucket.index}
        position={position}
        label={itemLabel('bars', data, bucket)}
        state={state}
      >
        <rect
          class="chart__hit"
          x={layout.left + position * layout.slot}
          y={layout.top}
          width={layout.slot}
          height={layout.bottom - layout.top}
        />
        {up.length > 0 && <g class="chart__up">{up.map((rect) => segment(rect, x))}</g>}
        {down.length > 0 && <g class="chart__down">{down.map((rect) => segment(rect, x))}</g>}
      </ChartItem>
    );
  });
  return (
    <g
      class={intro ? 'chart__series chart__series--intro' : 'chart__series'}
      onAnimationEnd={endIntro}
    >
      {bars}
    </g>
  );
}

/**
 * The line views: balance (one line), or principal and interest paid so far (two lines),
 * each from the origin before the first payment through the end of every bucket. Each
 * bucket's point is an item; its markers show while it is hovered or focused. The lines
 * are painted over the items, so a hovered column's highlight never hides them.
 */
function LineSeries(props: {
  readonly data: ChartData;
  readonly series: readonly LineData[];
  readonly view: Exclude<ChartView, 'bars'>;
  readonly layout: ChartLayout;
  readonly state: ItemState;
}): JSX.Element {
  const { data, series, layout, state } = props;
  const points = data.buckets.map((bucket, position) => {
    const x = bucketX(layout, position + 1, true);
    const ys = series.map((line) => layout.y(Number(line.values[position + 1] ?? '0')));
    const from = Math.max(layout.left, x - layout.slot / 2);
    const to = Math.min(layout.right, x + layout.slot / 2);
    return (
      <ChartItem
        key={bucket.index}
        position={position}
        label={itemLabel(props.view, data, bucket)}
        state={state}
      >
        <rect
          class="chart__hit"
          x={from}
          y={layout.top}
          width={to - from}
          height={layout.bottom - layout.top}
        />
        {position === state.marked &&
          series.map((line, index) => (
            <circle
              key={line.key}
              class={`chart__marker chart__marker--${toneOf(line.key)}`}
              cx={x}
              cy={ys[index]}
              r={MARKER_R}
            />
          ))}
      </ChartItem>
    );
  });
  return (
    <>
      <g class="chart__series">{points}</g>
      <g aria-hidden="true">
        {series.map((line) => (
          <path
            key={line.key}
            class={`chart__line chart__line--${toneOf(line.key)}`}
            d={linePath(
              line.values.map((value, index) => ({
                x: bucketX(layout, index, true),
                y: layout.y(Number(value)),
              })),
            )}
          />
        ))}
      </g>
    </>
  );
}

/** Grid lines with the y labels, and the x labels (decoration: hidden from assistive tech). */
function Axes(props: { readonly layout: ChartLayout }): JSX.Element {
  const { layout } = props;
  return (
    <g class="chart__axes" aria-hidden="true">
      {layout.yTicks.map((tick) => {
        // Whole pixels plus a half: a 1 px line stays crisp.
        const y = Math.round(tick.y) + 0.5;
        return (
          <g key={tick.text}>
            <line class="chart__grid-line" x1={layout.left} x2={layout.right} y1={y} y2={y} />
            <text class="chart__tick" x={layout.left - 6} y={tick.y} dy="0.32em" text-anchor="end">
              {tick.text}
            </text>
          </g>
        );
      })}
      {layout.xLabels.map((label) => (
        <text
          key={label.text}
          class="chart__tick"
          x={label.x}
          y={layout.xLabelY}
          text-anchor="middle"
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

/**
 * A dashed vertical mark with its label in the band above the plot, kept inside the SVG;
 * a label wider than the SVG comes in lines (`layout.annotationLines`).
 */
function Annotation(props: {
  readonly x: number;
  readonly layout: ChartLayout;
  /** The y of a dot on the mark (the balance view's payoff), or `null`. */
  readonly dot: number | null;
}): JSX.Element {
  const { x, layout } = props;
  const lines = layout.annotationLines;
  const place = placeLabel(
    x,
    Math.max(...lines.map((line) => estimateTextWidth(line, layout.labelPx))),
    layout.width,
  );
  return (
    <g class="chart__annotation" aria-hidden="true">
      <line class="chart__annotation-line" x1={x} x2={x} y1={layout.top} y2={layout.bottom} />
      {props.dot !== null && <circle class="chart__payoff" cx={x} cy={props.dot} r={MARKER_R} />}
      <text
        class="chart__annotation-label"
        x={place.x}
        y={layout.annotationY}
        text-anchor={place.anchor}
      >
        {lines.length === 1
          ? lines[0]
          : lines.map((line, index) => (
              <tspan key={line} x={place.x} dy={index === 0 ? undefined : layout.lineHeight}>
                {line}
              </tspan>
            ))}
      </text>
    </g>
  );
}

/** Where a view's mark goes: the gap before the overtaking bar, a crossing or the payoff. */
function annotationX(view: ChartView, model: ChartModel, layout: ChartLayout): number | null {
  switch (view) {
    case 'bars':
      return model.overtake === null ? null : layout.left + model.overtake * layout.slot;
    case 'cumulative':
      return model.crossing === null ? null : bucketX(layout, model.crossing + 1, true);
    case 'balance':
      return bucketX(layout, model.data.buckets.length, true);
  }
}

/**
 * The chart (DESIGN §8.11): a figure named by the card's title and described by a summary
 * sentence, with an SVG laid out in CSS pixels for the measured width, the bars or lines
 * as one roving tab stop, the view's annotation and the tooltip. Escape hides the tooltip
 * until the pointer moves over an item or the keyboard focuses one.
 */
export function ChartFigure(props: {
  readonly model: ChartModel;
  readonly view: ChartView;
  readonly titleId: string;
  readonly hatchId: string;
}): JSX.Element {
  const { model, view, hatchId } = props;
  const { data, digits } = model;
  const plotRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const summaryId = useId();
  const measured = useContainerWidth(plotRef);
  const labelPx = useLabelPx(svgRef);
  const [roving, setRoving] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const last = data.buckets.length - 1;
  const inRange = (position: number | null): number | null =>
    position !== null && position <= last ? position : null;
  const marked = inRange(hovered ?? focused);
  const shown = dismissed ? null : marked;

  useEffect(() => {
    if (shown === null) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDismissed(true);
        // The pointer may rest on the tooltip, which gets no mouseleave once it is gone:
        // a kept hover would leave its line markers behind.
        setHovered(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [shown]);

  // A recalculation with fewer buckets removes the hovered item without a mouseleave; its
  // hover would come back if the buckets grew again.
  useEffect(() => {
    setHovered((position) => (position !== null && position > last ? null : position));
  }, [last]);

  const annotation = annotationText(view, model);
  const layout = chartLayout({
    width: measured,
    count: data.buckets.length,
    extent: valueExtent(data, view, digits),
    digits,
    points: view !== 'bars',
    tickText: moneyCompact,
    xText: formatCount,
    labelPx,
    annotation,
  });
  const lines = view === 'bars' ? null : lineSeries(data, view);

  const moveTo = (position: number): void => {
    setRoving(position);
    svgRef.current?.querySelector<SVGGElement>(`[data-index="${String(position)}"]`)?.focus();
  };
  const state: ItemState = {
    roving: Math.min(roving, last),
    focused: inRange(focused),
    marked,
    handlers: {
      onFocus: (position) => {
        setRoving(position);
        setFocused(position);
        // The latest input wins: a pointer resting on another item no longer holds the
        // tooltip once the keyboard moves (it takes over again on its next move over an item).
        setHovered(null);
        setDismissed(false);
      },
      onBlur: () => {
        setFocused(null);
      },
      onLeave: () => {
        setHovered(null);
      },
      onPointerMove: (position) => {
        setHovered(position);
        setDismissed(false);
      },
      onKey: (event, position) => {
        let next: number;
        switch (event.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            next = Math.min(position + 1, last);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            next = Math.max(position - 1, 0);
            break;
          case 'Home':
            next = 0;
            break;
          case 'End':
            next = last;
            break;
          default:
            return;
        }
        event.preventDefault();
        moveTo(next);
      },
    },
  };

  const markX = annotationX(view, model, layout);
  const lastBucket = data.buckets[last];
  const focusedMark = state.focused === null ? null : markBox(model, lines, layout, state.focused);
  const shownMark = shown === null ? null : markBox(model, lines, layout, shown);
  return (
    <div ref={plotRef} class="chart__plot">
      <figure
        class="chart__figure"
        role="group"
        aria-roledescription={t('chart.roleDescription')}
        aria-labelledby={props.titleId}
        aria-describedby={summaryId}
      >
        <p id={summaryId} class="visually-hidden">
          {chartSummary(view, model)}
        </p>
        <svg ref={svgRef} class="chart__svg" width={layout.width} height={layout.height}>
          <defs>
            {/* Interest: the hatch line shows only in forced colors (charts.css). */}
            <pattern
              id={hatchId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect class="chart__interest" width="6" height="6" />
              <line class="chart__hatch" x1="1" y1="0" x2="1" y2="6" />
            </pattern>
          </defs>
          <Axes layout={layout} />
          {view === 'bars' || lines === null ? (
            <BarSeries
              data={data}
              digits={digits}
              layout={layout}
              hatchId={hatchId}
              state={state}
            />
          ) : (
            <LineSeries data={data} series={lines} view={view} layout={layout} state={state} />
          )}
          {/* Over the series, so a hovered column's highlight never hides the mark. */}
          {annotation !== null && markX !== null && (
            <Annotation
              x={markX}
              layout={layout}
              dot={
                view === 'balance' && lastBucket !== undefined
                  ? layout.y(Number(lastBucket.closing))
                  : null
              }
            />
          )}
          {focusedMark !== null && <FocusRing mark={focusedMark} />}
        </svg>
      </figure>
      <ChartTooltip
        data={data}
        view={view}
        position={shown}
        mark={shownMark === null ? null : outset(shownMark, RING_OUTSET)}
        column={layout.slot / 2}
        width={layout.width}
        height={layout.height}
        hatchId={hatchId}
        onLeave={() => {
          setHovered(null);
        }}
      />
    </div>
  );
}
