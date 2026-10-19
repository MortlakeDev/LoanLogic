// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Fees and insurance (SPEC §6): upfront items (paid at closing or financed), periodic
 * fees and insurance, and the totals that the summary (§8.2) and the rate cash flows
 * (§9.1) need. Percentages are rounded with the fee rounding mode; fixed amounts are used
 * as entered.
 */

import { divRound } from './rational';
import type { Fee, RoundingMode } from './types';

/** A percentage of a base in minor units: `R_fee(base × pct / 100)`. */
function percentOf(base: bigint, fee: Fee, mode: RoundingMode): bigint {
  if (fee.value.calc === 'fixed') {
    return fee.value.amount;
  }
  return divRound(base * fee.value.pct.n, fee.value.pct.d * 100n, mode);
}

/**
 * Amount of an upfront item in minor units (SPEC §6.1): fixed as entered, or
 * `R_fee(amount × pct / 100)` of the requested amount.
 *
 * @param amount Requested amount in minor units.
 */
export function upfrontFeeAmount(fee: Fee, amount: bigint, mode: RoundingMode): bigint {
  return percentOf(amount, fee, mode);
}

/**
 * Amount of a periodic fee or insurance item for one period in minor units (SPEC §6.2):
 * `fixed` as entered, `pct-original` of the requested amount, `pct-balance` of the
 * period's opening balance; `p` is a percentage per payment period.
 *
 * @param amount Requested amount in minor units.
 * @param openingBalance Balance `B_{k−1}` at the start of the period, in minor units.
 */
export function periodicFeeAmount(
  fee: Fee,
  amount: bigint,
  openingBalance: bigint,
  mode: RoundingMode,
): bigint {
  return percentOf(fee.value.calc === 'pct-balance' ? openingBalance : amount, fee, mode);
}

/** One upfront item with its computed amount. */
export interface UpfrontItem {
  readonly fee: Fee;
  /** Minor units. */
  readonly amount: bigint;
}

/** Upfront items and their totals by financing and APR inclusion, in minor units. */
export interface UpfrontTotals {
  readonly items: readonly UpfrontItem[];
  /** Items paid by the borrower at `D0`. */
  readonly paid: bigint;
  /** Items added to the loan. */
  readonly financed: bigint;
  /** Paid items that are finance charges (`inApr`): they reduce the amount financed. */
  readonly paidInApr: bigint;
  /** Financed items that are not finance charges: credit the borrower receives. */
  readonly financedNotInApr: bigint;
}

/** Computes every upfront item and the totals of SPEC §6.1, §8.2 and §9.1. */
export function upfrontTotals(
  fees: readonly Fee[],
  amount: bigint,
  mode: RoundingMode,
): UpfrontTotals {
  const items = fees
    .filter((fee) => fee.kind === 'upfront')
    .map((fee) => ({ fee, amount: upfrontFeeAmount(fee, amount, mode) }));
  const sum = (predicate: (item: UpfrontItem) => boolean): bigint =>
    items.filter(predicate).reduce((total, item) => total + item.amount, 0n);
  return {
    items,
    paid: sum((item) => item.fee.financing === 'paid'),
    financed: sum((item) => item.fee.financing === 'financed'),
    paidInApr: sum((item) => item.fee.financing === 'paid' && item.fee.inApr),
    financedNotInApr: sum((item) => item.fee.financing === 'financed' && !item.fee.inApr),
  };
}

/** Principal financed `P = amount + financed upfront items` (SPEC §5.1, §6.1). */
export function principalFinanced(amount: bigint, totals: UpfrontTotals): bigint {
  return amount + totals.financed;
}

/**
 * Inflow at `D0` used by the rate metrics (SPEC §9.1, Regulation Z's amount financed):
 * `amount + financed items not in the APR − paid items in the APR`.
 */
export function amountFinancedForRates(amount: bigint, totals: UpfrontTotals): bigint {
  return amount + totals.financedNotInApr - totals.paidInApr;
}
