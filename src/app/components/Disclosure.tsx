// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';

/**
 * A disclosure (DESIGN §8.5): a full-width button with a title, a status line and a
 * chevron, `aria-expanded`, controlling the content below it. Open state is the caller's
 * (a signal), so other components can open it (an error inside, DESIGN §8.13).
 */
export function Disclosure(props: {
  /** Base id: the button is `${id}-button`, the content `${id}-content`. */
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly class?: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  const contentId = `${props.id}-content`;
  return (
    <div
      class={`disclosure${props.open ? ' disclosure--open' : ''}${props.class === undefined ? '' : ` ${props.class}`}`}
    >
      <button
        id={`${props.id}-button`}
        type="button"
        class="disclosure__button"
        aria-expanded={props.open}
        aria-controls={contentId}
        onClick={() => {
          props.onToggle(!props.open);
        }}
      >
        <span class="disclosure__heading">
          <span class="disclosure__title">{props.title}</span>
          {props.status !== undefined && <span class="disclosure__status">{props.status}</span>}
        </span>
        <Icon name="chevron-down" class="disclosure__chevron" />
      </button>
      {/* Three layers so the height can slide (DESIGN §8.5): a grid row from 0fr to 1fr,
          a clipping box that may shrink to nothing, and the padded content. */}
      <div id={contentId} class="disclosure__content">
        <div class="disclosure__inner">
          <div class="disclosure__body">{props.children}</div>
        </div>
      </div>
    </div>
  );
}
