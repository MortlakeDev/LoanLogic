// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import type { FormulaText } from '../state/formula';
import { t } from '../state/i18n';
import { dayCountName } from '../state/messages';

/**
 * Renders formula parts (`src/app/state/formula.ts`): text, superscripts and subscripts as
 * `<sup>`/`<sub>`, and words (a day-count method, a time basis) in the UI language.
 */
export function Formula(props: { readonly parts: FormulaText }): JSX.Element {
  return (
    <>
      {props.parts.map((part, index) => {
        switch (part.kind) {
          case 'text':
            return part.text;
          case 'sup':
            return (
              <sup key={index}>
                <Formula parts={part.parts} />
              </sup>
            );
          case 'sub':
            return (
              <sub key={index}>
                <Formula parts={part.parts} />
              </sub>
            );
          case 'dayCount':
            return dayCountName(part.id);
          case 'message':
            return t(part.key);
        }
      })}
    </>
  );
}
