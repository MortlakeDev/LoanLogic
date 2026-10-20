// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX, RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { FrequencyId, RateMethodId } from '../../engine';
import { money } from '../state/display';
import { t } from '../state/i18n';
import { methodName } from '../state/messages';
import { type OkLoanResult, rateText } from './figures';
import { heroLabel, heroPayment } from './PaymentHero';

/**
 * Whether an element has scrolled above the viewport. Without `IntersectionObserver` it
 * stays `false`: the compact bar then never shows, and nothing is lost but a shortcut.
 */
export function useScrolledPast(ref: RefObject<Element>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null || !('IntersectionObserver' in window)) {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) {
        // Below the viewport, or not laid out at all (desktop), is not "scrolled past".
        setPast(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return past;
}

/**
 * The compact bar of DESIGN §7.2 (PLAN K2): once the summary card has scrolled away, the
 * payment and the headline rate stay at the top of the screen. Mobile only.
 */
export function CompactBar(props: {
  readonly result: OkLoanResult;
  readonly frequency: FrequencyId;
  readonly headline: RateMethodId;
}): JSX.Element {
  const { summary, rates } = props.result;
  return (
    <section class="compact-bar" aria-label={t('results.compactBar')}>
      <p class="compact-bar__item">
        <span class="compact-bar__label">{heroLabel(summary, props.frequency)}</span>
        <span class="compact-bar__value num">{money(heroPayment(props.result))}</span>
      </p>
      <p class="compact-bar__item compact-bar__item--end">
        <span class="compact-bar__label">{methodName(props.headline)}</span>
        <span class="compact-bar__value compact-bar__rate num">
          {rateText(rates[props.headline]) ?? t('rates.na')}
        </span>
      </p>
    </section>
  );
}
