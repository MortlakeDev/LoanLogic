// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Runtime validation of a loan input (SPEC §13, §15). The input is treated as untrusted
 * data of unknown shape.
 *
 * - Phase 1 checks every field on its own and reports all failures together, at most one
 *   per field: the first that applies of type (missing, wrong type, unknown id, malformed
 *   string) → range → whole minor units.
 * - Phase 2 runs only when phase 1 found nothing and checks the combinations (the term's
 *   `N`, the last schedule date, the balloon, the equal-principal remainder).
 * - Phase 3 (`NEG_AMORTIZATION`) belongs to the schedule builder.
 *
 * Properties that the chosen options do not use are ignored and never validated:
 * `balloon` unless the repayment is `balloon`, `financing` on periodic and insurance fees,
 * `compounding` in day-count mode, `method` and `paymentBasis` in periodic mode, and
 * unknown keys. Only own properties of the input objects are read.
 */

import { minorUnits } from './currency';
import { type LocalDate, isSupportedDate, parseIsoDate } from './date';
import { DAY_COUNT_IDS } from './daycount';
import { principalFinanced, upfrontTotals } from './fees';
import { FREQUENCY_IDS, scheduleDate } from './frequency';
import { isDecimalString, toMinorUnits } from './money';
import { type Rational, ONE, compare, fromInteger, parseDecimal, rational, sign } from './rational';
import { balloonResidual } from './schedule/balloon';
import { remainderFirstPrincipal } from './schedule/equal-principal';
import { type TermSpec, MAX_PAYMENTS, resolvePayments } from './term';
import {
  type Accrual,
  type BalloonSpec,
  type CompoundingId,
  type EngineError,
  type EngineWarning,
  type ErrorCode,
  type Fee,
  type FeeValue,
  type FrequencyId,
  type LoanTerms,
  type PaymentBasis,
  type PaymentRounding,
  type PrincipalRemainder,
  type RateMethodId,
  type RepaymentType,
  type RoundingMode,
  type RoundingOptions,
  RATE_METHOD_IDS,
} from './types';

export { type CashFlowValidation, validateCashFlowInput } from './validate-cashflows';

/** Result of `validateLoanInput`. */
export type LoanValidation =
  | {
      readonly ok: true;
      readonly terms: LoanTerms;
      /** `RATE_NEGATIVE` or `RATE_HIGH` (SPEC §3.4), else empty. */
      readonly warnings: readonly EngineWarning[];
    }
  | { readonly ok: false; readonly errors: readonly EngineError[] };

// ---------------------------------------------------------------------------------------
// Allowed values (SPEC §15)
// ---------------------------------------------------------------------------------------

const REPAYMENT_TYPES: readonly RepaymentType[] = [
  'annuity',
  'equal-principal',
  'bullet',
  'balloon',
];
const BALLOON_KINDS: readonly BalloonSpec['kind'][] = ['amount', 'percent'];
const ACCRUAL_MODES: readonly Accrual['mode'][] = ['periodic', 'daycount'];
const COMPOUNDING_IDS: readonly CompoundingId[] = [...FREQUENCY_IDS, 'continuous'];
const PAYMENT_BASES: readonly PaymentBasis[] = ['nominal', 'exact'];
const ROUNDING_MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];
const PAYMENT_ROUNDINGS: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];
const PRINCIPAL_REMAINDERS: readonly PrincipalRemainder[] = ['last', 'first'];
const FEE_KINDS: readonly Fee['kind'][] = ['upfront', 'periodic', 'insurance'];
const FEE_FINANCING: readonly Fee['financing'][] = ['paid', 'financed'];
const FEE_CALCS: Readonly<Record<Fee['kind'], readonly FeeValue['calc'][]>> = {
  upfront: ['fixed', 'percent'],
  periodic: ['fixed', 'pct-original', 'pct-balance'],
  insurance: ['fixed', 'pct-original', 'pct-balance'],
};

/** Largest requested amount: 1e15 major units (SPEC §13). */
const MAX_AMOUNT = fromInteger(10n ** 15n);
/** Rate limits in percent (SPEC §3.4). */
const MIN_RATE_PCT = fromInteger(-20);
const MAX_RATE_PCT = fromInteger(1000);
/** Most years of a years + months term (SPEC §2.4). */
const MAX_TERM_YEARS = 100;

