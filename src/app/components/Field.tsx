// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { useSignal } from '@preact/signals';
import type { ComponentChildren, JSX, TargetedEvent } from 'preact';
import { useEffect } from 'preact/hooks';
import { type DecimalInputKind, formatNumber, parseDecimalInput } from '../../i18n';
import { formatLocale } from '../state/i18n';
import { type FieldPath, fieldErrors, inputIdFor, noteInput, setInputInvalid } from '../state/loan';
import { fieldErrorMessage } from '../state/messages';
import { Icon } from './Icon';

/** The id of the element that shows a field's error (for `aria-describedby`). */
export function errorIdFor(field: FieldPath): string {
  return `${inputIdFor(field)}-error`;
}

/** Whether a field has an error now (typing or engine). */
export function hasError(field: FieldPath): boolean {
  return fieldErrors.value.has(field);
}

/**
 * The `aria-describedby` of an input: its hint and, while it has one, its error. Fields
 * that share one hint (the term's years and months) pass the same `hintId`.
 */
export function describedBy(field: FieldPath, hintId?: string): string | undefined {
  const ids = [hintId, hasError(field) ? errorIdFor(field) : undefined].filter(
    (id): id is string => id !== undefined,
  );
  return ids.length === 0 ? undefined : ids.join(' ');
}

/** The localized error of a field, with its icon (DESIGN §8.2), or nothing. */
export function FieldError(props: { readonly field: FieldPath }): JSX.Element | null {
  const error = fieldErrors.value.get(props.field);
  if (error === undefined) {
    return null;
  }
  return (
    <p id={errorIdFor(props.field)} class="field__error">
      <Icon name="alert-triangle" />
      <span>{fieldErrorMessage(props.field, error)}</span>
    </p>
  );
}

interface FieldProps {
  /** The visible label. */
  readonly label: string;
  /** The `id` of the labelled control. */
  readonly inputId: string;
  /** The hint under the control (DESIGN §8.2: the derived value), if any. */
  readonly hint?: ComponentChildren;
  readonly hintId?: string;
  /** Fields whose errors are shown under this one. */
  readonly fields: readonly FieldPath[];
  readonly class?: string;
  readonly children: ComponentChildren;
}

/** A labelled control with its hint and errors (DESIGN §8.2). */
export function Field(props: FieldProps): JSX.Element {
  return (
    <div class={props.class === undefined ? 'field' : `field ${props.class}`}>
      <label class="field__label" htmlFor={props.inputId}>
        {props.label}
      </label>
      {props.children}
      {props.hint !== undefined && (
        <p id={props.hintId} class="field__hint">
          {props.hint}
        </p>
      )}
      {props.fields.map((field) => (
        <FieldError key={field} field={field} />
      ))}
    </div>
  );
}

/** Like `Field`, for several controls under one legend (`fieldset`, DESIGN §11). */
export function FieldGroup(props: Omit<FieldProps, 'inputId'>): JSX.Element {
  return (
    <fieldset class={props.class === undefined ? 'field' : `field ${props.class}`}>
      <legend class="field__label">{props.label}</legend>
      {props.children}
      {props.hint !== undefined && (
        <p id={props.hintId} class="field__hint">
          {props.hint}
        </p>
      )}
      {props.fields.map((field) => (
        <FieldError key={field} field={field} />
      ))}
    </fieldset>
  );
}

/** Decimals of an engine decimal string ("6.50" → 2). */
function decimalsOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

/**
 * An engine value as the field shows it when not being edited: the user's locale, every
 * digit kept (an invalid "100.005" USD stays visible with its error), money with at
 * least the currency's minor units and grouping; percentages and counts without grouping.
 */
