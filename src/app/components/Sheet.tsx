// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside a container, in document order. */
function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** A named radio button: its whole group is one tab stop. */
function isGroupedRadio(element: Element | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === 'radio' && element.name !== '';
}

/**
 * The tab stops inside a container, in order. A radio group is one stop (Tab enters it at
 * the checked radio, or the first when none is checked), so it is counted once.
 */
function tabStops(container: HTMLElement): HTMLElement[] {
  const items = focusables(container);
  return items.filter((element) => {
    if (!isGroupedRadio(element)) {
      return true;
    }
    const group = items.filter(
      (other): other is HTMLInputElement => isGroupedRadio(other) && other.name === element.name,
    );
    return (group.find((radio) => radio.checked) ?? group[0]) === element;
  });
}

/** Whether focus is on a tab stop, counting any radio of a stop's group as that stop. */
function isOnStop(active: Element | null, stop: HTMLElement): boolean {
  return (
    active === stop || (isGroupedRadio(active) && isGroupedRadio(stop) && active.name === stop.name)
  );
}

/**
 * A modal sheet (DESIGN §8.12): a side sheet on desktop, a bottom sheet on mobile. Built
 * from ordinary elements (no `popover`, no `<dialog>`, DESIGN §12): `role="dialog"` with
 * `aria-modal`, focus moves into it on open and is trapped while it is open, Esc and the
 * backdrop close it, and focus returns to the element that had it before (or to the
 * caller's `onClose`, which may restore it itself).
 */
export function Sheet(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The `id` of the element that names the dialog (its heading). */
  readonly labelledBy: string;
  readonly closeLabel: string;
  readonly class?: string;
  readonly children: ComponentChildren;
}): JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // The latest close handler, for the key listener registered once per opening.
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = panel.current;
    // Esc closes; Tab and Shift+Tab wrap between the first and the last tab stop. A native
    // listener, because a dialog is not an interactive element in JSX terms.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose.current();
        return;
      }
      if (event.key !== 'Tab' || container === null) {
        return;
      }
      const stops = tabStops(container);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      // A click on plain text inside focuses the panel itself (tabIndex -1); Tab and
      // Shift+Tab from there would leave the dialog without this.
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && isOnStop(document.activeElement, first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && isOnStop(document.activeElement, last)) {
        event.preventDefault();
        first.focus();
      }
    };
    if (container !== null) {
      container.addEventListener('keydown', onKeyDown);
      (focusables(container)[0] ?? container).focus();
    }
    return () => {
      container?.removeEventListener('keydown', onKeyDown);
      // Return focus unless the caller already moved it elsewhere on purpose: after the
      // sheet is gone, focus is on the body (or still inside the closing panel).
      const previous = opener.current;
      const active = document.activeElement;
      const lost =
        active === null || active === document.body || container?.contains(active) === true;
      if (previous?.isConnected === true && lost) {
        previous.focus();
      }
    };
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <div class="sheet-layer">
      <div class="sheet-backdrop" aria-hidden="true" onClick={props.onClose} />
      <div
        ref={panel}
        class={`sheet${props.class === undefined ? '' : ` ${props.class}`}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        tabIndex={-1}
      >
        <button
          type="button"
          class="btn btn--icon sheet__close"
          aria-label={props.closeLabel}
          onClick={props.onClose}
        >
          <Icon name="x" />
        </button>
        {props.children}
      </div>
    </div>
  );
}
