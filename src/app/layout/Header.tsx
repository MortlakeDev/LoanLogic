// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { APP_NAME, AUTHOR } from '../../config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { t } from '../state/i18n';

/**
 * Page header: the wordmark (the page's `<h1>`) with the author byline, and the
 * language and theme controls in a labelled group.
 */
export function Header(): JSX.Element {
  return (
    <header class="app-header">
      <div class="brand">
        <h1 class="brand__wordmark">{APP_NAME}</h1>
        <p class="brand__byline">{t('header.byline', { author: AUTHOR })}</p>
      </div>
      <div class="app-header__controls" role="group" aria-label={t('header.settings')}>
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </header>
  );
}