export function formatInputValue(
  value: string,
  kind: DecimalInputKind,
  locale: string,
  fractionDigits = 0,
): string {
  if (value === '') {
    return '';
  }
  const decimals = decimalsOf(value);
  const minimum = kind === 'money' ? Math.max(fractionDigits, decimals) : decimals;
  return formatNumber(value, locale, {
    minimumFractionDigits: minimum,
    // Every digit typed stays visible (parseDecimalInput accepts at most 100 decimals).
    maximumFractionDigits: Math.max(minimum, 20),
    useGrouping: kind === 'money',
  });
}

interface NumberInputProps {
  readonly id: string;
  /** The UI field this input edits: its error state and parse failures. */
  readonly field: FieldPath;
  readonly kind: DecimalInputKind;
  /** The engine decimal string held in state. */
  readonly value: string;
  /** Receives every value that parses (live recalculation). */
  readonly onValue: (value: string) => void;
  /** Minor units shown for money (the field reformats on blur). */
  readonly fractionDigits?: number;
  /** Units shown inside the control ("$", "%", "yr"), muted. */
  readonly prefix?: string;
  readonly suffix?: string;
  /** For inputs without a `<label>` of their own (the term's years and months). */
  readonly ariaLabel?: string;
  /** Names the input by another element, such as the legend of its group. */
  readonly ariaLabelledBy?: string;
  readonly hintId?: string;
  readonly size?: 'md' | 'lg';
  /**
   * Also invalid while another field it belongs to has an error (the term's years and
   * months under a `term` error such as `TERM_TOO_SHORT`).
   */
  readonly invalid?: boolean;
}

/**
 * A number input in the user's formatting locale (DESIGN §8.2, T03 brief §3): text is
 * parsed with `parseDecimalInput` on every keystroke; a value that parses goes to state
 * at once, one that does not marks the field invalid, which blanks the results. The
 * text is never reformatted while typing, only on blur.
 */
export function NumberInput(props: NumberInputProps): JSX.Element {
  // The text being edited; `null` shows the state's value, formatted.
  const draft = useSignal<string | null>(null);
  const locale = formatLocale.value;
  const shown =
    draft.value ?? formatInputValue(props.value, props.kind, locale, props.fractionDigits);

  // A field that goes away (another repetition, term mode or balloon kind) or is
  // remounted shows the stored valid value, so its typing error must go with it; otherwise
  // the results would stay blank with no field left to fix.
  const field = props.field;
  useEffect(
    () => () => {
      setInputInvalid(field, false);
    },
    [field],
  );

  /** Applies text that parses: clears the field's error and sends a changed value to state. */
  const apply = (text: string): boolean => {
    const parsed = parseDecimalInput(text, locale, props.kind);
    setInputInvalid(props.field, !parsed.ok);
    if (parsed.ok && parsed.value !== props.value) {
      props.onValue(parsed.value);
    }
    return parsed.ok;
  };

  const onInput = (event: TargetedEvent<HTMLInputElement>): void => {
    draft.value = event.currentTarget.value;
    noteInput();
    apply(draft.value);
  };

  const onBlur = (): void => {
    // A valid entry is reformatted from state; an invalid one stays as typed. Text typed
    // before a language change is read again in the new locale (a space groups digits in
    // ru-RU but not in en-US), so it is applied, not dropped.
    if (draft.value !== null && apply(draft.value)) {
      draft.value = null;
    }
  };

  const invalid = props.invalid === true || hasError(props.field);
  return (
    <div
      class={`control${props.size === 'lg' ? ' control--lg' : ''}${invalid ? ' control--invalid' : ''}`}
    >
      {props.prefix !== undefined && (
        <span class="control__affix" aria-hidden="true">
          {props.prefix}
        </span>
      )}
      <input
        id={props.id}
        class="control__input num"
        type="text"
        inputMode={props.kind === 'integer' ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellcheck={false}
        value={shown}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-invalid={invalid}
        aria-describedby={describedBy(props.field, props.hintId)}
        onInput={onInput}
        onBlur={onBlur}
      />
      {props.suffix !== undefined && (
        <span class="control__affix" aria-hidden="true">
          {props.suffix}
        </span>
      )}
    </div>
  );
}
