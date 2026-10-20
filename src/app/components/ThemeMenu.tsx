// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../state/i18n';
import {
  setThemePreference,
  THEME_PREFERENCES,
  themePreference,
  type ThemePreference,
} from '../state/theme';
import { Icon, type IconName } from './Icon';

/** The icon of each choice; the menu button shows the one of the current choice. */
const THEME_ICONS: Readonly<Record<ThemePreference, IconName>> = {
  system: 'monitor',
  dark: 'moon',
  light: 'sun',
};

const PANEL_ID = 'theme-menu-panel';

/**
 * The System / Dark / Light choice as a group of native radios: Tab enters the group at
 * the checked option, arrow keys move the choice, and a choice applies at once.
 *
 * @param props.name The radios' `name`. It must be unique on the page, because the header
 *   menu and the mobile menu sheet each render a group.
 */
export function ThemeOptions(props: { readonly name: string }): JSX.Element {
  return (
    <fieldset class="theme-options">
      <legend class="field__label">{t('theme.label')}</legend>
      <div class="theme-options__list">
        {THEME_PREFERENCES.map((preference) => (
          <label key={preference} class="theme-option">
            <input
              class="theme-option__input"
              type="radio"
              name={props.name}
              value={preference}
              checked={themePreference.value === preference}
              onChange={() => {
                setThemePreference(preference);
              }}
            />
            <Icon name={THEME_ICONS[preference]} class="theme-option__icon" />
            <span>{t(`theme.${preference}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The header's theme control (DESIGN §7.1): an icon button that shows the current choice
 * and opens a small panel with the theme radios. Built from ordinary elements (no
 * `popover`, DESIGN §12) as a disclosure: the button carries `aria-expanded` and
 * `aria-controls`.
 *
 * Opening from the keyboard moves focus to the checked radio; opening with a pointer
 * leaves focus on the button (the panel is the next tab stop), so no focus ring appears
 * under the pointer. A choice applies at once and the panel stays open, because arrow keys
 * change the choice at every step and closing on the first one would stop a keyboard user
 * from browsing the options. Esc closes the panel and returns focus to the button; a click
 * outside or moving focus outside (Tab) closes it and leaves focus where the user put it.
 */
export function ThemeMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    if (focusOnOpen.current) {
      panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    // A pointer press or a focus move that lands outside the control closes the panel.
    const onOutside = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || root.current?.contains(target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
    };
  }, [open]);

  return (
    <div ref={root} class="theme-menu">
      <button
        ref={button}
        type="button"
        class="btn btn--icon"
        aria-label={t('theme.label')}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={(event) => {
          // Enter and Space fire a click without a pointer press (`detail` 0).
          focusOnOpen.current = event.detail === 0;
          setOpen(!open);
        }}
      >
        <Icon name={THEME_ICONS[themePreference.value]} />
      </button>
      <div ref={panel} id={PANEL_ID} class="theme-menu__panel" hidden={!open}>
        <ThemeOptions name="theme" />
      </div>
    </div>
  );
}
