// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import type { EngineWarning, WarningCode } from '../../engine';
import { Notice } from '../components/Notice';
import { warningMessage } from '../state/messages';

/**
 * Notice tone per warning: a likely input mistake (a rate above 100 %) or an ambiguous
 * figure (several rates fit) is a warning; a negative rate and an early payoff describe a
 * valid loan, so they are information.
 */
const TONES: Readonly<Record<WarningCode, 'info' | 'warning'>> = {
  RATE_NEGATIVE: 'info',
  RATE_HIGH: 'warning',
  EARLY_CLOSE: 'info',
  IRR_MULTIPLE: 'warning',
};

/** The engine's warnings as notice lines under the hero (DESIGN §8.13). */
export function Warnings(props: {
  readonly warnings: readonly EngineWarning[];
}): JSX.Element | null {
  if (props.warnings.length === 0) {
    return null;
  }
  return (
    <div class="results-warnings">
      {props.warnings.map((warning) => (
        <Notice key={warning.code} tone={TONES[warning.code]}>
          {warningMessage(warning)}
        </Notice>
      ))}
    </div>
  );
}