// Frozen: every input without `rounding` gets this very object in its terms, so a caller
// that wrote to it would change the defaults of all later calls.
const DEFAULT_ROUNDING: RoundingOptions = Object.freeze({
  interest: 'half-up',
  fees: 'half-up',
  payment: 'minor-half-up',
  principalRemainder: 'last',
});

// ---------------------------------------------------------------------------------------
// Primitive checks. A check returns the parsed value, or `null` once it has recorded an
// error (or when a field it depends on, the currency or the frequency, already failed).
// `undefined` means an absent property (or, for `digits`, unknown minor units).
// ---------------------------------------------------------------------------------------

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

function isOneOf<T extends string>(value: unknown, ids: readonly T[]): value is T {
  return typeof value === 'string' && (ids as readonly string[]).includes(value);
}

/** A JSON number with an integral value (`12.0` is 12); booleans and strings are not. */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Records an error and returns `null`, so a check can `return fail(…)`. */
function fail(errors: EngineError[], field: string, code: ErrorCode = 'INPUT_INVALID'): null {
  errors.push({ code, field });
  return null;
}

/** A required id from a fixed list. */
function checkId<T extends string>(
  value: unknown,
  ids: readonly T[],
  field: string,
  errors: EngineError[],
): T | null {
  return isOneOf(value, ids) ? value : fail(errors, field);
}

/** An optional id from a fixed list; absent (`undefined`) gives the default. */
function checkOptionalId<T extends string>(
  value: unknown,
  ids: readonly T[],
  fallback: T,
  field: string,
  errors: EngineError[],
): T | null {
  return value === undefined ? fallback : checkId(value, ids, field, errors);
}

/** An optional boolean; absent (`undefined`) gives the default. */
function checkOptionalBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
  errors: EngineError[],
): boolean | null {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === 'boolean' ? value : fail(errors, field);
}

/** A `YYYY-MM-DD` string naming an existing date (year ≥ 1). */
function checkDate(value: unknown, field: string, errors: EngineError[]): LocalDate | null {
  if (typeof value !== 'string') {
    return fail(errors, field);
  }
  return parseIsoDate(value) ?? fail(errors, field, 'DATE_INVALID');
}

/**
 * Money as a whole number of minor units. Without a valid currency the minor units are
 * unknown: nothing is checked (the currency error is already recorded) and the result is
 * `null`.
 */
function wholeMinorUnits(
  text: string,
  digits: number | undefined,
  field: string,
  errors: EngineError[],
): bigint | null {
  if (digits === undefined) {
    return null;
  }
  return toMinorUnits(text, digits) ?? fail(errors, field, 'TOO_MANY_DECIMALS');
}

// ---------------------------------------------------------------------------------------
// Phase 1: fields
// ---------------------------------------------------------------------------------------

interface CurrencyField {
  readonly code: string;
  readonly minorUnits: number;
}

function checkCurrency(value: unknown, errors: EngineError[]): CurrencyField | null {
  if (typeof value !== 'string') {
    return fail(errors, 'currency');
  }
  const digits = minorUnits(value);
  return digits === undefined
    ? fail(errors, 'currency', 'CURRENCY_INVALID')
    : { code: value, minorUnits: digits };
}

/** Requested amount: `0 < amount ≤ 1e15`, whole minor units. */
function checkAmount(
  value: unknown,
  digits: number | undefined,
  errors: EngineError[],
): bigint | null {
  if (!isDecimalString(value)) {
    return fail(errors, 'amount');
  }
  const exact = parseDecimal(value);
  if (sign(exact) <= 0 || compare(exact, MAX_AMOUNT) > 0) {
    return fail(errors, 'amount', 'AMOUNT_RANGE');
  }
  return wholeMinorUnits(value, digits, 'amount', errors);
}

interface RateField {
  /** As entered. */
  readonly annualRatePct: string;
  /** `j` as an exact fraction per annum. */
  readonly rate: Rational;
}

