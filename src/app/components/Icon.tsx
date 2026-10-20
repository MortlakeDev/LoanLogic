// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';

/**
 * The icon set of DESIGN §10, drawn for this project on a 24 px grid: strokes in
 * `currentColor` with round caps and joins (stroke width from CSS, `.icon`).
 */
const ICON_PATHS = {
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  'chevron-down': 'M6 9l6 6 6-6',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  monitor:
    'M4 4.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1zM8 20.5h8M12 16.5v4',
  share: 'M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  download: 'M12 3v12M7.5 10.5L12 15l4.5-4.5M5 20h14',
  calendar:
    'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM4 10h16M8.5 3v4M15.5 3v4',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'alert-triangle': 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5h.01',
  x: 'M6 6l12 12M18 6L6 18',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v5.5M12 7.75h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** A decorative icon (hidden from assistive technology; the control carries the name). */
export function Icon(props: { readonly name: IconName; readonly class?: string }): JSX.Element {
  return (
    <svg
      class={props.class === undefined ? 'icon' : `icon ${props.class}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[props.name]} />
    </svg>
  );
}
