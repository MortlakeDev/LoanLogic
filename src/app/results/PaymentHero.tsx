// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Fragment } from 'preact';
import type { FrequencyId, LoanSummary } from '../../engine';
import type { MessageKey } from '../../i18n';
import { Rich } from '../components/Rich';
import { FormulaStrip } from '../explain/FormulaStrip';
import { chargedKinds, type HeroAmounts, heroAmounts, toMinor } from '../state/derived';
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

/** The hero's amounts of a result, in the form's currency (`heroAmounts`). */
function amountsOf(result: OkLoanResult): HeroAmounts {
  return heroAmounts(result.summary, result.rows, currencyDigits.value);
}

/**
 * The payment the hero shows, on the instalment basis (principal + interest): the regular
 * instalment (annuity, balloon), else the first payment's (equal principal; interest-only,
 * whose principal comes with the last payment). Every view of the payment uses it.
 */
export function heroPayment(result: OkLoanResult): string {
  return amountsOf(result).payment;
}

/** An amount inside running text, in mono (DESIGN §1). */
function inlineAmount(value: string): JSX.Element {
  return <span class="num hero-meta__amount">{money(value)}</span>;
}

/**
 * The meta line under the hero number (DESIGN §8.6): "360 payments · final payment
 * $2,300.28 · paid off Nov 1, 2056", with the first payment as paid when payments carry
 * periodic fees or insurance (the hero shows principal + interest only) and the balloon
 * for a balloon loan.
 */
export function HeroMeta(props: { readonly result: OkLoanResult }): JSX.Element {
  const { summary } = props.result;
  const amounts = amountsOf(props.result);
  const items: { readonly key: string; readonly content: ComponentChildren }[] = [
    { key: 'payments', content: t('hero.payments', { count: summary.paymentsCount }) },
  ];
  if (amounts.firstPaid !== null) {
    // Name what the first payment adds to the instalment: periodic fees, insurance or both.
    const charged = chargedKinds(props.result.fees, currencyDigits.value);
    const message: MessageKey =
      charged.periodic && !charged.insurance
        ? 'hero.firstWithFees'
        : charged.insurance && !charged.periodic
          ? 'hero.firstWithInsurance'
          : 'hero.firstWithFeesInsurance';
    items.push({
      key: 'withFees',
      content: <Rich message={message} nodes={{ amount: inlineAmount(amounts.firstPaid) }} />,
    });
  }
  items.push({
    key: 'final',
    content: <Rich message="hero.finalPayment" nodes={{ amount: inlineAmount(amounts.last) }} />,
  });
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
          <span class="hero-meta__item">{item.content}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The hero number over its dotted grid, with the range to the last payment for equal
 * principal ("→ last $972.00").
 */
export function HeroFigure(props: { readonly result: OkLoanResult }): JSX.Element {
  const amounts = amountsOf(props.result);
  return (
    <div class="hero__figure">
      <HeroAmount value={amounts.payment} />
      {isEqualPrincipal(props.result.summary) && (
        <p class="hero__range">
          <Rich message="hero.lastPayment" nodes={{ amount: inlineAmount(amounts.last) }} />
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
      <HeroFigure result={props.result} />
      <HeroMeta result={props.result} />
      <FormulaStrip explain={props.result.explain} />
    </div>
  );
}
