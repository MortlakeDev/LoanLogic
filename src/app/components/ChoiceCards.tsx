// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly title: string;
  readonly description: string;
}

/**
 * Choice cards (DESIGN §8.4): a 2 × 2 grid of native radios, each with a visible radio, a
 * title and a one-line description that is part of the radio's description.
 */
export function ChoiceCards<T extends string>(props: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <fieldset class="choices">
      <legend class="field__label">{props.legend}</legend>
      <div class="choices__grid">
        {props.options.map((option) => {
          const descriptionId = `${props.name}-${option.value}-text`;
          return (
            <label key={option.value} class="choice">
              <input
                class="choice__input"
                type="radio"
                name={props.name}
                value={option.value}
                checked={props.value === option.value}
                aria-describedby={descriptionId}
                onChange={() => {
                  props.onChange(option.value);
                }}
              />
              <span class="choice__title">{option.title}</span>
              <span id={descriptionId} class="choice__text">
                {option.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
