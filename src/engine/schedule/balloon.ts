// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Balloon: partial amortization with a residual (SPEC §5.5).
 */

import { divRound } from '../rational';
import type { Real } from '../rounding';
import type { BalloonSpec, PaymentRounding } from '../types';
import { type Instalment, levelInstalment } from './annuity';

/**
 * The residual `Bal` in minor units: an amount as entered, or `R(P × pct / 100)` of the
 * principal financed, always `half-up`. The caller checks `0 < Bal < P` after rounding
 * (`BALLOON_RANGE`).
 *
 * @param principal Principal financed `P` in minor units.
 */
export function balloonResidual(spec: BalloonSpec, principal: bigint): bigint {
  if (spec.kind === 'amount') {
    return spec.amount;
  }
  return divRound(principal * spec.pct.n, spec.pct.d * 100n, 'half-up');
}

/**
 * The regular instalment of a balloon loan (SPEC §5.5):
 * `A* = (P − Bal·(1 + i)^−N) · i / (1 − (1 + i)^−N)`, `A* = (P − Bal) / N` for `i = 0`,
 * `A = R_pay(A*)`; exact when `i` is rational. Day-count loans pass the nominal-basis
 * rate `i = j / m`.
 *
 * @param principal Principal financed `P` in minor units.
 * @param residual Balloon `Bal` in minor units (`0 < Bal < P`).
 * @param rate Periodic rate `i` per payment period, as a fraction.
 * @param payments Number of payments `N` (≥ 1).
 * @param minorUnits Digits of the currency's minor unit.
 * @param policy Payment rounding policy for `A`.
 */
export function balloonInstalment(
  principal: bigint,
  residual: bigint,
  rate: Real,
  payments: number,
  minorUnits: number,
  policy: PaymentRounding,
): Instalment {
  return levelInstalment(principal, rate, payments, minorUnits, policy, residual);
}

/**
 * The balloon part of the last payment, `p_N − (A − I_N)` (SPEC §5.5, §8.2): the principal
 * of the last period beyond what a regular instalment would have repaid. All amounts in
 * minor units.
 *
 * @param lastPrincipal Principal `p_N` of the last period.
 * @param instalment The regular instalment `A`.
 * @param lastInterest Interest `I_N` of the last period.
 */
export function balloonPart(
  lastPrincipal: bigint,
  instalment: bigint,
  lastInterest: bigint,
): bigint {
  return lastPrincipal - (instalment - lastInterest);
}
