// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The headline cost-of-credit rate until region profiles arrive (T03 brief §6; T05
 * replaces this module): the method follows the currency, and Advanced can override it.
 * Also the method's source badge and the secondary rate of DESIGN §8.7.
 */

import type { RateMethodId } from '../../engine';

/** EU currencies other than the euro whose loans disclose the EU APRC (T03 brief §6). */
const EU_CURRENCIES: readonly string[] = ['EUR', 'PLN', 'CZK', 'HUF', 'RON', 'SEK', 'DKK'];

/**
 * The headline method of a currency: USD → US APR, GBP → UK APR, EUR and the other EU
 * currencies → EU APRC, CNY → 年化利率（单利）, UAH → the Ukrainian real annual rate, any
 * other → the effective all-in rate.
 */
export function headlineMethodFor(currency: string): RateMethodId {
  if (currency === 'USD') {
    return 'usRegZApr';
  }
  if (currency === 'GBP') {
    return 'ukAprc';
  }
  if (EU_CURRENCIES.includes(currency)) {
    return 'euAprc';
  }
  if (currency === 'CNY') {
    return 'cnAnnualized';
  }
  if (currency === 'UAH') {
    return 'uaRealAnnual';
  }
  return 'international';
}

/**
 * The secondary rate shown under the headline (DESIGN §8.7): the IRR method next to the
 * Chinese simple annualized rate, the effective rate without fees otherwise.
 */
export function secondaryMethodFor(headline: RateMethodId): RateMethodId {
  return headline === 'cnAnnualized' ? 'irrEffective' : 'effective';
}

/** The regulatory source a headline method's badge names (DESIGN §8.7), or `null`. */
export type RateSource = 'regZ' | 'fca' | 'eu' | 'pboc' | 'nbu';

/** The source badge of a method, or `null` for methods without a regulator. */
export function rateSourceOf(method: RateMethodId): RateSource | null {
  switch (method) {
    case 'usRegZApr':
      return 'regZ';
    case 'ukAprc':
      return 'fca';
    case 'euAprc':
      return 'eu';
    case 'cnAnnualized':
      return 'pboc';
    case 'uaRealAnnual':
      return 'nbu';
    default:
      return null;
  }
}