/** Annual rate in percent, −20 … 1000 (SPEC §3.4). */
function checkRate(value: unknown, errors: EngineError[]): RateField | null {
  if (!isDecimalString(value)) {
    return fail(errors, 'annualRatePct');
  }
  const pct = parseDecimal(value);
  if (compare(pct, MIN_RATE_PCT) < 0 || compare(pct, MAX_RATE_PCT) > 0) {
    return fail(errors, 'annualRatePct', 'RATE_RANGE');
  }
  return { annualRatePct: value, rate: rational(pct.n, pct.d * 100n) };
}

/** The balloon residual; its range `0 < Bal < P` is a phase-2 check. */
function checkBalloon(
  value: unknown,
  digits: number | undefined,
  errors: EngineError[],
): BalloonSpec | null {
  if (!isPlainObject(value)) {
    return fail(errors, 'balloon');
  }
  const kind = checkId(own(value, 'kind'), BALLOON_KINDS, 'balloon.kind', errors);
  const text = own(value, 'value');
  if (!isDecimalString(text)) {
    return fail(errors, 'balloon.value');
  }
  if (kind === 'amount') {
    const amount = wholeMinorUnits(text, digits, 'balloon.value', errors);
    return amount === null ? null : { kind, amount };
  }
  return kind === null ? null : { kind, pct: parseDecimal(text) };
}

/** An integer term field within `min … max`, else `TERM_RANGE` on that field. */
function checkTermInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
  errors: EngineError[],
): number | null {
  if (!isInteger(value)) {
    return fail(errors, field);
  }
  return value < min || value > max ? fail(errors, field, 'TERM_RANGE') : value;
}

/**
 * The term (SPEC §2.4). Its form comes from the properties present (not `undefined`):
 * only `payments`; `years` with or without `months`; only `endDate`. Anything else —
 * none, a mix, `months` alone — is `INPUT_INVALID` on `term`.
 */
function checkTerm(value: unknown, errors: EngineError[]): TermSpec | null {
  if (!isPlainObject(value)) {
    return fail(errors, 'term');
  }
  const payments = own(value, 'payments');
  const years = own(value, 'years');
  const months = own(value, 'months');
  const endDate = own(value, 'endDate');
  const hasPayments = payments !== undefined;
  const hasYears = years !== undefined;
  const hasMonths = months !== undefined;
  const hasEndDate = endDate !== undefined;

  if (hasPayments && !hasYears && !hasMonths && !hasEndDate) {
    const count = checkTermInteger(payments, 1, MAX_PAYMENTS, 'term.payments', errors);
    return count === null ? null : { kind: 'payments', payments: count };
  }
  if (hasYears && !hasPayments && !hasEndDate) {
    const wholeYears = checkTermInteger(years, 0, MAX_TERM_YEARS, 'term.years', errors);
    const extraMonths = hasMonths ? checkTermInteger(months, 0, 11, 'term.months', errors) : 0;
    return wholeYears === null || extraMonths === null
      ? null
      : { kind: 'years', years: wholeYears, months: extraMonths };
  }
  if (hasEndDate && !hasPayments && !hasYears && !hasMonths) {
    const date = checkDate(endDate, 'term.endDate', errors);
    return date === null ? null : { kind: 'endDate', endDate: date };
  }
  return fail(errors, 'term');
}

/**
 * Accrual settings with defaults: periodic with `c = m` when absent. Without a valid
 * frequency the default compounding is unknown and the result is `null` (the frequency
 * error is already recorded).
 */
function checkAccrual(
  value: unknown,
  frequency: FrequencyId | null,
  errors: EngineError[],
): Accrual | null {
  if (value === undefined) {
    return frequency === null ? null : { mode: 'periodic', compounding: frequency };
  }
  if (!isPlainObject(value)) {
    return fail(errors, 'accrual');
  }
  const mode = checkId(own(value, 'mode'), ACCRUAL_MODES, 'accrual.mode', errors);
  if (mode === 'periodic') {
    const compounding = own(value, 'compounding');
    if (compounding === undefined) {
      return frequency === null ? null : { mode, compounding: frequency };
    }
    const id = checkId(compounding, COMPOUNDING_IDS, 'accrual.compounding', errors);
    return id === null ? null : { mode, compounding: id };
  }
  if (mode === 'daycount') {
    const method = checkId(own(value, 'method'), DAY_COUNT_IDS, 'accrual.method', errors);
    const basis = checkOptionalId(
      own(value, 'paymentBasis'),
      PAYMENT_BASES,
      'nominal',
      'accrual.paymentBasis',
      errors,
    );
    return method === null || basis === null ? null : { mode, method, paymentBasis: basis };
  }
  return null;
}

