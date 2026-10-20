// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { useSignal } from '@preact/signals';
import type { JSX, TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import { isLanguage, LANGUAGE_ENDONYMS, LANGUAGES, type Language } from '../../i18n';
import { language, setLanguage, t } from '../state/i18n';
import { Icon } from './Icon';

// Keys that move the selection of a closed <select> (type-ahead letters are handled too).
const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Whether a key press steps the selection of a closed select: any navigation key, or a
 * printable character for type-ahead, except Space (which opens the list) and characters
 * typed with Ctrl/Cmd (shortcuts).
 */
function movesSelection(event: KeyboardEvent): boolean {
  if (NAVIGATION_KEYS.has(event.key)) {
    return true;
  }
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey;
}

/**
 * Language picker; each option is labelled in its own language (endonym).
 *
 * Browsing a closed select with the keyboard fires `change` at every step. Switching the
 * whole UI on each step would change the page under the user (WCAG 3.2.2 On Input), so
 * keyboard steps are held as a pending choice and applied on Enter or when focus leaves;
 * Escape reverts. A pick with the mouse, touch or from an opened list applies at once.
 *
 * @param props.id The select's `id`, unique on the page: the header and the mobile menu
 *   sheet each render a picker.
 * @param props.variant `pill` (header, DESIGN §7.1): a pill with the globe icon and a
 *   visually hidden label; `field` (menu sheet): a full-width select under a visible label.
 */
export function LanguageSwitcher(props: {
  readonly id: string;
  readonly variant: 'pill' | 'field';
}): JSX.Element {
  const pending = useSignal<Language | undefined>(undefined);
  const keyboardStep = useRef(false);

  /** Clears the pending keyboard choice and applies it if it differs from the current language. */
  const commit = (): void => {
    const next = pending.value;
    pending.value = undefined;
    if (next !== undefined && next !== language.value) {
      setLanguage(next);
    }
  };

  /**
   * Enter applies the pending choice and Escape discards it. A key that steps the
   * selection flags the `change` it is about to cause as a keyboard step, so that change
   * is only held as pending.
   */
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLSelectElement>): void => {
    if (event.key === 'Enter') {
      commit();
    } else if (event.key === 'Escape') {
      pending.value = undefined;
    } else if (movesSelection(event)) {
      keyboardStep.current = true;
      // The keyboard-driven `change` fires during this key's default action. A later
      // `change` (e.g. a pick from a list the key opened) is a deliberate choice.
      setTimeout(() => {
        keyboardStep.current = false;
      }, 0);
    }
  };

  /**
   * A keyboard step only records the pending choice (WCAG 3.2.2); any other change (mouse,
   * touch, a pick from the opened list) switches the language at once. Values that are not
   * supported languages are ignored.
   */
  const onChange = (event: TargetedEvent<HTMLSelectElement>): void => {
    const next = event.currentTarget.value;
    if (!isLanguage(next)) {
      return;
    }
    if (keyboardStep.current) {
      keyboardStep.current = false;
      pending.value = next;
      return;
    }
    pending.value = undefined;
    setLanguage(next);
  };

  const pill = props.variant === 'pill';
  return (
    <div class={pill ? 'language-pill' : 'field'}>
      {pill && <Icon name="globe" class="language-pill__icon" />}
      <label class={pill ? 'visually-hidden' : 'field__label'} htmlFor={props.id}>
        {t('language.label')}
      </label>
      <select
        id={props.id}
        class={pill ? 'select select--pill language-pill__select' : 'select'}
        value={pending.value ?? language.value}
        onKeyDown={onKeyDown}
        onChange={onChange}
        onBlur={commit}
      >
        {LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LANGUAGE_ENDONYMS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
