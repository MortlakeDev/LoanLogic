// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './results.css';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { FrequencyId, RateMethodId } from '../../engine';
import { ScheduleCard } from '../schedule/ScheduleCard';
import { money } from '../state/display';
import { t } from '../state/i18n';
import {
  engineErrors,
  form,
  headlineMethod,
  inputErrors,
  okResult,
  secondaryMethod,
} from '../state/loan';
import { methodName } from '../state/messages';
import { CostStructure } from './CostStructure';
import { type OkLoanResult, rateText } from './figures';
import { FIX_DELAY_MS, FixFields, FixListDelay, fixListShown, fixListText } from './FixFields';
import { KpiTiles } from './KpiTiles';
import { heroLabel, heroPayment, PaymentHero } from './PaymentHero';
import { RateCard } from './RateCard';
import { Warnings } from './Warnings';

/** The line announced when the results change: "Monthly payment: $2,299.25. APR: 6.974%." */
export function summaryText(
  result: OkLoanResult,
  frequency: FrequencyId,
  headline: RateMethodId,
): string {
  return t('results.summary', {
    label: heroLabel(result.summary, frequency),
    payment: money(heroPayment(result)),
    rateName: methodName(headline),
    rate: rateText(result.rates[headline]) ?? t('rates.na'),
  });
}

/**
 * The results column (DESIGN §7.1): the payment hero with the rate card, warnings, KPI
 * tiles, the cost structure, then the schedule. Invalid input blanks every figure at once
 * (`aria-busy` on the figures) and lists what to fix after a pause (§8.13). Below 64rem the
 * overview is hidden: the mobile summary card carries it (§7.2).
 *
 * The live region announces the results after a pause in typing, or the fix list once it
 * shows, at every width. It stays outside the `aria-busy` element: assistive technology
 * may hold back what changes inside a busy region.
 */
export function ResultsPanel(): JSX.Element {
  const result = okResult.value;
  const shown = fixListShown.value;
  const { frequency, fees } = form.value;
  const headline = headlineMethod.value;
  // The figures update at once; the spoken summary waits for the same pause in typing as
  // the fix list, so a screen reader does not announce every keystroke. It starts with
  // the current summary (nothing is announced on load) and blanks at once while invalid.
  const live = result === null ? '' : summaryText(result, frequency, headline);
  const [spoken, setSpoken] = useState(live);
  useEffect(() => {
    if (live === '') {
      setSpoken('');
      return undefined;
    }
    const timer = setTimeout(() => {
      setSpoken(live);
    }, FIX_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [live]);
  const announcement =
    result !== null ? spoken : shown ? fixListText(inputErrors.value, engineErrors.value) : '';
  return (
    <section class="results" aria-labelledby="results-title">
      <FixListDelay />
      <h2 id="results-title" class="visually-hidden">
        {t('panels.results.title')}
      </h2>
      <p class="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <div class="results__overview" aria-busy={result === null && !shown ? 'true' : undefined}>
        {result === null ? (
          <FixFields class="card" />
        ) : (
          <>
            <div class="card hero-card">
              <PaymentHero result={result} frequency={frequency} />
              <RateCard
                result={result}
                headline={headline}
                secondary={secondaryMethod.value}
                fees={fees}
              />
            </div>
            <Warnings warnings={result.warnings} />
            <KpiTiles result={result} frequency={frequency} />
            <CostStructure summary={result.summary} />
          </>
        )}
      </div>
      <ScheduleCard />
    </section>
  );
}
