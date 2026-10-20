// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { AUTHOR } from '../../config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeMenu } from '../components/ThemeMenu';
import { Wordmark } from '../components/Wordmark';
import { t } from '../state/i18n';
import { MobileMenu } from './MobileMenu';

/**
 * Page header (DESIGN §7): the wordmark as the page's only `<h1>` (named "LoanLogic" by
 * the wordmark's label) with the author byline. On desktop the language pill and the
 * theme menu sit in a labelled group on the right; on mobile (< 64rem) CSS hides that
 * group and the byline and shows the menu button, whose sheet holds the same settings.
 */
export function Header(): JSX.Element {
  return (
    <header class="app-header">
      <div class="app-header__inner">
        <div class="brand">
          <h1 class="brand__title">
            <Wordmark />
          </h1>
          <p class="brand__byline">{t('header.byline', { author: AUTHOR })}</p>
        </div>
        <div class="app-header__controls" role="group" aria-label={t('header.settings')}>
          <LanguageSwitcher id="language-select" variant="pill" />
          <ThemeMenu />
        </div>
        <MobileMenu />
      </div>
    </header>
  );
}