/** Rounding settings; every property optional with the defaults of SPEC §15. */
function checkRounding(value: unknown, errors: EngineError[]): RoundingOptions | null {
  if (value === undefined) {
    return DEFAULT_ROUNDING;
  }
  if (!isPlainObject(value)) {
    return fail(errors, 'rounding');
  }
  const interest = checkOptionalId(
    own(value, 'interest'),
    ROUNDING_MODES,
    DEFAULT_ROUNDING.interest,
    'rounding.interest',
    errors,
  );
  const fees = checkOptionalId(
    own(value, 'fees'),
    ROUNDING_MODES,
    DEFAULT_ROUNDING.fees,
    'rounding.fees',
    errors,
  );
  const payment = checkOptionalId(
    own(value, 'payment'),
    PAYMENT_ROUNDINGS,
    DEFAULT_ROUNDING.payment,
    'rounding.payment',
    errors,
  );
  const principalRemainder = checkOptionalId(
    own(value, 'principalRemainder'),
    PRINCIPAL_REMAINDERS,
    DEFAULT_ROUNDING.principalRemainder,
    'rounding.principalRemainder',
    errors,
  );
  return interest === null || fees === null || payment === null || principalRemainder === null
    ? null
    : { interest, fees, payment, principalRemainder };
}

/**
 * A fee's value: a non-negative decimal; with `calc: 'fixed'` also whole minor units.
 *
 * The minor units are checked whenever `calc` is the string `'fixed'`, even when the
 * fee's kind is invalid: `fixed` is money for every kind, so the check does not depend on
 * the kind.
 */
function checkFeeValue(
  value: unknown,
  rawCalc: unknown,
  calc: FeeValue['calc'] | null,
  digits: number | undefined,
  field: string,
  errors: EngineError[],
): FeeValue | null {
  if (!isDecimalString(value)) {
    return fail(errors, field);
  }
  const exact = parseDecimal(value);
  if (sign(exact) < 0) {
    return fail(errors, field, 'FEE_RANGE');
  }
  if (rawCalc === 'fixed') {
    const amount = wholeMinorUnits(value, digits, field, errors);
    return amount === null ? null : { calc: 'fixed', amount };
  }
  return calc === null || calc === 'fixed' ? null : { calc, pct: exact };
}

/**
 * One fee item; every failing property is reported. `seenIds` holds the valid ids of the
 * earlier items: a duplicate is reported on the later item.
 */
function checkFee(
  item: unknown,
  path: string,
  seenIds: Set<string>,
  digits: number | undefined,
  errors: EngineError[],
): Fee | null {
  if (!isPlainObject(item)) {
    return fail(errors, path);
  }
  const rawId = own(item, 'id');
  let id: string | null = null;
  if (typeof rawId === 'string' && rawId !== '' && !seenIds.has(rawId)) {
    seenIds.add(rawId);
    id = rawId;
  } else {
    fail(errors, `${path}.id`);
  }
  const kind = checkId(own(item, 'kind'), FEE_KINDS, `${path}.kind`, errors);
  const rawCalc = own(item, 'calc');
  // The allowed calculations depend on the kind; with an unknown kind they are not checked.
  const calc = kind === null ? null : checkId(rawCalc, FEE_CALCS[kind], `${path}.calc`, errors);
  const value = checkFeeValue(own(item, 'value'), rawCalc, calc, digits, `${path}.value`, errors);
  const financing =
    kind === 'upfront'
      ? checkOptionalId(own(item, 'financing'), FEE_FINANCING, 'paid', `${path}.financing`, errors)
      : 'paid';
  const inApr = checkOptionalBoolean(own(item, 'inApr'), true, `${path}.inApr`, errors);
  return id === null ||
    kind === null ||
    calc === null ||
    value === null ||
    financing === null ||
    inApr === null
    ? null
    : { id, kind, value, financing, inApr };
}

