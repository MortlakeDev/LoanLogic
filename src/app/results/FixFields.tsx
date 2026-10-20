// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { EngineError } from '../../engine';
import { Icon } from '../components/Icon';
import { t } from '../state/i18n';
import { engineErrors, type FieldPath, fieldOfEngineError, form, inputErrors } from '../state/loan';
import {
  type FixSuggestion,
  fieldErrorMessage,
  fieldLabel,
  negativeAmortizationFix,
  negativeAmortizationMessage,
} from '../state/messages';
import { focusField } from '../state/ui';

/** How long input must stay unchanged before the list appears, so typing does not flash. */
export const FIX_DELAY_MS = 300;

/** One entry of the list. */
export interface FixItem {
  readonly key: string;
  readonly message: string;
  /** The field the message leads to, or `null` for an error no single input causes. */
  readonly field: FieldPath | null;
  readonly fix?: FixSuggestion;
}

/** The errors to list: typing errors first, then the engine's (they never coexist). */
export function fixItems(
  typing: ReadonlySet<FieldPath>,
  errors: readonly EngineError[],
): FixItem[] {
  const items: FixItem[] = [...typing].map((field) => ({
    key: `input:${field}`,
    field,
    message: fieldErrorMessage(field, { code: 'INPUT_INVALID', field }),
  }));
  errors.forEach((error, index) => {
    const key = `engine:${String(index)}`;
    const field = fieldOfEngineError(error);
    if (field !== null) {
      items.push({ key, field, message: fieldErrorMessage(field, error) });
    } else if (error.code === 'NEG_AMORTIZATION') {
      items.push({
        key,
        field: null,
        message: negativeAmortizationMessage(error),
        fix: negativeAmortizationFix(),
      });
    } else {
      items.push({ key, field: null, message: fieldErrorMessage('', error) });
    }
  });
  return items;
}

/** A message that moves focus to the field it is about (and opens what hides it). */
function FieldLink(props: { readonly field: FieldPath; readonly children: string }): JSX.Element {
  return (
    <button
      type="button"
      class="btn btn--accent fix-fields__link"
      onClick={() => {
        focusField(props.field);
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * "Fix the highlighted fields" with the list of errors (DESIGN §8.13), each leading to its
 * field. It appears only once the input has stayed unchanged for 300 ms, so typing does not
 * flash it; once shown it stays (and updates) until the input is valid. The results it
 * replaces are blanked at once by the caller.
 */
export function FixFields(props: { readonly class?: string }): JSX.Element | null {
  const value = form.value;
  const typing = inputErrors.value;
  const errors = engineErrors.value;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setShown(true);
    }, FIX_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
    // Every change of the input restarts the wait.
  }, [shown, value, typing]);
  if (!shown) {
    return null;
  }
  return (
    <div class={props.class === undefined ? 'fix-fields' : `fix-fields ${props.class}`}>
      <h3 class="fix-fields__title">
        <Icon name="alert-triangle" class="fix-fields__icon" />
        {t('results.fixFields')}
      </h3>
      <ul class="fix-fields__list">
        {fixItems(typing, errors).map((item) => (
          <li key={item.key} class="fix-fields__item">
            {item.field === null ? (
              <>
                <span>{item.message}</span>
                {item.fix !== undefined && (
                  <FieldLink field={item.fix.field}>{item.fix.message}</FieldLink>
                )}
              </>
            ) : (
              <FieldLink field={item.field}>
                {t('results.fixItem', { field: fieldLabel(item.field), message: item.message })}
              </FieldLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
