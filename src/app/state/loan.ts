// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The loan scenario as app state (T03 brief §3–§4): the form the inputs edit, the engine
 * input built from it, and the one computed result. Components read these signals and
 * call the update functions; they never compute money or rates themselves.
 *
 * The form holds engine decimal strings ("350000.00", "6.875"), not the text as typed:
 * number inputs parse what the user types (`parseDecimalInput`) and report a field that
 * does not parse with `setInputInvalid`, which blanks the results at once so they never
 * show stale numbers (DESIGN §8.13). Switching the UI language reformats every field from
 * these values.
 */

import { computed, signal } from '@preact/signals';
import {
  type CompoundingId,
  type DayCountId,
  type EngineError,
  type FeeInput,
  type FrequencyId,
  type LoanInput,
  type LoanResult,
  type PaymentBasis,
  type PaymentRounding,
  type PrincipalRemainder,
  type RateMethodId,
  type RepaymentType,
  type RoundingMode,
  calculateLoan,
} from '../../engine';
import { headlineMethodFor, secondaryMethodFor } from './headline';

/** How the term is entered (SPEC §2.4). */
export type TermMode = 'years' | 'payments' | 'endDate';

/** A fee or insurance row of the fee editor. */
export interface FeeDraft {
  /** Stable id; sent to the engine as the fee id, so it is unique and never empty. */
  readonly uid: string;
  /** The user's label, shown only in the UI (empty: a default name by kind). */
  readonly name: string;
  readonly kind: 'upfront' | 'periodic' | 'insurance';
  /** Upfront: fixed | percent; periodic and insurance: fixed | pct-original | pct-balance. */
  readonly calc: 'fixed' | 'percent' | 'pct-original' | 'pct-balance';
  /** Engine decimal string: money in major units, or a percentage (1.5 = 1.5 %). */
  readonly value: string;
  /** Upfront items only. */
  readonly financing: 'paid' | 'financed';
  readonly inApr: boolean;
}

/** Everything the inputs panel edits. Strings are engine decimal or ISO date strings. */
export interface LoanForm {
  readonly currency: string;
  readonly amount: string;
  readonly annualRatePct: string;
  readonly termMode: TermMode;
  readonly termYears: string;
  readonly termMonths: string;
  readonly termPayments: string;
  /** YYYY-MM-DD, or '' when not chosen. */
  readonly termEndDate: string;
  readonly frequency: FrequencyId;
  readonly repayment: RepaymentType;
  readonly balloonKind: 'amount' | 'percent';
  readonly balloonValue: string;
  /** YYYY-MM-DD from the native date input. */
  readonly disbursementDate: string;
  readonly endOfMonth: boolean;
  readonly accrualMode: 'periodic' | 'daycount';
  /** `'payment'`: compound with the payment frequency (the engine's default). */
  readonly compounding: CompoundingId | 'payment';
  readonly dayCount: DayCountId;
  readonly paymentBasis: PaymentBasis;
  readonly roundingInterest: RoundingMode;
  readonly roundingFees: RoundingMode;
  readonly roundingPayment: PaymentRounding;
  readonly principalRemainder: PrincipalRemainder;
  readonly fees: readonly FeeDraft[];
  /** `'auto'`: the method of the currency (`headlineMethodFor`). */
  readonly headlineMethod: RateMethodId | 'auto';
}

/** Today's date as YYYY-MM-DD in the user's time zone (the UI boundary of SPEC §2.1). */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

let nextFeeId = 0;

/** A new unique fee id ("fee-1", "fee-2", …). */
export function newFeeId(): string {
  nextFeeId += 1;
  return `fee-${String(nextFeeId)}`;
}

/**
 * The scenario the app opens with: the design scenario of DESIGN.md (350 000.00 USD at
 * 6.875 % over 30 years, monthly, equal payments, a 1 % origination fee paid at closing
 * and included in the APR), disbursed today. Region profiles and presets replace this in
 * T05.
 */
