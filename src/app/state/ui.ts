// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * View state shared between components: which disclosures and sheets are open, and
 * moving focus to the input of a field (DESIGN §8.13: the error list leads to the field).
 * Nothing here affects a calculation.
 */

import { signal } from '@preact/signals';
import type { RateMethodId } from '../../engine';
import { ADVANCED_FIELDS, type FieldPath, inputIdFor } from './loan';

/** The Advanced disclosure of the inputs panel (DESIGN §8.5). */
export const advancedOpen = signal(false);

/**
 * The mobile disclosure that holds fees and the advanced settings (DESIGN §7.2). On
 * desktop its content is always shown.
 */
export const moreOpen = signal(false);

/** What the Explain sheet explains: the instalment, a rate method, or nothing (closed). */
export type ExplainTarget =
  { readonly kind: 'instalment' } | { readonly kind: 'rate'; readonly method: RateMethodId };

/** The open Explain sheet (DESIGN §8.12), or `null`. */
export const explainTarget = signal<ExplainTarget | null>(null);

/**
 * The element that opened the Explain sheet, so focus returns to it on close even when
 * the sheet was opened from a component that re-rendered meanwhile.
 */
let explainOpener: HTMLElement | null = null;

/** Opens the Explain sheet and remembers the trigger for focus return. */
export function openExplain(target: ExplainTarget, opener: HTMLElement | null): void {
  explainOpener = opener;
  explainTarget.value = target;
}

/** Closes the Explain sheet and returns focus to the element that opened it. */
export function closeExplain(): void {
  explainTarget.value = null;
  const opener = explainOpener;
  explainOpener = null;
  if (opener?.isConnected === true) {
    opener.focus();
  }
}

/**
 * Opens whatever hides a field (the Advanced disclosure, the mobile "more" disclosure),
 * then focuses its input once it has rendered.
 *
 * @param field A UI field path (`amount`, `fee:<uid>.value`, …) or the fees section
 *   (`fees`), whose section element carries the id `field-fees`.
 */
export function focusField(field: FieldPath, doc: Document = document): void {
  if (ADVANCED_FIELDS.has(field)) {
    advancedOpen.value = true;
    moreOpen.value = true;
  } else if (field === 'fees' || field.startsWith('fee:')) {
    moreOpen.value = true;
  }
  // Disclosures render on the next frame; focus after that.
  requestAnimationFrame(() => {
    // Focusing scrolls the input into view; scroll padding keeps it clear of sticky bars.
    doc.getElementById(inputIdFor(field))?.focus();
  });
}
