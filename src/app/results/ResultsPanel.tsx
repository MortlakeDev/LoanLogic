// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './results.css';
import type { JSX } from 'preact';
import type { FrequencyId, RateMethodId } from '../../engine';
import { ScheduleCard } from '../schedule/ScheduleCard';
import { money } from '../state/display';
import { t } from '../state/i18n';
import { form, headlineMethod, okResult, secondaryMethod } from '../state/loan';
import { methodName } from '../state/messages';
import { CostStructure } from './CostStructure';
import { type OkLoanResult, rateText } from './figures';
import { FixFields } from './FixFields';
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
    payment: money(heroPayment(result.summary)),
    rateName: methodName(headline),
    rate: rateText(result.rates[headline]) ?? t('rates.na'),
  });
}

/**
 * The results column (DESIGN §7.1): the payment hero with the rate card, warnings, KPI
 * tiles, the cost structure, then the schedule. Invalid input blanks every figure at once
 * (`aria-busy`) and lists what to fix after a pause (§8.13). Below 64rem the overview is
 * hidden: the mobile summary card carries it (§7.2).
 */
export function ResultsPanel(): JSX.Element {
  const result = okResult.value;
  const { frequency, fees } = form.value;
  const headline = headlineMethod.value;
  return (
    <section
      class="results"
      aria-labelledby="results-title"
      aria-busy={result === null ? 'true' : undefined}
    >
      <h2 id="results-title" class="visually-hidden">
        {t('panels.results.title')}
      </h2>
      <p class="visually-hidden" aria-live="polite">
        {result === null ? '' : summaryText(result, frequency, headline)}
      </p>
      <div class="results__overview">
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