export function defaultForm(today: string = todayIso()): LoanForm {
  return {
    currency: 'USD',
    amount: '350000.00',
    annualRatePct: '6.875',
    termMode: 'years',
    termYears: '30',
    termMonths: '0',
    termPayments: '360',
    termEndDate: '',
    frequency: 'monthly',
    repayment: 'annuity',
    balloonKind: 'percent',
    balloonValue: '30',
    disbursementDate: today,
    endOfMonth: true,
    accrualMode: 'periodic',
    compounding: 'payment',
    dayCount: 'act-365f',
    paymentBasis: 'nominal',
    roundingInterest: 'half-up',
    roundingFees: 'half-up',
    roundingPayment: 'minor-half-up',
    principalRemainder: 'last',
    fees: [
      {
        uid: newFeeId(),
        name: '',
        kind: 'upfront',
        calc: 'percent',
        value: '1',
        financing: 'paid',
        inApr: true,
      },
    ],
    headlineMethod: 'auto',
  };
}

/** The scenario being edited. */
export const form = signal<LoanForm>(defaultForm());

/** Replaces some fields of the form. */
export function updateForm(patch: Partial<LoanForm>): void {
  form.value = { ...form.value, ...patch };
}

/** Adds a fee row (an upfront fee paid at closing, fixed, empty value) and returns its id. */
export function addFee(kind: FeeDraft['kind'] = 'upfront'): string {
  const uid = newFeeId();
  const fee: FeeDraft = {
    uid,
    name: '',
    kind,
    calc: 'fixed',
    value: '0',
    financing: 'paid',
    inApr: true,
  };
  updateForm({ fees: [...form.value.fees, fee] });
  return uid;
}

/**
 * Changes a fee row. Changing the kind keeps the calculation when it is allowed for the
 * new kind (fixed always is; a percentage maps between `percent` and `pct-original`).
 */
export function updateFee(uid: string, patch: Partial<Omit<FeeDraft, 'uid'>>): void {
  updateForm({
    fees: form.value.fees.map((fee) => {
      if (fee.uid !== uid) {
        return fee;
      }
      const next = { ...fee, ...patch };
      if (patch.kind !== undefined && patch.calc === undefined) {
        if (next.kind === 'upfront' && next.calc !== 'fixed') {
          return { ...next, calc: 'percent' };
        }
        if (next.kind !== 'upfront' && next.calc === 'percent') {
          return { ...next, calc: 'pct-original' };
        }
      }
      return next;
    }),
  });
}

/** Removes a fee row (and any parse error it had). */
export function removeFee(uid: string): void {
  updateForm({ fees: form.value.fees.filter((fee) => fee.uid !== uid) });
  setInputInvalid(feeValueField(uid), false);
}

/** Restores the opening scenario (keeps today's date). */
export function resetForm(): void {
  form.value = defaultForm();
  inputErrors.value = new Set();
}

// ---------------------------------------------------------------------------------------
// Field paths and input ids
// ---------------------------------------------------------------------------------------

/**
 * A UI field: an engine field path (SPEC §13: `amount`, `term.years`, `balloon.value`,
 * `fees`, …) or a fee value written as `fee:<uid>.value`, which the engine reports as
 * `fees[i].value` (`fieldOfEngineError` translates it).
 */
export type FieldPath = string;

/** The UI field of a fee's value. */
export function feeValueField(uid: string): FieldPath {
  return `fee:${uid}.value`;
}

