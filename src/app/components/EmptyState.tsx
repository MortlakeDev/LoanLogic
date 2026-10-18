// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';

export interface EmptyStateProps {
  readonly title: string;
  readonly text: string;
  /** Decorative illustration; hidden from assistive technology. */
  readonly illustration: ComponentChildren;
}

/** Placeholder content for a panel that has nothing to show yet. */
export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class="empty-state">
      <div class="empty-state__art" aria-hidden="true">
        {props.illustration}
      </div>
      <p class="empty-state__title">{props.title}</p>
      <p class="empty-state__text">{props.text}</p>
    </div>
  );
}
