// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Fragment } from 'preact';
import type { FrequencyId, LoanSummary } from '../../engine';
import { Rich } from '../components/Rich';
import { FormulaStrip } from '../explain/FormulaStrip';
import { toMinor } from '../state/derived';
import { currencyDigits, date, money } from '../state/display';
import { t } from '../state/i18n';
import { paymentLabel } from '../state/messages';
import { HeroAmount, type OkLoanResult } from './figures';

/** Equal principal has no regular instalment: its payments go down (SPEC §5.3). */
function isEqualPrincipal(summary: LoanSummary): boolean {
  return summary.principalPerPeriod !== null;
}

/**
 * The payment's label (DESIGN §8.6): named after the frequency ("Monthly payment"), or
 * "First payment" for equal principal.
 */
export function heroLabel(summary: LoanSummary, frequency: FrequencyId): string {
  return isEqualPrincipal(summary) ? t('hero.firstPayment') : paymentLabel(frequency);
}

/**
 * The payment the hero shows: the regular instalment (annuity, balloon), else the first
 * payment (equal principal; interest-only, whose principal comes with the last payment).
 */
export function heroPayment(summary: LoanSummary): string {
  return summary.regularInstalment ?? summary.firstPayment;
}

/** An amount inside running text, in mono (DESIGN §1). */
function inlineAmount(value: string): JSX.Element {
  return <span class="num hero-meta__amount">{money(value)}</span>;
}

/**
 * The meta line under the hero number (DESIGN §8.6): "360 payments · final payment
 * $2,300.28 · paid off Nov 1, 2056", with the balloon for a balloon loan.
 */
export function HeroMeta(props: { readonly summary: LoanSummary }): JSX.Element {
  const { summary } = props;
  const items: { readonly key: string; readonly content: ComponentChildren }[] = [
    { key: 'payments', content: t('hero.payments', { count: summary.paymentsCount }) },
    {
      key: 'final',
      content: (
        <Rich message="hero.finalPayment" nodes={{ amount: inlineAmount(summary.lastPayment) }} />
      ),
    },
  ];
  // After an early close the balloon is zero: there is no lump sum to mention.
  if (summary.balloon !== null && toMinor(summary.balloon, currencyDigits.value) !== 0n) {
    items.push({
      key: 'balloon',
      content: (
        <Rich message="hero.balloonIncluded" nodes={{ amount: inlineAmount(summary.balloon) }} />
      ),
    });
  }
  items.push({ key: 'paidOff', content: t('hero.paidOff', { date: date(summary.payoffDate) }) });
  return (
    <p class="hero-meta">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <span class="hero-meta__separator"> · </span>}
          <span>{item.content}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The hero number over its dotted grid, with the range to the last payment for equal
 * principal ("→ last $972.00").
 */
export function HeroFigure(props: { readonly summary: LoanSummary }): JSX.Element {
  const { summary } = props;
  return (
    <div class="hero__figure">
      <HeroAmount value={heroPayment(summary)} />
      {isEqualPrincipal(summary) && (
        <p class="hero__range">
          <Rich message="hero.lastPayment" nodes={{ amount: inlineAmount(summary.lastPayment) }} />
        </p>
      )}
    </div>
  );
}

/**
 * The payment hero (DESIGN §8.6): label, hero number, meta line and the formula strip
 * with "How it's calculated".
 */
export function PaymentHero(props: {
  readonly result: OkLoanResult;
  readonly frequency: FrequencyId;
}): JSX.Element {
  const { summary } = props.result;
  return (
    <div class="hero">
      <h3 class="hero__label">{heroLabel(summary, props.frequency)}</h3>
      <HeroFigure summary={summary} />
      <HeroMeta summary={summary} />
      <FormulaStrip explain={props.result.explain} />
    </div>
  );
}
