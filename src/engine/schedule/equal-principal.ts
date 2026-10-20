// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Equal principal (等额本金, SPEC §5.3).
 */

import { divRound } from '../rational';

/**
 * The equal-principal instalment `q = R(P / N)`, always `half-up` to the minor unit.
 *
 * @param principal Principal financed `P` in minor units.
 * @param payments Number of payments `N`.
 * @returns `q` in minor units.
 */
export function equalPrincipalAmount(principal: bigint, payments: number): bigint {
  return divRound(principal, BigInt(payments), 'half-up');
}

/**
 * First principal with the remainder first: `p_1 = P − (N − 1)·q`. Negative only when
 * `P / N` is below about `N / 2` minor units: `AMOUNT_TOO_SMALL_FOR_TERM` (SPEC §5.3).
 *
 * @returns `p_1` in minor units.
 */
export function remainderFirstPrincipal(principal: bigint, payments: number): bigint {
  return principal - BigInt(payments - 1) * equalPrincipalAmount(principal, payments);
}