/** The `id` of the input element that edits a field, so an error can focus it. */
export function inputIdFor(field: FieldPath): string {
  const fee = /^fee:(.+)\.value$/.exec(field);
  if (fee !== null) {
    return `fee-${fee[1] ?? ''}-value`;
  }
  return `field-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/** Fields that sit inside the Advanced disclosure; an error there opens it. */
export const ADVANCED_FIELDS: ReadonlySet<FieldPath> = new Set([
  'accrual.mode',
  'accrual.compounding',
  'accrual.method',
  'accrual.paymentBasis',
  'rounding.interest',
  'rounding.fees',
  'rounding.payment',
  'rounding.principalRemainder',
  'endOfMonth',
  'rateMethods',
]);

/**
 * The UI field an engine error belongs to: its field path, with `fees[i].…` rewritten to
 * the fee row's id, or `null` for an error no single input causes (`NEG_AMORTIZATION`).
 */
export function fieldOfEngineError(
  error: EngineError,
  fees: readonly FeeDraft[] = form.value.fees,
): FieldPath | null {
  if (error.field === null) {
    return null;
  }
  const fee = /^fees\[(\d+)\](?:\.(\w+))?$/.exec(error.field);
  if (fee !== null) {
    const draft = fees[Number(fee[1])];
    return draft === undefined ? 'fees' : feeValueField(draft.uid);
  }
  return error.field;
}

// ---------------------------------------------------------------------------------------
// Typing errors (fields whose text does not parse)
// ---------------------------------------------------------------------------------------

/** Fields whose current text does not parse; any entry blanks the results. */
export const inputErrors = signal<ReadonlySet<FieldPath>>(new Set());

/** Marks a field's text as unparseable (or clears the mark). */
export function setInputInvalid(field: FieldPath, invalid: boolean): void {
  const current = inputErrors.value;
  if (current.has(field) === invalid) {
    return;
  }
  const next = new Set(current);
  if (invalid) {
    next.add(field);
  } else {
    next.delete(field);
  }
  inputErrors.value = next;
}

// ---------------------------------------------------------------------------------------
// Engine input and result
// ---------------------------------------------------------------------------------------

/** The engine input of a form (SPEC §15). */
export function toLoanInput(value: LoanForm): LoanInput {
  const term: LoanInput['term'] =
    value.termMode === 'payments'
      ? { payments: Number(value.termPayments) }
      : value.termMode === 'endDate'
        ? { endDate: value.termEndDate }
        : { years: Number(value.termYears), months: Number(value.termMonths) };
  const fees: FeeInput[] = value.fees.map((fee) =>
    fee.kind === 'upfront'
      ? {
          id: fee.uid,
          kind: 'upfront',
          calc: fee.calc === 'fixed' ? 'fixed' : 'percent',
          value: fee.value,
          financing: fee.financing,
          inApr: fee.inApr,
        }
      : {
          id: fee.uid,
          kind: fee.kind,
          calc: fee.calc === 'percent' ? 'pct-original' : fee.calc,
          value: fee.value,
          inApr: fee.inApr,
        },
  );
  return {
    currency: value.currency,
    amount: value.amount,
    annualRatePct: value.annualRatePct,
    repayment: value.repayment,
    ...(value.repayment === 'balloon'
      ? { balloon: { kind: value.balloonKind, value: value.balloonValue } }
      : {}),
    frequency: value.frequency,
    term,
    disbursementDate: value.disbursementDate,
    endOfMonth: value.endOfMonth,
    accrual:
      value.accrualMode === 'daycount'
        ? { mode: 'daycount', method: value.dayCount, paymentBasis: value.paymentBasis }
        : value.compounding === 'payment'
          ? { mode: 'periodic' }
          : { mode: 'periodic', compounding: value.compounding },
    rounding: {
      interest: value.roundingInterest,
      fees: value.roundingFees,
      payment: value.roundingPayment,
      principalRemainder: value.principalRemainder,
    },
    fees,
  };
}

/** The engine input of the current form. */
export const loanInput = computed<LoanInput>(() => toLoanInput(form.value));

/**
 * The calculation, recomputed on every change (no Calculate button), or `null` while a
 * field's text does not parse: results are blanked rather than stale (DESIGN §8.13).
 */
export const result = computed<LoanResult | null>(() =>
  inputErrors.value.size > 0 ? null : calculateLoan(loanInput.value),
);

/** The successful result, or `null` (typing errors or engine errors). */
export const okResult = computed(() => {
  const current = result.value;
  return current?.ok === true ? current : null;
});

/** Engine errors of the current input (empty while typing errors exist). */
export const engineErrors = computed<readonly EngineError[]>(() => {
  const current = result.value;
  return current !== null && !current.ok ? current.errors : [];
});

/** Errors by UI field: typing errors (`INPUT_INVALID`) and the engine's field errors. */
export const fieldErrors = computed<ReadonlyMap<FieldPath, EngineError>>(() => {
  const errors = new Map<FieldPath, EngineError>();
  for (const field of inputErrors.value) {
    errors.set(field, { code: 'INPUT_INVALID', field });
  }
  for (const error of engineErrors.value) {
    const field = fieldOfEngineError(error);
    if (field !== null && !errors.has(field)) {
      errors.set(field, error);
    }
  }
  return errors;
});

/** The headline cost-of-credit method in effect. */
export const headlineMethod = computed<RateMethodId>(() =>
  form.value.headlineMethod === 'auto'
    ? headlineMethodFor(form.value.currency)
    : form.value.headlineMethod,
);

/** The secondary rate method shown next to the headline (DESIGN §8.7). */
export const secondaryMethod = computed<RateMethodId>(() =>
  secondaryMethodFor(headlineMethod.value),
);
