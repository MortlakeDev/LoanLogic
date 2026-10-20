// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Runtime validation of explicit cash flows (SPEC §9.7, §13, §15). The input is treated as
 * untrusted data of unknown shape.
 *
 * - Phase 1 checks every field on its own and reports all failures together, at most one
 *   per field.
 * - Phase 2 runs only when phase 1 found nothing: the flows must span more than one date,
 *   and with periods every date must be the schedule date `D0 + period` periods.
 *
 * Only own properties of the input objects are read; unknown keys are ignored.
 */

import { type LocalDate, compareDates, parseIsoDate, sameDate } from './date';
import { isFrequencyId, scheduleDate } from './frequency';
import { isDecimalString } from './money';
import { type Rational, compare, fromInteger, neg, parseDecimal, sign } from './rational';
import type { CashFlow, CashFlowTerms, EngineError, ErrorCode, FrequencyId } from './types';

/** Result of `validateCashFlowInput`. */
export type CashFlowValidation =
  | { readonly ok: true; readonly terms: CashFlowTerms }
  | { readonly ok: false; readonly errors: readonly EngineError[] };

/** Largest absolute flow amount: 1e15 major units (SPEC §13). */
const MAX_FLOW_AMOUNT = fromInteger(10n ** 15n);

type InputObject = Readonly<Record<string, unknown>>;

