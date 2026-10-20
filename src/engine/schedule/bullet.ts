// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Interest-only with the whole principal at the end (先息后本, SPEC §5.4).
 */

/**
 * Scheduled principal of a bullet loan in period `k`: nothing before the last period,
 * the whole principal financed in period `N` (SPEC §5.4). Interest and fees are paid
 * every period.
 *
 * @param period The period `k`, 1-based.
 * @param payments Number of payments `N`.
 * @param principal Principal financed `P` in minor units.
 * @returns `p_k` in minor units.
 */
export function bulletPrincipal(period: number, payments: number, principal: bigint): bigint {
  return period < payments ? 0n : principal;
}
