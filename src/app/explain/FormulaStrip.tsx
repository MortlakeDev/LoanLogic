// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './explain.css';
import type { JSX } from 'preact';
import type { Explain } from '../../engine';
import { Icon } from '../components/Icon';
import { currencyDigits } from '../state/display';
import { instalmentFormula, stripParts } from '../state/formula';
import { formatLocale, t } from '../state/i18n';
import { openExplain } from '../state/ui';
import { Formula } from './Formula';

/**
 * The instalment's formula strip in the payment hero (DESIGN §8.6): the formula with the
 * engine's values substituted and the result, built from the `explain` payload so that it
 * reproduces the instalment (SPEC §9.6), and the "How it's calculated" action that opens
 * the Explain sheet (§8.12).
 */
export function FormulaStrip(props: { readonly explain: Explain }): JSX.Element {
  const model = instalmentFormula(props.explain, formatLocale.value, currencyDigits.value);
  return (
    <div class="formula-strip">
      <div class="formula-strip__formula num" role="group" aria-label={t('hero.formula')}>
        <Formula parts={stripParts(model)} />
      </div>
      <button
        type="button"
        class="btn btn--accent formula-strip__action"
        onClick={(event) => {
          openExplain({ kind: 'instalment' }, event.currentTarget);
        }}
      >
        {t('hero.howCalculated')}
        <Icon name="arrow-right" />
      </button>
    </div>
  );
}