/** Fee and insurance items (default none). */
function checkFees(
  value: unknown,
  digits: number | undefined,
  errors: EngineError[],
): Fee[] | null {
  if (value === undefined) {
    return [];
  }
  if (!isArray(value)) {
    return fail(errors, 'fees');
  }
  const seenIds = new Set<string>();
  const fees: Fee[] = [];
  let failed = false;
  // An index loop, not forEach: holes in a sparse array are items too (and invalid).
  for (let index = 0; index < value.length; index += 1) {
    const fee = checkFee(value[index], `fees[${String(index)}]`, seenIds, digits, errors);
    if (fee === null) {
      failed = true;
    } else {
      fees.push(fee);
    }
  }
  return failed ? null : fees;
}

/** Requested metrics (default all); duplicates dropped, first occurrence kept. */
function checkRateMethods(value: unknown, errors: EngineError[]): RateMethodId[] | null {
  if (value === undefined) {
    return [...RATE_METHOD_IDS];
  }
  if (!isArray(value)) {
    return fail(errors, 'rateMethods');
  }
  const methods: RateMethodId[] = [];
  let failed = false;
  for (let index = 0; index < value.length; index += 1) {
    const method = value[index];
    if (!isOneOf(method, RATE_METHOD_IDS)) {
      failed = true;
      fail(errors, `rateMethods[${String(index)}]`);
    } else if (!methods.includes(method)) {
      methods.push(method);
    }
  }
  return failed ? null : methods;
}

/** Every field of a loan input after phase 1, with defaults applied; `N` not yet known. */
interface LoanFields {
  readonly currency: CurrencyField;
  readonly amount: bigint;
  readonly rate: RateField;
  readonly repayment: RepaymentType;
  /** `null` unless the repayment is a balloon. */
  readonly balloon: BalloonSpec | null;
  readonly frequency: FrequencyId;
  readonly term: TermSpec;
  readonly disbursementDate: LocalDate;
  readonly endOfMonth: boolean;
  readonly accrual: Accrual;
  readonly rounding: RoundingOptions;
  readonly fees: readonly Fee[];
  readonly rateMethods: readonly RateMethodId[];
}

type FieldsResult =
  | { readonly ok: true; readonly fields: LoanFields }
  | { readonly ok: false; readonly errors: readonly EngineError[] };

