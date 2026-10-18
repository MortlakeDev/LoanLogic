// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { AUTHOR, COPYRIGHT_YEAR, LICENSE_ID, LICENSE_URL, SOURCE_CODE_URL } from '../../config';
import { t } from '../state/i18n';

function ExternalLink(props: { href: string; children: string }): JSX.Element {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer">
      {props.children} <span class="visually-hidden">{t('footer.opensInNewTab')}</span>
    </a>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer class="app-footer">
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
      <p class="app-footer__note">{t('footer.privacy')}</p>
      <p class="app-footer__note">{t('footer.disclaimer')}</p>
    </footer>
  );
}
