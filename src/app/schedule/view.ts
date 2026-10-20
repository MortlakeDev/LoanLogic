// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * What the schedule card shows (DESIGN §8.10, §7.2): the figures derived from the engine
 * result, and which parts of the schedule are open.
 *
 * The open/closed state lives in a module signal rather than in component state, so it
 * survives the moments when invalid input blanks the results and the card unmounts its
 * table: a user who opened year 5 still sees it open once the input is valid again.
 */

import { computed, signal } from '@preact/signals';
import { type InvariantViolation, type LedgerRow, checkInvariants } from '../../engine';
import {
  type ScheduleTotals,
  type ScheduleYear,
  scheduleTotals,
  scheduleYears,
  toMinor,
} from '../state/derived';
import { currencyDigits } from '../state/display';
import { form, okResult } from '../state/loan';

/** Payments of the first loan year shown before "Show N more payments". */
export const PREVIEW_ROWS = 6;

/** Year groups shown before the "N more years" button. */
export const INITIAL_YEARS = 3;

/** Payments of the mobile list shown before "Show all N payments". */
export const LIST_PREVIEW = 6;

/** The figures of the schedule card, all from the engine result and `derived.ts`. */
export interface ScheduleModel {
  readonly rows: readonly LedgerRow[];
  readonly years: readonly ScheduleYear[];
  readonly totals: ScheduleTotals;
  /** Fees and insurance get a column (and a list part) only when their totals are not 0. */
  readonly showFees: boolean;
  readonly showInsurance: boolean;
  /** `summary.totalPrincipal`, for the reconciliation note. */
  readonly totalPrincipal: string;
  /** Developer messages of the ledger invariant checker; empty when the ledger reconciles. */
  readonly violations: readonly InvariantViolation[];
}

/** The schedule figures of the current result, or `null` when there is no valid result. */
export const scheduleModel = computed<ScheduleModel | null>(() => {
  const result = okResult.value;
  if (result === null) {
    return null;
  }
  const digits = currencyDigits.value;
  const { frequency, repayment } = form.value;
  const totals = scheduleTotals(result.rows, digits);
  return {
    rows: result.rows,
    years: scheduleYears(result.rows, frequency, digits),
    totals,
    showFees: toMinor(totals.fees, digits) !== 0n,
    showInsurance: toMinor(totals.insurance, digits) !== 0n,
    totalPrincipal: result.summary.totalPrincipal,
    violations: checkInvariants(result, { minorUnits: digits, repayment }),
  };
});

/** Which parts of the schedule are open. */
export interface ScheduleView {
  /** Loan years whose payment rows the table shows. */
  readonly expanded: ReadonlySet<number>;
  /** Year 1 shows only its first `PREVIEW_ROWS` payments until "Show more" or a toggle. */
  readonly firstYearPreview: boolean;
  /** Whether the table lists every year group, not just the first `INITIAL_YEARS`. */
  readonly allYears: boolean;
  /** Whether the mobile list shows every payment, not just the first `LIST_PREVIEW`. */
  readonly wholeList: boolean;
  /** Whether the mobile list shows one item per loan year instead of one per payment. */
  readonly yearly: boolean;
}

function initialView(): ScheduleView {
  return {
    expanded: new Set([1]),
    firstYearPreview: true,
    allYears: false,
    wholeList: false,
    yearly: false,
  };
}

/** The open/closed state of the schedule card. */
export const scheduleView = signal<ScheduleView>(initialView());

function patchView(patch: Partial<ScheduleView>): void {
  scheduleView.value = { ...scheduleView.value, ...patch };
}

/**
 * Opens or closes a loan year. A toggle acts on every row of the year, so year 1 leaves
 * its six-row preview: reopened, it shows all its payments.
 */
export function toggleYear(year: number): void {
  const expanded = new Set(scheduleView.value.expanded);
  if (!expanded.delete(year)) {
    expanded.add(year);
  }
  patchView(year === 1 ? { expanded, firstYearPreview: false } : { expanded });
}

/** "Show N more payments": the rest of year 1. */
export function showRestOfFirstYear(): void {
  patchView({ firstYearPreview: false });
}

/** "N more years": every year group, collapsed unless opened before. */
export function showAllYears(): void {
  patchView({ allYears: true });
}

/** "Show all N payments" in the mobile list. */
export function showWholeList(): void {
  patchView({ wholeList: true });
}

/** The "Yearly summary" switch of the mobile list. */
export function toggleYearlySummary(): void {
  patchView({ yearly: !scheduleView.value.yearly });
}

/** Back to the initial view (year 1 previewed, years 2–3 collapsed); used by tests. */
export function resetScheduleView(): void {
  scheduleView.value = initialView();
}
