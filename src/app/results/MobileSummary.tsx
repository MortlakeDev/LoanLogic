// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './results.css';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { Icon } from '../components/Icon';
import type { FrequencyId, RateMethodId, RepaymentType } from '../../engine';
import { money } from '../state/display';
import { t } from '../state/i18n';
import { form, headlineMethod, okResult, secondaryMethod } from '../state/loan';
import { methodName, repaymentName } from '../state/messages';
import { openExplain } from '../state/ui';
import { CompactBar, useScrolledPast } from './CompactBar';
import { type OkLoanResult, RateLine } from './figures';
import { FixFields, fixListShown } from './FixFields';
import { HeroFigure, HeroMeta, heroLabel } from './PaymentHero';
import { Warnings } from './Warnings';

/**
 * The summary card's content (concept-mobile-zh): payment label with the repayment type,
 * the hero number and meta line, then a 2 × 2 grid of the headline rate, the secondary
 * rate, total interest and total of payments, and the engine's warnings.
 */
export function SummaryContent(props: {
  readonly result: OkLoanResult;
  readonly frequency: FrequencyId;
  readonly repayment: RepaymentType;
  readonly headline: RateMethodId;
  readonly secondary: RateMethodId;
}): JSX.Element {
  const { summary, rates } = props.result;
  // A secondary rate chosen as the headline (Advanced) is not shown twice.
  const methods =
    props.secondary === props.headline ? [props.headline] : [props.headline, props.secondary];
  return (
    <>
      <div class="mobile-summary__head">
        <p class="hero__label">{heroLabel(summary, props.frequency)}</p>
        <span class="badge">{repaymentName(props.repayment)}</span>
      </div>
      <HeroFigure result={props.result} />
      <HeroMeta result={props.result} />
      {/* The desktop hero's formula strip is hidden on mobile; its action stays reachable. */}
      <button
        type="button"
        class="btn btn--accent mobile-summary__explain"
        onClick={(event) => {
          openExplain({ kind: 'instalment' }, event.currentTarget);
        }}
      >
        {t('hero.howCalculated')}
        <Icon name="arrow-right" />
      </button>
      <dl class="mobile-summary__grid">
        {methods.map((method) => (
          <div key={method} class="mobile-summary__item mobile-summary__item--rate">
            <dt class="mobile-summary__label">{methodName(method)}</dt>
            <dd class="mobile-summary__value">
              <RateLine
                method={method}
                rate={rates[method]}
                class={
                  method === props.headline
                    ? 'mobile-summary__rate mobile-summary__rate--headline'
                    : 'mobile-summary__rate'
                }
              />
            </dd>
          </div>
        ))}
        <div class="mobile-summary__item">
          <dt class="mobile-summary__label">{t('kpi.totalInterest')}</dt>
          <dd class="mobile-summary__value mobile-summary__amount num">
            {money(summary.totalInterest)}
          </dd>
        </div>
        <div class="mobile-summary__item">
          <dt class="mobile-summary__label">{t('kpi.totalPayments')}</dt>
          <dd class="mobile-summary__value mobile-summary__amount num">
            {money(summary.totalPayments)}
          </dd>
        </div>
      </dl>
      <Warnings warnings={props.result.warnings} />
    </>
  );
}

/**
 * The mobile summary card (DESIGN §7.2), first on the page below 64rem and hidden above,
 * with the compact bar that replaces it once it scrolls away. Invalid input blanks the
 * figures at once (`aria-busy`) and then shows the same "Fix the highlighted fields" list
 * as the desktop results, at the same moment (`fixListShown`); the results panel's live
 * region announces both.
 */
export function MobileSummary(): JSX.Element {
  const result = okResult.value;
  const shown = fixListShown.value;
  const { frequency, repayment } = form.value;
  const headline = headlineMethod.value;
  const card = useRef<HTMLElement>(null);
  const scrolledPast = useScrolledPast(card);
  return (
    <>
      <section ref={card} class="card mobile-summary" aria-labelledby="summary-title">
        <h2 id="summary-title" class="visually-hidden">
          {t('panels.summary.title')}
        </h2>
        <div
          class="mobile-summary__body"
          aria-busy={result === null && !shown ? 'true' : undefined}
        >
          {result === null ? (
            <FixFields />
          ) : (
            <SummaryContent
              result={result}
              frequency={frequency}
              repayment={repayment}
              headline={headline}
              secondary={secondaryMethod.value}
            />
          )}
        </div>
      </section>
      {scrolledPast && result !== null && (
        <CompactBar result={result} frequency={frequency} headline={headline} />
      )}
    </>
  );
}
