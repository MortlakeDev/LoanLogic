// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import type { RateMethodId } from '../../engine';
import { includedFees, toMinor } from '../state/derived';
import { currencyDigits, money } from '../state/display';
import { rateSourceOf } from '../state/headline';
import { t } from '../state/i18n';
import type { FeeDraft } from '../state/loan';
import { methodName, sourceName } from '../state/messages';
import { type OkLoanResult, RateLine } from './figures';

/** Methods that never include fees (SPEC §9.2): the contract rate and its effective rate. */
const FEE_FREE_METHODS: ReadonlySet<RateMethodId> = new Set(['nominal', 'effective']);

/**
 * What the headline rate includes (DESIGN §8.7): the fees and insurance marked "in the
 * rate", by the user's name when there is one item, else by its kind, or a count and total
 * for several. Items that cost nothing (an empty fee row) are not named.
 */
export function includesText(
  result: OkLoanResult,
  headline: RateMethodId,
  fees: readonly FeeDraft[],
): string {
  if (FEE_FREE_METHODS.has(headline)) {
    return t('rates.includesNone');
  }
  const digits = currencyDigits.value;
  const draftOf = (id: string): FeeDraft | undefined => fees.find((fee) => fee.uid === id);
  const included = includedFees(result.fees, (id) => draftOf(id)?.inApr === true, digits);
  const items = included.items.filter((item) => toMinor(item.total, digits) !== 0n);
  const [only] = items;
  if (only === undefined) {
    return t('rates.includesNone');
  }
  if (items.length > 1) {
    return t('rates.includesMany', { count: items.length, amount: money(included.total) });
  }
  const amount = money(only.total);
  const name = draftOf(only.id)?.name.trim() ?? '';
  if (name !== '') {
    return t('rates.includesNamed', { name, amount });
  }
  switch (only.kind) {
    case 'upfront':
      return t('rates.includesUpfront', { amount });
    case 'periodic':
      return t('rates.includesPeriodic', { amount });
    case 'insurance':
      return t('rates.includesInsurance', { amount });
  }
}

/**
 * The regional rate card (DESIGN §8.7): the headline method with its source badge and
 * value, what it includes, then the contract rate and the secondary rate. Every rate has
 * an explain trigger; a rate that failed shows "n/a" with its reason.
 */
export function RateCard(props: {
  readonly result: OkLoanResult;
  readonly headline: RateMethodId;
  readonly secondary: RateMethodId;
  /** The form's fee rows: their names and "in the rate" flags. */
  readonly fees: readonly FeeDraft[];
}): JSX.Element {
  const { rates } = props.result;
  const source = rateSourceOf(props.headline);
  // A rate chosen as the headline (Advanced) is not repeated below it.
  const others = [
    { method: 'nominal' as const, label: t('rates.contract') },
    { method: props.secondary, label: methodName(props.secondary) },
  ].filter((item) => item.method !== props.headline);
  return (
    <div class="rate-card">
      <div class="rate-card__head">
        <h3 class="rate-card__title">{methodName(props.headline)}</h3>
        {source !== null && <span class="badge">{sourceName(source)}</span>}
      </div>
      <RateLine method={props.headline} rate={rates[props.headline]} class="rate-card__rate" />
      <p class="rate-card__includes">{includesText(props.result, props.headline, props.fees)}</p>
      {others.length > 0 && (
        <dl class="rate-card__more">
          {others.map((item) => (
            <div key={item.method} class="rate-card__item">
              <dt class="rate-card__label">{item.label}</dt>
              <dd class="rate-card__value">
                <RateLine method={item.method} rate={rates[item.method]} class="rate-card__minor" />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
