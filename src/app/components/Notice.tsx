// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';

/** An info, warning or error line (DESIGN §8.13): icon plus text, never color alone. */
export function Notice(props: {
  readonly tone: 'info' | 'warning' | 'danger' | 'success';
  readonly class?: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  const icon =
    props.tone === 'success' ? 'check' : props.tone === 'info' ? 'info' : 'alert-triangle';
  return (
    <div
      class={`notice notice--${props.tone}${props.class === undefined ? '' : ` ${props.class}`}`}
    >
      <Icon name={icon} class="notice__icon" />
      <div class="notice__text">{props.children}</div>
    </div>
  );
}
