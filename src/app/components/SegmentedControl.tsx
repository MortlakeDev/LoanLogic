// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  /** The radio group's `name`; unique on the page. */
  readonly name: string;
  readonly legend: string;
  /** Hide the legend visually (it stays the group's accessible name). */
  readonly hideLegend?: boolean;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** `solid`: primary inputs (accent fill); `quiet`: tabs and view switches (DESIGN §8.3). */
  readonly variant?: 'solid' | 'quiet';
  /** Columns of the grid (the frequency control is 3 × 2). */
  readonly columns?: number;
  /** The `id` of the first radio, so an error can focus the group. */
  readonly id?: string;
  readonly describedBy?: string;
}

/**
 * A segmented control on native radio buttons (DESIGN §8.3, T01 pattern): Tab enters the
 * group, arrow keys move the selection, forced-colors mode marks it with Highlight.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): JSX.Element {
  const variant = props.variant ?? 'solid';
  return (
    <fieldset
      class={`segmented segmented--${variant}`}
      style={props.columns === undefined ? undefined : { '--segment-columns': props.columns }}
      aria-describedby={props.describedBy}
    >
      <legend class={props.hideLegend === true ? 'visually-hidden' : 'field__label'}>
        {props.legend}
      </legend>
      <div class="segmented__track">
        {props.options.map((option, index) => (
          <label key={option.value} class="segmented__option">
            <input
              id={index === 0 ? props.id : undefined}
              class="segmented__input"
              type="radio"
              name={props.name}
              value={option.value}
              checked={props.value === option.value}
              onChange={() => {
                props.onChange(option.value);
              }}
            />
            <span class="segmented__face">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
