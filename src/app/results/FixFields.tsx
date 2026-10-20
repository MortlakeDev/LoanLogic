// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import type { EngineError } from '../../engine';
import { Icon } from '../components/Icon';
import { t } from '../state/i18n';
import {
  engineErrors,
  type FieldPath,
  fieldOfEngineError,
  form,
  inputErrors,
  inputRevision,
  okResult,
} from '../state/loan';
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

/**
 * Whether "Fix the highlighted fields" is shown. One flag for every view of the list (the
 * desktop results, the mobile summary, the announcement), so they appear together.
 */
export const fixListShown = signal(false);

/**
 * Drives `fixListShown` (DESIGN §8.13): invalid input shows the list once nothing has
 * changed for 300 ms, counting keystrokes that leave the text invalid (`inputRevision`),
 * which change neither the form nor the set of errors; once shown it stays, and updates,
 * until the input is valid. Rendered once, by the always-mounted results panel; a
 * component of its own so that keystrokes re-render nothing else.
 */
export function FixListDelay(): null {
  const invalid = okResult.value === null;
  const value = form.value;
  const typing = inputErrors.value;
  const errors = engineErrors.value;
  const revision = inputRevision.value;
  // A layout effect resets the flag before the next paint, so input that turns valid and
  // then invalid again never shows the old list for a frame.
  useLayoutEffect(() => {
    if (!invalid) {
      fixListShown.value = false;
      return undefined;
    }
    if (fixListShown.peek()) {
      return undefined;
    }
    const timer = setTimeout(() => {
      fixListShown.value = true;
    }, FIX_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [invalid, value, typing, errors, revision]);
  return null;
}

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

/** The text of an item linked to its field: "Loan amount: Enter an amount …". */
function fieldItemText(field: FieldPath, message: string): string {
  return t('results.fixItem', { field: fieldLabel(field), message });
}

/**
 * The list as one announcement for the results' live region: the title, then every item
 * as the list shows it (an unlinked error is followed by its fix). Whole messages are
 * joined as sentences, never fragments of one.
 */
export function fixListText(
  typing: ReadonlySet<FieldPath>,
  errors: readonly EngineError[],
): string {
  const messages = fixItems(typing, errors).flatMap((item) => {
    if (item.field !== null) {
      return [fieldItemText(item.field, item.message)];
    }
    return item.fix === undefined ? [item.message] : [item.message, item.fix.message];
  });
  // Every message is a whole sentence with its own full stop; the title gets the
  // language's punctuation from the catalog.
  return t('results.fixAnnouncement', { title: t('results.fixFields'), items: messages.join(' ') });
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
 * field, once `fixListShown` is set (`FixListDelay`). The results it replaces are blanked
 * at once by the caller.
 */
export function FixFields(props: { readonly class?: string }): JSX.Element | null {
  const typing = inputErrors.value;
  const errors = engineErrors.value;
  if (!fixListShown.value) {
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
              <FieldLink field={item.field}>{fieldItemText(item.field, item.message)}</FieldLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