/** A non-null object that is not an array. */
function isPlainObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** An own property; inherited ones are not part of untrusted data. */
function own(object: InputObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** Whether the item is an object that carries a `period` (present, not `undefined`). */
function hasPeriod(item: InputObject | null | undefined): boolean {
  return item !== null && item !== undefined && own(item, 'period') !== undefined;
}

/** A JSON number with an integral value ≥ 0 (`2.0` is 2); booleans and strings are not. */
function isPeriodIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Records an error and returns `null` ("failed"), so a check can `return fail(…)`. */
function fail(errors: EngineError[], field: string, code: ErrorCode = 'INPUT_INVALID'): null {
  errors.push({ code, field });
  return null;
}

/** A flow date: a string naming an existing `YYYY-MM-DD` date (year ≥ 1). */
function checkFlowDate(value: unknown, field: string, errors: EngineError[]): LocalDate | null {
  if (typeof value !== 'string') {
    return fail(errors, field);
  }
  return parseIsoDate(value) ?? fail(errors, field, 'DATE_INVALID');
}

/** A flow amount in major units: a plain decimal string with `|amount| ≤ 1e15`. */
function checkFlowAmount(value: unknown, field: string, errors: EngineError[]): Rational | null {
  if (!isDecimalString(value)) {
    return fail(errors, field);
  }
  const amount = parseDecimal(value);
  const magnitude = sign(amount) < 0 ? neg(amount) : amount;
  return compare(magnitude, MAX_FLOW_AMOUNT) > 0 ? fail(errors, field, 'AMOUNT_RANGE') : amount;
}

/** One object item as far as phase 1 could read it; `null` parts failed or are absent. */
interface FlowFields {
  /** An existing date (it may still be out of order). */
  readonly date: LocalDate | null;
  readonly amount: Rational | null;
  /** The period when it is present and a non-negative integer. */
  readonly period: number | null;
}

/**
 * Phase 1 of the flow items; every item is checked.
 *
 * - Dates must not decrease: a date is compared with the previous item's date when that
 *   item is an object whose date exists.
 * - Periods are on every item or on none, as `flows[0]` decides (an item that is not an
 *   object has none). When every object item has one, each must be a non-negative integer,
 *   the first must be 0, and none may be smaller than the previous item's valid period.
 *
 * @returns One entry per item: its fields, or `null` for an item that is not an object.
 */
function checkFlows(flows: readonly unknown[], errors: EngineError[]): (FlowFields | null)[] {
  const objects = flows.map((item) => (isPlainObject(item) ? item : null));
  const firstHasPeriod = hasPeriod(objects[0]);
  const periodsAgree = objects.every((item) => item === null || hasPeriod(item) === firstHasPeriod);
  const checkPeriodValues = firstHasPeriod && periodsAgree;

  const items: (FlowFields | null)[] = [];
  let previous: FlowFields | null = null;
  for (const [index, item] of objects.entries()) {
    const path = `flows[${String(index)}]`;
    if (item === null) {
      fail(errors, path);
      items.push(null);
      previous = null;
      continue;
    }

    const date = checkFlowDate(own(item, 'date'), `${path}.date`, errors);
    const previousDate = previous?.date ?? null;
    if (date !== null && previousDate !== null && compareDates(date, previousDate) < 0) {
      fail(errors, `${path}.date`);
    }

    const amount = checkFlowAmount(own(item, 'amount'), `${path}.amount`, errors);

    const rawPeriod = own(item, 'period');
    let period: number | null = null;
    if (hasPeriod(item) !== firstHasPeriod) {
      fail(errors, `${path}.period`);
    } else if (checkPeriodValues) {
      if (isPeriodIndex(rawPeriod)) {
        // −0 passes as an integer ≥ 0; keep it as 0.
        period = rawPeriod === 0 ? 0 : rawPeriod;
        const previousPeriod = previous?.period ?? null;
        const outOfOrder =
          index === 0 ? period !== 0 : previousPeriod !== null && period < previousPeriod;
        if (outOfOrder) {
          fail(errors, `${path}.period`);
        }
      } else {
        fail(errors, `${path}.period`);
      }
    }

    const fields: FlowFields = { date, amount, period };
    items.push(fields);
    previous = fields;
  }
  return items;
}

/** The flow of an item that passed phase 1 completely, else `null`. */
function toCashFlow(item: FlowFields | null): CashFlow | null {
  if (item === null) {
    return null;
  }
  const { date, amount, period } = item;
  if (date === null || amount === null) {
    return null;
  }
  return period === null ? { date, amount } : { date, amount, period };
}

/** Whether `date` is `D0 + period` periods, with or without the end-of-month rule (§9.7). */
function isScheduleDate(
  anchor: LocalDate,
  date: LocalDate,
  period: number,
  frequency: FrequencyId,
): boolean {
  return (
    sameDate(date, scheduleDate(anchor, period, frequency, true)) ||
    sameDate(date, scheduleDate(anchor, period, frequency, false))
  );
}

/** Phase 2: the combinations of SPEC §13 for cash flows, all reported together. */
function checkFlowCombinations(
  first: CashFlow,
  flows: readonly CashFlow[],
  frequency: FrequencyId | null,
): EngineError[] {
  const errors: EngineError[] = [];
  const lastIndex = flows.length - 1;
  const last = flows[lastIndex];
  // Dates do not decrease (phase 1), so this means every flow is on one date.
  if (last !== undefined && sameDate(last.date, first.date)) {
    fail(errors, `flows[${String(lastIndex)}].date`);
  }
  if (frequency !== null) {
    for (const [index, flow] of flows.entries()) {
      if (
        flow.period !== undefined &&
        !isScheduleDate(first.date, flow.date, flow.period, frequency)
      ) {
        fail(errors, `flows[${String(index)}].period`);
      }
    }
  }
  return errors;
}

/**
 * Validates untrusted explicit cash flows against the `CashFlowInput` contract of SPEC
 * §15 with the rules of §9.7 and §13.
 *
 * Phase 1 (all reported together, at most one error per field):
 * - not a plain object → `[{ INPUT_INVALID, field: null }]`;
 * - `frequency` present and unknown → `INPUT_INVALID`;
 * - `flows` not an array or fewer than two items → `INPUT_INVALID` on `flows` (the items
 *   are then not checked);
 * - `flows[i]` not a plain object → `INPUT_INVALID`; `flows[i].date` not a string →
 *   `INPUT_INVALID`, not an existing date → `DATE_INVALID`, earlier than the previous
 *   item's (existing) date → `INPUT_INVALID`; `flows[i].amount` not a plain decimal
 *   string → `INPUT_INVALID`, `|amount| > 1e15` → `AMOUNT_RANGE`;
 * - `flows[i].period`: present on some items but not others (as `flows[0]` decides), not
 *   a non-negative integer, the first not 0, or smaller than the previous period →
 *   `INPUT_INVALID`;
 * - periods on every item but no `frequency` → `INPUT_INVALID` on `frequency`.
 *
 * Phase 2 (only after a clean phase 1): the last date equal to the first →
 * `INPUT_INVALID` on `flows[n−1].date`; with periods, a date that is not
 * `D0 + period` periods (with or without the end-of-month rule) → `INPUT_INVALID` on
 * `flows[i].period`.
 *
 * On success the flows keep their order; amounts are exact in major units (borrower view:
 * + received, − paid), `period` is present on every flow exactly when `hasPeriods`, and
 * `frequency` is `null` when not given.
 *
 * @param input Any value; typically parsed JSON in the shape of `CashFlowInput`.
 */
export function validateCashFlowInput(input: unknown): CashFlowValidation {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'INPUT_INVALID', field: null }] };
  }
  const errors: EngineError[] = [];
  const rawFrequency = own(input, 'frequency');
  let frequency: FrequencyId | null = null;
  if (isFrequencyId(rawFrequency)) {
    frequency = rawFrequency;
  } else if (rawFrequency !== undefined) {
    fail(errors, 'frequency');
  }

  const rawFlows = own(input, 'flows');
  if (!isArray(rawFlows) || rawFlows.length < 2) {
    fail(errors, 'flows');
    return { ok: false, errors };
  }
  // A dense copy: holes in a sparse array are items too (and invalid); `map` and `every`
  // would skip them.
  const list = Array.from(rawFlows);
  const items = checkFlows(list, errors);
  // Given on every item counts whether or not each period is valid.
  const hasPeriods = list.every((item) => isPlainObject(item) && hasPeriod(item));
  if (hasPeriods && rawFrequency === undefined) {
    fail(errors, 'frequency');
  }

  const flows: CashFlow[] = [];
  for (const item of items) {
    const flow = toCashFlow(item);
    if (flow !== null) {
      flows.push(flow);
    }
  }
  const first = flows[0];
  if (errors.length > 0 || first === undefined || flows.length !== items.length) {
    return { ok: false, errors };
  }

  const combinationErrors = checkFlowCombinations(first, flows, frequency);
  if (combinationErrors.length > 0) {
    return { ok: false, errors: combinationErrors };
  }
  return { ok: true, terms: { frequency, hasPeriods, flows } };
}
