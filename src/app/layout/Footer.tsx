// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { AUTHOR, COPYRIGHT_YEAR, LICENSE_ID, LICENSE_URL, SOURCE_CODE_URL } from '../../config';
import { t } from '../state/i18n';

/**
 * Link that opens in a new tab without giving the target page `window.opener` or a
 * referrer, and tells screen-reader users that it opens a new tab.
 */
function ExternalLink(props: { href: string; children: string }): JSX.Element {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer">
      {props.children} <span class="visually-hidden">{t('footer.opensInNewTab')}</span>
    </a>
  );
}

/**
 * Page footer (DESIGN §7.1): copyright, links to the license and to the source code (the
 * AGPL "Source" offer) on the left; the on-device privacy note and the not-financial-advice
 * disclaimer on the right. On mobile the two parts stack.
 */
export function Footer(): JSX.Element {
  return (
    <footer class="app-footer">
      <div class="app-footer__inner">
        <p class="app-footer__legal">
          <span>{t('footer.copyright', { year: COPYRIGHT_YEAR, author: AUTHOR })}</span>
          <span class="app-footer__separator" aria-hidden="true">
            ·
          </span>
          <span>
            <ExternalLink href={LICENSE_URL}>{LICENSE_ID}</ExternalLink>
          </span>
          <span class="app-footer__separator" aria-hidden="true">
            ·
          </span>
          <span>
            <ExternalLink href={SOURCE_CODE_URL}>{t('footer.sourceCode')}</ExternalLink>
          </span>
        </p>
        <div class="app-footer__notes">
          <p>{t('footer.privacy')}</p>
          <p>{t('footer.disclaimer')}</p>
        </div>
      </div>
    </footer>
  );
}
