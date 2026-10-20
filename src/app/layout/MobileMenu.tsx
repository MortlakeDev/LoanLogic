// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Sheet } from '../components/Sheet';
import { ThemeOptions } from '../components/ThemeMenu';
import { t } from '../state/i18n';

const TITLE_ID = 'mobile-menu-title';

/**
 * The mobile header's menu (DESIGN §7.2): a button that opens a bottom sheet with the
 * theme radios and the language select, which the desktop header shows inline. The button
 * is hidden on desktop by CSS; the sheet's own ids and radio name differ from the
 * header's, so both can exist at once.
 */
export function MobileMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  // Return focus explicitly: a button clicked in Safari does not take focus, so the
  // sheet's own focus return could not find it.
  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class="btn btn--icon mobile-menu__button"
        aria-label={t('header.menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="menu" />
      </button>
      <Sheet
        open={open}
        onClose={close}
        labelledBy={TITLE_ID}
        closeLabel={t('header.closeMenu')}
        class="mobile-menu"
      >
        <h2 id={TITLE_ID} class="mobile-menu__title">
          {t('header.menuTitle')}
        </h2>
        {/* The radio group comes before the select on purpose: the sheet's focus trap wraps
            from its last focusable input, which is not a tab stop when it is an unchecked
            radio, so Tab from a last radio group would leave the dialog. */}
        <ThemeOptions name="menu-theme" />
        <LanguageSwitcher id="menu-language-select" variant="field" />
      </Sheet>
    </>
  );
}
