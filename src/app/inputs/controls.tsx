// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { describedBy, Field, hasError } from '../components/Field';
import { Icon } from '../components/Icon';
import type { FieldPath } from '../state/loan';

/**
 * `{ [key]: value }`, or no property for `undefined`: optional props of the shared
 * components do not accept an explicit `undefined` (`exactOptionalPropertyTypes`).
 */
export function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * A labelled native select (DESIGN §8.2) with its hint and the errors of `field`. Fee
 * rows pass no field: the engine reports every error of a fee on its value.
 */
export function SelectField<T extends string>(props: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly field?: FieldPath | undefined;
  readonly hint?: string | undefined;
}): JSX.Element {
  const hintId = props.hint === undefined ? undefined : `${props.id}-hint`;
  const field = props.field;
  return (
    <Field
      label={props.label}
      inputId={props.id}
      {...optional('hint', props.hint)}
      {...optional('hintId', hintId)}
      fields={field === undefined ? [] : [field]}
    >
      <select
        id={props.id}
        class="select"
        value={props.value}
        aria-invalid={field === undefined ? undefined : hasError(field)}
        aria-describedby={field === undefined ? hintId : describedBy(field, hintId)}
        onChange={(event) => {
          const chosen = props.options.find((option) => option.value === event.currentTarget.value);
          if (chosen !== undefined) {
            props.onChange(chosen.value);
          }
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * A native date input in a control box with a calendar icon (DESIGN §8.2). The browser
 * shows the date in its own locale; the formatted date belongs in the hint (DESIGN
 * intro). A cleared or incomplete date is `''`, which the engine reports as
 * `DATE_INVALID` under the field.
 */
export function DateControl(props: {
  readonly id: string;
  readonly field: FieldPath;
  readonly value: string;
  readonly onValue: (value: string) => void;
  /** Ids of hints and of errors other than the field's own, space-separated. */
  readonly describedBy?: string | undefined;
  /** For a date labelled by its group's legend (the term's end date). */
  readonly labelledBy?: string | undefined;
  /** Marks the control invalid for an error reported on a containing field too. */
  readonly invalid?: boolean | undefined;
}): JSX.Element {
  const invalid = props.invalid === true || hasError(props.field);
  return (
    <div class={`control control--date${invalid ? ' control--invalid' : ''}`}>
      <Icon name="calendar" class="control__icon" />
      <input
        id={props.id}
        class="control__input"
        type="date"
        min="0001-01-01"
        max="9999-12-31"
        value={props.value}
        aria-labelledby={props.labelledBy}
        aria-invalid={invalid}
        aria-describedby={describedBy(props.field, props.describedBy)}
        onInput={(event) => {
          props.onValue(event.currentTarget.value);
        }}
      />
    </div>
  );
}
