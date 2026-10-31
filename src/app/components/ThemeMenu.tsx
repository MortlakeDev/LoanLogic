// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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

const BUTTON_ID = 'theme-menu-button';
const MENU_ID = 'theme-menu';
const LAST = THEME_PREFERENCES.length - 1;

/**
 * The System / Dark / Light choice as a group of native radios: Tab enters the group at
 * the checked option, arrow keys move the choice, and a choice applies at once. The mobile
 * menu sheet uses it: a settings sheet, unlike the header's menu.
 *
 * @param props.name The radios' `name`. It must be unique on the page.
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
 * and opens a menu of System, Dark and Light, following the WAI-ARIA menu button pattern
 * with `menuitemradio` items. Built from ordinary elements (no `popover`, DESIGN §12).
 *
 * Opening (a click, Enter, Space or ArrowDown) moves focus to the checked item, ArrowUp to
 * the last one. Arrow keys, Home and End only move focus (a roving tab stop), so a keyboard
 * user can look at every option without changing the theme; a click, Enter or Space on an
 * item applies it, closes the menu and returns focus to the button. Esc closes the menu
 * and returns focus to the button. Tab closes it and lets focus move on; a press outside,
 * or focus moving outside, closes it and leaves focus where the user put it.
 */
export function ThemeMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  // The item that holds the roving tab stop and takes focus when the menu opens.
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);

  const openAt = (index: number): void => {
    setActive(index);
    setOpen(true);
  };

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) {
      button.current?.focus();
    }
  };

  const choose = (preference: ThemePreference): void => {
    setThemePreference(preference);
    close(true);
  };

  // A layout effect, so focus is inside the menu before the browser handles the next key:
  // a quick ArrowDown right after Enter must already move between the items.
  useLayoutEffect(() => {
    if (open) {
      items.current[active]?.focus();
    }
  }, [open, active]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    // On the document rather than the menu: a press on the menu's padding can leave focus
    // on the body, and Esc must still close the menu.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    // A pointer press or a focus move that lands outside the control closes the menu.
    const onOutside = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || root.current?.contains(target) !== true) {
        close(false);
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

  const onItemKeyDown = (
    event: KeyboardEvent,
    index: number,
    preference: ThemePreference,
  ): void => {
    switch (event.key) {
      case 'ArrowDown':
        setActive(index === LAST ? 0 : index + 1);
        break;
      case 'ArrowUp':
        setActive(index === 0 ? LAST : index - 1);
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(LAST);
        break;
      case 'Enter':
      case ' ':
        choose(preference);
        break;
      case 'Tab':
        // Not prevented: the browser moves focus on (Shift+Tab lands on the button) while
        // the menu is still shown, then it hides.
        close(false);
        return;
      default:
        return;
    }
    // The keys above would otherwise scroll the page.
    event.preventDefault();
  };

  const checkedIndex = Math.max(0, THEME_PREFERENCES.indexOf(themePreference.value));

  return (
    <div ref={root} class="theme-menu">
      <button
        ref={button}
        id={BUTTON_ID}
        type="button"
        class="btn btn--icon"
        aria-label={t('theme.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={MENU_ID}
        onClick={() => {
          // Enter and Space on the button arrive here as clicks too.
          if (open) {
            close(true);
          } else {
            openAt(checkedIndex);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAt(event.key === 'ArrowDown' ? checkedIndex : LAST);
          }
        }}
      >
        <Icon name={THEME_ICONS[themePreference.value]} />
      </button>
      <div
        id={MENU_ID}
        class="theme-menu__list"
        role="menu"
        aria-labelledby={BUTTON_ID}
        hidden={!open}
        // Focusable from script only (APG menu); the items carry the roving tab stop.
        tabIndex={-1}
        // A press on the padding or between items would blur the focused item to the body
        // and strand the keyboard; items still receive their clicks.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
      >
        {THEME_PREFERENCES.map((preference, index) => {
          const checked = themePreference.value === preference;
          return (
            <div
              key={preference}
              ref={(element) => {
                items.current[index] = element;
              }}
              class="theme-menu__item"
              role="menuitemradio"
              aria-checked={checked}
              tabIndex={index === active ? 0 : -1}
              onClick={() => {
                choose(preference);
              }}
              onKeyDown={(event) => {
                onItemKeyDown(event, index, preference);
              }}
              onFocus={() => {
                // A press on an item focuses it too; keep the tab stop where focus is.
                setActive(index);
              }}
            >
              {/* The check mark shows the choice without relying on colour. */}
              <span class="theme-menu__check">{checked ? <Icon name="check" /> : null}</span>
              <Icon name={THEME_ICONS[preference]} class="theme-menu__icon" />
              <span>{t(`theme.${preference}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
