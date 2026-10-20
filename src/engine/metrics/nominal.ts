// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/** The `nominal` metric (SPEC §9.2): the contract rate `j` as entered. */

import { parseDecimal, toExplainString, toNumber } from '../rational';
import type { RateMetric } from '../types';
import { formatNominalDisplay } from './display';
import type { ContractRate } from './types';

/**
 * `nominal` (SPEC §9.2): `j` as entered, displayed with at least two decimals ("6.875",
 * "6.50", "12.00"). Explanation `rate.nominal` with `j` as an exact decimal fraction
 * ("0.065").
 *
 * @param contract The loan's contract rate.
 * @returns The metric; `value` is the entered percent as a double (6.875).
 */
export function nominalMetric(contract: ContractRate): RateMetric {
  const { display, precision } = formatNominalDisplay(contract.annualRatePct);
  return {
    value: toNumber(parseDecimal(contract.annualRatePct)),
    display,
    precision,
    explain: { formulaId: 'rate.nominal', values: { j: toExplainString(contract.rate) } },
  };
}