/** Phase 1: every field on its own, in the order of SPEC §15. */
function checkFields(input: InputObject): FieldsResult {
  const errors: EngineError[] = [];
  const currency = checkCurrency(own(input, 'currency'), errors);
  const digits = currency?.minorUnits;
  const amount = checkAmount(own(input, 'amount'), digits, errors);
  const rate = checkRate(own(input, 'annualRatePct'), errors);
  const repayment = checkId(own(input, 'repayment'), REPAYMENT_TYPES, 'repayment', errors);
  // A failed balloon check is `null` too, but then an error is recorded and phase 1 fails.
  const balloon =
    repayment === 'balloon' ? checkBalloon(own(input, 'balloon'), digits, errors) : null;
  const frequency = checkId(own(input, 'frequency'), FREQUENCY_IDS, 'frequency', errors);
  const term = checkTerm(own(input, 'term'), errors);
  const disbursementDate = checkDate(own(input, 'disbursementDate'), 'disbursementDate', errors);
  const endOfMonth = checkOptionalBoolean(own(input, 'endOfMonth'), true, 'endOfMonth', errors);
  const accrual = checkAccrual(own(input, 'accrual'), frequency, errors);
  const rounding = checkRounding(own(input, 'rounding'), errors);
  const fees = checkFees(own(input, 'fees'), digits, errors);
  const rateMethods = checkRateMethods(own(input, 'rateMethods'), errors);

  // A check returns `null` only with an error recorded (for its field, or for the currency
  // or frequency it depends on); the explicit tests narrow the types.
  if (
    errors.length > 0 ||
    currency === null ||
    amount === null ||
    rate === null ||
    repayment === null ||
    frequency === null ||
    term === null ||
    disbursementDate === null ||
    endOfMonth === null ||
    accrual === null ||
    rounding === null ||
    fees === null ||
    rateMethods === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    fields: {
      currency,
      amount,
      rate,
      repayment,
      balloon,
      frequency,
      term,
      disbursementDate,
      endOfMonth,
      accrual,
      rounding,
      fees,
      rateMethods,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Phase 2: combinations
// ---------------------------------------------------------------------------------------

/** `RATE_NEGATIVE` for `j < 0`, `RATE_HIGH` for `j > 100 %` (SPEC §3.4). */
function rateWarnings(rate: RateField): EngineWarning[] {
  const params = { annualRatePct: rate.annualRatePct };
  if (sign(rate.rate) < 0) {
    return [{ code: 'RATE_NEGATIVE', params }];
  }
  if (compare(rate.rate, ONE) > 0) {
    return [{ code: 'RATE_HIGH', params }];
  }
  return [];
}

/** Phase 2: the combinations of SPEC §13, all reported together. */
function checkCombinations(fields: LoanFields): LoanValidation {
  const errors: EngineError[] = [];
  const { amount, balloon, disbursementDate, frequency, endOfMonth, accrual, rounding } = fields;

  const term = resolvePayments(fields.term, disbursementDate, frequency, endOfMonth);
  if (!term.ok) {
    errors.push({ code: term.code, field: 'term' });
  } else if (
    !isSupportedDate(scheduleDate(disbursementDate, term.payments, frequency, endOfMonth))
  ) {
    errors.push({ code: 'DATE_INVALID', field: 'disbursementDate' });
  }

  if (balloon !== null && accrual.mode === 'daycount' && accrual.paymentBasis === 'exact') {
    errors.push({ code: 'UNSUPPORTED', field: 'accrual.paymentBasis' });
  }

  const principal = principalFinanced(amount, upfrontTotals(fields.fees, amount, rounding.fees));
  if (balloon !== null) {
    const residual = balloonResidual(balloon, principal);
    if (residual <= 0n || residual >= principal) {
      errors.push({ code: 'BALLOON_RANGE', field: 'balloon.value' });
    }
  }

  if (
    term.ok &&
    fields.repayment === 'equal-principal' &&
    rounding.principalRemainder === 'first' &&
    remainderFirstPrincipal(principal, term.payments) < 0n
  ) {
    errors.push({ code: 'AMOUNT_TOO_SMALL_FOR_TERM', field: 'amount' });
  }

  if (errors.length > 0 || !term.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    terms: {
      currency: fields.currency.code,
      minorUnits: fields.currency.minorUnits,
      amount,
      annualRatePct: fields.rate.annualRatePct,
      rate: fields.rate.rate,
      repayment: fields.repayment,
      balloon,
      frequency,
      payments: term.payments,
      disbursementDate,
      endOfMonth,
      accrual,
      rounding,
      fees: fields.fees,
      rateMethods: fields.rateMethods,
    },
    warnings: rateWarnings(fields.rate),
  };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

/**
 * Validates an untrusted loan input against the contract of SPEC §15 with phases 1 and 2
 * of SPEC §13, and applies the defaults.
 *
 * - Not a plain object (null, an array, a primitive) → `[{ INPUT_INVALID, field: null }]`.
 * - Phase 1 errors are all reported together, at most one per field, with exact field
 *   paths (`amount`, `term.payments`, `accrual.mode`, `fees[1].id`, `rateMethods[1]`).
 * - Phase 2 runs only after a clean phase 1: `TERM_TOO_SHORT` / `TERM_RANGE` on `term`,
 *   `DATE_INVALID` on `disbursementDate` (schedule past 9999-12-31), `UNSUPPORTED` on
 *   `accrual.paymentBasis`, `BALLOON_RANGE` on `balloon.value`,
 *   `AMOUNT_TOO_SMALL_FOR_TERM` on `amount`.
 *
 * On success `terms` holds money in minor units (`bigint`), `annualRatePct` as entered,
 * `rate` = `annualRatePct / 100` as an exact fraction per annum, fee percentages as
 * entered (1.5 = 1.5 %), the resolved number of payments `N`, and `rateMethods` in input
 * order without duplicates. `warnings` carries `RATE_NEGATIVE` (`j < 0`) or `RATE_HIGH`
 * (`j > 100 %`) with `params.annualRatePct`. `NEG_AMORTIZATION` (phase 3) is the
 * schedule's check.
 *
 * @param input Any value; typically parsed JSON in the shape of `LoanInput`.
 */
export function validateLoanInput(input: unknown): LoanValidation {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'INPUT_INVALID', field: null }] };
  }
  const phase1 = checkFields(input);
  return phase1.ok ? checkCombinations(phase1.fields) : phase1;
}
