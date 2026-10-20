// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import type { FrequencyId } from '../../engine';
import type { MessageKey } from '../../i18n';
import { chargedKinds, costStructure, durationOf, toMinor } from '../state/derived';
import { currencyDigits, money } from '../state/display';
import { t } from '../state/i18n';
import { Changing, type OkLoanResult } from './figures';

/**
 * "Over 30 years", "Over 2 years 6 months", or "Over 100 payments" when the payments do
 * not fill whole months (a weekly loan of 100 payments).
 */
export function overText(paymentsCount: number, frequency: FrequencyId): string {
  const duration = durationOf(paymentsCount, frequency);
  if (duration === null) {
    return t('kpi.overPayments', { count: paymentsCount });
  }
  const years = t('duration.years', { count: duration.years });
  const months = t('duration.months', { count: duration.months });
  const text =
    duration.months === 0
      ? years
      : duration.years === 0
        ? months
        : t('duration.yearsMonths', { years, months });
  return t('kpi.over', { duration: text });
}

/** What the total of payments covers, by the per-payment items the loan charges. */
function paymentsCaption(periodic: boolean, insurance: boolean): MessageKey {
  if (periodic) {
    return insurance ? 'kpi.paymentsCaptionFeesInsurance' : 'kpi.paymentsCaptionFees';
  }
  return insurance ? 'kpi.paymentsCaptionInsurance' : 'kpi.paymentsCaption';
}

interface Tile {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly accent: boolean;
}

/**
 * The KPI tiles (DESIGN §8.8): total interest (accent, a cost), total cost of credit and
 * total of payments, each with a caption on what it covers.
 */
export function KpiTiles(props: {
  readonly result: OkLoanResult;
  readonly frequency: FrequencyId;
}): JSX.Element {
  const { summary, fees } = props.result;
  const digits = currencyDigits.value;
  const feesPart = costStructure(summary, digits).parts.find((part) => part.key === 'fees');
  const hasFees = feesPart !== undefined && toMinor(feesPart.amount, digits) !== 0n;
  // Periodic fees and insurance are part of each payment; upfront fees are not.
  const charged = chargedKinds(fees, digits);
  const tiles: readonly Tile[] = [
    {
      key: 'interest',
      label: t('kpi.totalInterest'),
      value: money(summary.totalInterest),
      caption: overText(summary.paymentsCount, props.frequency),
      accent: true,
    },
    {
      key: 'cost',
      label: t('kpi.costOfCredit'),
      value: money(summary.costOfCredit),
      caption: t(hasFees ? 'kpi.costCaption' : 'kpi.costCaptionInterest'),
      accent: false,
    },
    {
      key: 'payments',
      label: t('kpi.totalPayments'),
      value: money(summary.totalPayments),
      caption: t(paymentsCaption(charged.periodic, charged.insurance)),
      accent: false,
    },
  ];
  return (
    <dl class="kpis">
      {tiles.map((tile) => (
        <div key={tile.key} class="kpi">
          <dt class="kpi__label">{tile.label}</dt>
          <dd class={tile.accent ? 'kpi__value kpi__value--accent num' : 'kpi__value num'}>
            <Changing value={tile.value}>{tile.value}</Changing>
          </dd>
          <dd class="kpi__caption">{tile.caption}</dd>
        </div>
      ))}
    </dl>
  );
}
