// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The loan term (SPEC §2.4): a number of payments, years + months, or an end date, turned
 * into the number of payments `N`.
 */

import { type LocalDate, compareDates } from './date';
import { periodsPerYear, scheduleDate } from './frequency';
import { divRound } from './rational';
import type { FrequencyId } from './types';

/** Most payments a schedule may have (SPEC §2.4). */
export const MAX_PAYMENTS = 1200;

/** A term as entered, after its fields passed validation (SPEC §2.4). */
export type TermSpec =
  | { readonly kind: 'payments'; readonly payments: number }
  | { readonly kind: 'years'; readonly years: number; readonly months: number }
  | { readonly kind: 'endDate'; readonly endDate: LocalDate };

/** `N`, or the phase-2 error on field `term` (SPEC §2.4, §13). */
export type TermResult =
  | { readonly ok: true; readonly payments: number }
  | { readonly ok: false; readonly code: 'TERM_TOO_SHORT' | 'TERM_RANGE' };

/**
 * Resolves the number of payments `N`.
 *
 * - payments: `N` as given (its range is a phase-1 check on `term.payments`);
 * - years + months: `N = roundHalfUp(totalMonths × m / 12)` (7 months weekly → 30);
 * - end date `E`: the number of schedule dates `date_k ≤ E`.
 *
 * `N < 1` gives `TERM_TOO_SHORT`, `N > 1200` gives `TERM_RANGE`.
 */
export function resolvePayments(
  term: TermSpec,
  anchor: LocalDate,
  frequency: FrequencyId,
  endOfMonth: boolean,
): TermResult {
  let payments: number;
  switch (term.kind) {
    case 'payments':
      payments = term.payments;
      break;
    case 'years': {
      const totalMonths = BigInt(term.years * 12 + term.months);
      payments = Number(divRound(totalMonths * BigInt(periodsPerYear(frequency)), 12n, 'half-up'));
      break;
    }
    case 'endDate': {
      payments = 0;
      // One past the limit is enough to know the term is out of range.
      while (
        payments <= MAX_PAYMENTS &&
        compareDates(scheduleDate(anchor, payments + 1, frequency, endOfMonth), term.endDate) <= 0
      ) {
        payments += 1;
      }
      break;
    }
  }
  if (payments < 1) {
    return { ok: false, code: 'TERM_TOO_SHORT' };
  }
  if (payments > MAX_PAYMENTS) {
    return { ok: false, code: 'TERM_RANGE' };
  }
  return { ok: true, payments };
}
