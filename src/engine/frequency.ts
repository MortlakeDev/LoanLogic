// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Payment frequencies (SPEC §2.2) and schedule dates (§2.3): `date_k = D0 + k periods`,
 * always computed from the anchor `D0`, with the end-of-month rule of §2.1.
 */

import { type LocalDate, addDays, addMonths, isLastDayOfMonth, lastDayOfMonth } from './date';
import type { FrequencyId } from './types';

/** How one period of a frequency is measured. */
export interface FrequencyInfo {
  /** Periods per year `m`. */
  readonly perYear: number;
  /** Whether a period is a number of months (else a number of days). */
  readonly monthBased: boolean;
  /** Months (month-based) or days per period. */
  readonly step: number;
}

const FREQUENCIES: Readonly<Record<FrequencyId, FrequencyInfo>> = Object.freeze({
  weekly: { perYear: 52, monthBased: false, step: 7 },
  biweekly: { perYear: 26, monthBased: false, step: 14 },
  monthly: { perYear: 12, monthBased: true, step: 1 },
  quarterly: { perYear: 4, monthBased: true, step: 3 },
  semiannual: { perYear: 2, monthBased: true, step: 6 },
  annual: { perYear: 1, monthBased: true, step: 12 },
});

/** Every frequency id of M1, in the order of SPEC §15. */
export const FREQUENCY_IDS: readonly FrequencyId[] = Object.freeze([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]);

/** Whether `value` is a frequency id. */
export function isFrequencyId(value: unknown): value is FrequencyId {
  return typeof value === 'string' && Object.hasOwn(FREQUENCIES, value);
}

/** The table entry of a frequency. */
export function frequencyInfo(id: FrequencyId): FrequencyInfo {
  return FREQUENCIES[id];
}

/** Periods per year `m` (weekly 52 … annual 1). */
export function periodsPerYear(id: FrequencyId): number {
  return FREQUENCIES[id].perYear;
}

/**
 * The k-th schedule date `D0 + k periods` (k ≥ 0). For a month-based frequency whose
 * anchor is the last day of its month and `endOfMonth = true`, every date is the last day
 * of its month (Jan 31 → Feb 29 → Mar 31 → Apr 30); otherwise the anchor's day of month is
 * kept and clamped (Feb 28 → Mar 28 → Apr 28). The result may lie past 9999-12-31; the
 * caller checks.
 */
export function scheduleDate(
  anchor: LocalDate,
  k: number,
  frequency: FrequencyId,
  endOfMonth: boolean,
): LocalDate {
  const info = FREQUENCIES[frequency];
  if (!info.monthBased) {
    return addDays(anchor, k * info.step);
  }
  const date = addMonths(anchor, k * info.step);
  return endOfMonth && isLastDayOfMonth(anchor) ? lastDayOfMonth(date) : date;
}

/** The payment dates `date_1 … date_N` of a regular schedule. */
export function scheduleDates(
  anchor: LocalDate,
  payments: number,
  frequency: FrequencyId,
  endOfMonth: boolean,
): LocalDate[] {
  return Array.from({ length: payments }, (_, index) =>
    scheduleDate(anchor, index + 1, frequency, endOfMonth),
  );
}

/**
 * Whether a schedule is end-of-month (SPEC §2.1): the frequency is month-based and `D0`
 * and every payment date are the last day of their month. Depends on the dates, not on
 * the `endOfMonth` flag.
 */
export function isEndOfMonthSchedule(
  anchor: LocalDate,
  dates: readonly LocalDate[],
  frequency: FrequencyId,
): boolean {
  return (
    FREQUENCIES[frequency].monthBased &&
    isLastDayOfMonth(anchor) &&
    dates.every((date) => isLastDayOfMonth(date))
  );
}
