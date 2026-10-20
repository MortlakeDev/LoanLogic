// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Fragment } from 'preact';
import type { MessageKey, MessageParams } from '../../i18n';
import { t } from '../state/i18n';

// A marker no translation contains, so placeholders survive interpolation intact.
const MARK = '\u0001';

/**
 * A translated message with some placeholders rendered as elements, e.g. the ratio of
 * "You repay {ratio} for every {one} borrowed" in accent mono (DESIGN §8.9). The word
 * order stays the translation's.
 *
 * `nodes` maps placeholders to elements; other placeholders take `params`.
 */
export function Rich(props: {
  readonly message: MessageKey;
  readonly nodes: Readonly<Record<string, ComponentChildren>>;
  readonly params?: MessageParams;
}): JSX.Element {
  const marked = Object.fromEntries(
    Object.keys(props.nodes).map((name) => [name, `${MARK}${name}${MARK}`]),
  );
  const text = t(props.message, { ...props.params, ...marked });
  const pieces = text.split(new RegExp(`${MARK}(\\w+)${MARK}`));
  return (
    <>
      {pieces.map((piece, index) =>
        // split() with a capture group puts the placeholder names at odd indices.
        index % 2 === 1 ? <Fragment key={index}>{props.nodes[piece]}</Fragment> : piece,
      )}
    </>
  );
}
