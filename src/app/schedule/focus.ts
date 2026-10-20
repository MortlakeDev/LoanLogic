// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Moves focus to an element by id once the component has rendered again: for a control
 * that disappears when pressed ("Show more"), so keyboard focus continues where the new
 * content starts instead of falling back to the page.
 *
 * @returns A function that requests focus on the element with that id after the next
 *   render. The target needs `tabIndex={-1}` if it is not focusable by itself.
 */
export function useFocusAfterRender(): (id: string) => void {
  const pending = useRef<string | null>(null);

  // A layout effect: focus moves in the same task as the pressed control disappears, so it
  // never rests on <body> in between.
  useLayoutEffect(() => {
    const id = pending.current;
    if (id !== null) {
      pending.current = null;
      document.getElementById(id)?.focus();
    }
  });

  return (id: string) => {
    pending.current = id;
  };
}
