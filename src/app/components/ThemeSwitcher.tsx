// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { t } from '../state/i18n';
import {
  setThemePreference,
  THEME_PREFERENCES,
  themePreference,
  type ThemePreference,
} from '../state/theme';

const ICON_PATHS: Readonly<Record<ThemePreference, string>> = {
  system: 'M3 5h18v11H3zM8 20h8M12 16v4',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  light:
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.5v2M12 20.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1.5 12h2M20.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
};

/** Segmented System / Dark / Light control built on native radio buttons. */
export function ThemeSwitcher(): JSX.Element {
  return (
    <fieldset class="segmented">
      <legend class="visually-hidden">{t('theme.label')}</legend>
      {THEME_PREFERENCES.map((preference) => (
        <label key={preference} class="segmented__option">
          <input
            class="segmented__input"
            type="radio"
            name="theme"
            value={preference}
            checked={themePreference.value === preference}
            onChange={() => {
              setThemePreference(preference);
            }}
          />
          <span class="segmented__face">
            <svg class="segmented__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={ICON_PATHS[preference]} />
            </svg>
            <span class="segmented__text">{t(`theme.${preference}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
