// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Display models of the engine's explanation payloads (SPEC §9.6; DESIGN §8.6, §8.12):
 * the formula as structured parts (text, superscripts, subscripts), the values substituted
 * into it, every payload value with its label, and the result, formatted for a locale.
 *
 * The models are built from the payload alone, so a formula shown from them reproduces
 * the engine's result: `i` is shown as `j ÷ m` (never as a rounded quotient), exact values
 * keep all their digits and irrational ones show 10 significant digits (`computedNumber`),
 * and the result is the payload's own value (`A`, or `first` for equal principal and
 * interest-only), never recomputed. Words (a day-count method, a time basis, "first
 * payment") stay message keys or ids, which the components translate.
 */

import {
  DAY_COUNT_IDS,
  type DayCountId,
  type Explain,
  type RateMethodId,
  type RateMetric,
} from '../../engine';
import { type MessageKey, formatNumber, formatPercent } from '../../i18n';
import { toMinor } from './derived';
import { percentToFraction } from './display';

/** One piece of a formula or of a displayed value. */
export type FormulaPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'sup'; readonly parts: FormulaText }
  | { readonly kind: 'sub'; readonly parts: FormulaText }
  /** A day-count method, named in the UI language (`dayCountName`). */
  | { readonly kind: 'dayCount'; readonly id: DayCountId }
  /** A word or phrase in the UI language. */
  | { readonly kind: 'message'; readonly key: MessageKey };

/** A run of formula parts: an expression, a symbol or a value. */
export type FormulaText = readonly FormulaPart[];

/**
 * A value substituted into the formula strip, `i = 0.06875 ÷ 12`, or a step of the formula
 * with the payload's value for it, `I₁ = P × i = 1,993.83`.
 */
export interface Substitution {
  /** A symbol, or a step written with symbols (`I₁ = P × i`). */
  readonly symbol: FormulaText;
  readonly value: FormulaText;
}

/** One payload value for the Explain sheet's list. */
export interface FormulaValue {
  /** The payload key (`P`, `Astar`, `timeBasis`, …). */
  readonly name: string;
  /** Empty for a value the formula names in words (`first`: "first payment"). */
  readonly symbol: FormulaText;
  /** The label (`explain.sym*`), or `null` for a key LoanLogic does not know. */
  readonly label: MessageKey | null;
  readonly value: FormulaText;
}

/** The figure a formula produces. */
export interface FormulaResult {
  /** The engine's value: an amount in major units, or a rate's rounded display. */
  readonly raw: string;
  /** Formatted for the strip: an amount without the currency symbol, or a percentage. */
  readonly text: string;
  /** The result's symbol when the formula's left-hand side names something else. */
  readonly symbol: FormulaText | null;
}

/** A formula ready to display. */
export interface FormulaModel {
  /** The engine's formula id (`instalment.annuity`). */
  readonly id: string;
  /**
   * The formula: the main expression first (the strip shows it), then the definitions the
   * sheet adds (`i = j ÷ m`). Empty for an id LoanLogic does not know.
   */
  readonly lines: readonly FormulaText[];
  /** The values the strip substitutes, in reading order. */
  readonly substitutions: readonly Substitution[];
  /** Every payload value, in payload order. */
  readonly values: readonly FormulaValue[];
  /** `null` for an instalment formula LoanLogic does not know. */
  readonly result: FormulaResult | null;
  /** What the formula means, or `null` for an unknown id. */
  readonly note: MessageKey | null;
  /** Between substitutions: ", ", or "; " where the decimal separator is a comma. */
  readonly separator: string;
}

// ---------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------

function text(value: string): FormulaPart {
  return { kind: 'text', text: value };
}

/**
 * Parses the formula notation used below: `^{…}` is a superscript, `_{…}` a subscript,
 * and they nest (`(1 + X)^{−t_{k}}`). Everything else is text.
 */
function parse(markup: string): FormulaPart[] {
  const parts: FormulaPart[] = [];
  let plain = '';
  let index = 0;
  while (index < markup.length) {
    const char = markup.charAt(index);
    if ((char === '^' || char === '_') && markup.charAt(index + 1) === '{') {
      let end = index + 2;
      for (let depth = 1; end < markup.length; end += 1) {
        depth += markup.charAt(end) === '{' ? 1 : markup.charAt(end) === '}' ? -1 : 0;
        if (depth === 0) {
          break;
        }
      }
      if (plain !== '') {
        parts.push(text(plain));
        plain = '';
      }
      const inner = parse(markup.slice(index + 2, end));
      parts.push(char === '^' ? { kind: 'sup', parts: inner } : { kind: 'sub', parts: inner });
      index = end + 1;
    } else {
      plain += char;
      index += 1;
    }
  }
  if (plain !== '') {
    parts.push(text(plain));
  }
  return parts;
}

// ---------------------------------------------------------------------------------------
// Payload values
// ---------------------------------------------------------------------------------------

/**
 * How a payload value is shown: money at the currency's minor units, a count, an exact
 * rate with all its digits, a computed value (`computedNumber`), the exact instalment `A*`
 * (computed, and never coarser than the minor units), or a word.
 */
type ValueFormat =
  | 'money'
  | 'count'
  | 'exact'
  | 'computed'
  | 'instalment'
  | 'dayCount'
  | 'timeBasis'
  | 'compounding';

interface ValueSpec {
  readonly symbol: string;
  readonly label: MessageKey;
  readonly format: ValueFormat;
}

/** Every payload key of SPEC §9.6. */
const VALUE_SPECS: ReadonlyMap<string, ValueSpec> = new Map<string, ValueSpec>([
  ['P', { symbol: 'P', label: 'explain.symP', format: 'money' }],
  ['N', { symbol: 'N', label: 'explain.symN', format: 'count' }],
  ['j', { symbol: 'j', label: 'explain.symJ', format: 'exact' }],
  ['m', { symbol: 'm', label: 'explain.symM', format: 'count' }],
  ['i', { symbol: 'i', label: 'explain.symI', format: 'computed' }],
  ['Astar', { symbol: 'A^{*}', label: 'explain.symAstar', format: 'instalment' }],
  ['A', { symbol: 'A', label: 'explain.symA', format: 'money' }],
  ['Bal', { symbol: 'Bal', label: 'explain.symBal', format: 'money' }],
  ['q', { symbol: 'q', label: 'explain.symQ', format: 'money' }],
  ['p1', { symbol: 'p_{1}', label: 'explain.symP1', format: 'money' }],
  ['I1', { symbol: 'I_{1}', label: 'explain.symI1', format: 'money' }],
  // The formulas name it in words ("first payment"), which its label already says.
  ['first', { symbol: '', label: 'explain.symFirst', format: 'money' }],
  ['dayCount', { symbol: 'YF_{k}', label: 'explain.symDayCount', format: 'dayCount' }],
  ['yf1', { symbol: 'YF_{1}', label: 'explain.symYf1', format: 'computed' }],
  ['c', { symbol: 'c', label: 'explain.symC', format: 'compounding' }],
  ['k', { symbol: 'k', label: 'explain.symK', format: 'computed' }],
  ['r', { symbol: 'r', label: 'explain.symR', format: 'computed' }],
  ['X', { symbol: 'X', label: 'explain.symX', format: 'computed' }],
  ['timeBasis', { symbol: 't_{k}', label: 'explain.symTimeBasis', format: 'timeBasis' }],
  ['Af', { symbol: 'A_{f}', label: 'explain.symAf', format: 'money' }],
  ['days', { symbol: 'D', label: 'explain.symDays', format: 'count' }],
  ['months', { symbol: 'M', label: 'explain.symMonths', format: 'count' }],
  ['unitPeriodsPerYear', { symbol: 'U', label: 'explain.symUnitPeriods', format: 'computed' }],
  ['t', { symbol: 't', label: 'explain.symT', format: 'count' }],
  ['f', { symbol: 'f', label: 'explain.symF', format: 'computed' }],
]);

const TIME_BASIS_KEYS: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['periods', 'explain.timeBasisPeriods'],
  ['counted-back', 'explain.timeBasisCountedBack'],
  ['days-365', 'explain.timeBasisDays365'],
]);

/**
 * The most significant digits a payload value of a computed quantity has when it is
 * exact: SPEC §9.6 gives a value that does not terminate with at least 12, so a shorter
 * one is the exact value (or one whose further digits are zeros).
 */
const EXACT_DIGITS = 11;

/** Significant digits of a plain decimal string ("0.015378162651" → 11, "1200" → 2). */
function significantDigits(value: string): number {
  const [whole = '', fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return (whole + fraction).replace(/^0+/, '').replace(/0+$/, '').length;
}

/**
 * Formats a computed payload value (DESIGN §8.6): all its digits when it is exact, else
 * 10 significant digits. An exact value with more than 11 digits looks like an irrational
 * one and is rounded too; the payload does not say which it is.
 */
function computedNumber(value: string, locale: string): string {
  return significantDigits(value) <= EXACT_DIGITS
    ? formatNumber(value, locale)
    : formatNumber(value, locale, { maximumSignificantDigits: 10 });
}

/**
 * Formats the exact instalment `A*` like `computedNumber`, but never with fewer decimals
 * than the currency's minor units: 10 significant digits of 124074072957.4017 would show
 * 124,074,073,000, coarser than the instalment it rounds to (124,074,072,957.40).
 */
function instalmentNumber(value: string, locale: string, minorUnits: number): string {
  return significantDigits(value) <= EXACT_DIGITS
    ? formatNumber(value, locale, { minimumFractionDigits: minorUnits })
    : formatNumber(value, locale, {
        maximumSignificantDigits: 10,
        minimumFractionDigits: minorUnits,
        maximumFractionDigits: minorUnits,
        roundingPriority: 'morePrecision',
      });
}

/** Formats payload values for one locale and currency. */
class Payload {
  constructor(
    readonly values: Readonly<Record<string, string>>,
    private readonly locale: string,
    private readonly minorUnits: number,
  ) {}

  /**
   * A value the formula needs.
   *
   * @throws RangeError when the payload lacks it (the caller shows the raw payload).
   */
  need(name: string): string {
    const value = Object.hasOwn(this.values, name) ? this.values[name] : undefined;
    if (value === undefined) {
      throw new RangeError(`The payload has no "${name}"`);
    }
    return value;
  }

  has(name: string): boolean {
    return Object.hasOwn(this.values, name);
  }

  /**
   * A money value as minor units, to tell which formula the values follow (exact BigInt
   * arithmetic; nothing shown is computed from it).
   *
   * @throws RangeError when the value is missing or not an amount at the minor units.
   */
  minor(name: string): bigint {
    const value = this.need(name);
    const [whole = '', fraction] = value.replace(/^-/, '').split('.');
    if (!/^\d+$/.test(whole) || (fraction !== undefined && !/^\d+$/.test(fraction))) {
      throw new RangeError(`The payload's "${name}" is not an amount`);
    }
    // More digits than the minor units would be cut off, not compared.
    if ((fraction?.length ?? 0) > this.minorUnits) {
      throw new RangeError(`The payload's "${name}" is finer than the minor units`);
    }
    return toMinor(value, this.minorUnits);
  }

  /** A number in the locale with the format of its key. */
  number(name: string): string {
    const value = this.need(name);
    switch (VALUE_SPECS.get(name)?.format) {
      case 'money':
        return formatNumber(value, this.locale, {
          minimumFractionDigits: this.minorUnits,
          maximumFractionDigits: this.minorUnits,
        });
      case 'computed':
        return computedNumber(value, this.locale);
      case 'instalment':
        return instalmentNumber(value, this.locale, this.minorUnits);
      default:
        return formatNumber(value, this.locale);
    }
  }

  /** A value as display parts: a number, or a word for ids. */
  display(name: string): FormulaText {
    const value = this.need(name);
    const format = VALUE_SPECS.get(name)?.format;
    if (format === 'dayCount') {
      const id = DAY_COUNT_IDS.find((candidate) => candidate === value);
      return [id === undefined ? text(value) : { kind: 'dayCount', id }];
    }
    if (format === 'timeBasis') {
      const key = TIME_BASIS_KEYS.get(value);
      return [key === undefined ? text(value) : { kind: 'message', key }];
    }
    if (format === 'compounding' && value === 'continuous') {
      return [{ kind: 'message', key: 'compounding.continuous' }];
    }
    return [text(this.number(name))];
  }

  /** `symbol = value` for the strip. */
  substitution(name: string): Substitution {
    return { symbol: parse(VALUE_SPECS.get(name)?.symbol ?? name), value: this.display(name) };
  }

  /**
   * Every payload value with its symbol and label.
   *
   * @param labels Labels that differ in this formula (Reg Z's `P` is the payment).
   */
  list(labels: ReadonlyMap<string, MessageKey> = new Map()): FormulaValue[] {
    return Object.keys(this.values).map((name) => {
      const spec = VALUE_SPECS.get(name);
      return {
        name,
        symbol: parse(spec?.symbol ?? name),
        label: labels.get(name) ?? spec?.label ?? null,
        value: this.display(name),
      };
    });
  }
}

/** Whether an exact decimal string is zero ("0", "0.000", "-0"). */
function isZero(value: string): boolean {
  return /^[+-]?0+(\.0+)?$/.test(value);
}

/**
 * The separator between substitutions: ", " unless the locale writes decimals with a
 * comma ("0,06875"), where "; " keeps the values apart.
 */
export function substitutionSeparator(locale: string): string {
  return formatNumber('1.5', locale).includes('.') ? ', ' : '; ';
}

/** A value as a number in the locale, or as it is when it is not a decimal string. */
function rawNumber(value: string, locale: string): string {
  try {
    return formatNumber(value, locale);
  } catch {
    return value;
  }
}

/**
 * A formula LoanLogic does not know, or a payload its formula cannot be built from (a
 * missing or malformed value): the id and the raw values formatted as numbers, never
 * another formula in its place.
 */
function unknownFormula(
  explain: Explain,
  locale: string,
  result: FormulaResult | null,
): FormulaModel {
  const values = Object.entries(explain.values).map(([name, value]) => ({
    name,
    symbol: [text(name)],
    label: null,
    value: [text(rawNumber(value, locale))],
  }));
  return {
    id: explain.formulaId,
    lines: [],
    substitutions: values.map(({ symbol, value }) => ({ symbol, value })),
    values,
    result,
    note: null,
    separator: substitutionSeparator(locale),
  };
}

/** What a formula builder returns; the shared parts are added by the caller. */
interface Formula {
  readonly lines: readonly FormulaText[];
  readonly substitutions: readonly Substitution[];
  /** Labels that differ from the usual meaning of a symbol in this formula. */
  readonly labels?: ReadonlyMap<string, MessageKey>;
}

// ---------------------------------------------------------------------------------------
// Instalment formulas (SPEC §5)
// ---------------------------------------------------------------------------------------

/** An instalment formula also names the payload value it produces. */
interface InstalmentFormula extends Formula {
  /** The result's payload key, and its symbol when the formula's left side is another. */
  readonly result: { readonly name: string; readonly symbol: string | null };
}

const INSTALMENT_A = { name: 'A', symbol: null } as const;

/**
 * The periodic rate as substituted: the payload's `i` when compounding differs from the
 * payment frequency, else `j ÷ m` with both values exact ("0.06875 ÷ 12").
 */
function periodicRate(payload: Payload): Substitution {
  if (payload.has('i')) {
    return payload.substitution('i');
  }
  return {
    symbol: parse('i'),
    value: [text(`${payload.number('j')} ÷ ${payload.number('m')}`)],
  };
}

/** `i = j ÷ m` as a definition line, unless the payload gives `i` itself. */
function periodicRateLines(payload: Payload): FormulaText[] {
  return payload.has('i') ? [] : [parse('i = j ÷ m')];
}

function annuity(payload: Payload): InstalmentFormula {
  if (isZero(payload.need('j'))) {
    return {
      lines: [parse('A = P ÷ N')],
      substitutions: [payload.substitution('P'), payload.substitution('N')],
      result: INSTALMENT_A,
    };
  }
  return {
    lines: [parse('A = P·i ÷ (1 − (1 + i)^{−N})'), ...periodicRateLines(payload)],
    substitutions: [payload.substitution('P'), periodicRate(payload), payload.substitution('N')],
    result: INSTALMENT_A,
  };
}

/** The exact day-count basis: a rate per period, `r_k = j × YF_k`, and no single `i`. */
function annuityExactBasis(payload: Payload): InstalmentFormula {
  return {
    lines: [parse('A = P·Π(1 + r_{k}) ÷ Σ_{s} Π_{k>s}(1 + r_{k})'), parse('r_{k} = j × YF_{k}')],
    substitutions: [
      payload.substitution('P'),
      { symbol: parse('r_{k}'), value: [text(`${payload.number('j')} × YF`), ...parse('_{k}')] },
      payload.substitution('dayCount'),
      payload.substitution('N'),
    ],
    result: INSTALMENT_A,
  };
}

function balloon(payload: Payload): InstalmentFormula {
  if (isZero(payload.need('j'))) {
    return {
      lines: [parse('A = (P − Bal) ÷ N')],
      substitutions: ['P', 'Bal', 'N'].map((name) => payload.substitution(name)),
      result: INSTALMENT_A,
    };
  }
  return {
    lines: [
      parse('A = (P − Bal·(1 + i)^{−N})·i ÷ (1 − (1 + i)^{−N})'),
      ...periodicRateLines(payload),
    ],
    substitutions: [
      payload.substitution('P'),
      payload.substitution('Bal'),
      periodicRate(payload),
      payload.substitution('N'),
    ],
    result: INSTALMENT_A,
  };
}

/** The result of the equal-principal and interest-only formulas: the payload's `first`. */
const FIRST_PAYMENT = { name: 'first', symbol: null } as const;

/** "first payment" in the UI language, then the rest of a formula's line. */
function firstPaymentLine(markup: string): FormulaText {
  return [{ kind: 'message', key: 'explain.stripFirst' }, ...parse(markup)];
}

/** A step of the formula with the payload's value for it: `I₁ = P × i = 1,993.83`. */
function step(payload: Payload, markup: string, name: string): Substitution {
  return { symbol: parse(markup), value: payload.display(name) };
}

/** The first period's interest `I₁` and the rate values it is computed from. */
interface FirstInterest {
  readonly markup: string;
  readonly operands: readonly string[];
}

/**
 * `I₁` (DESIGN §8.6): `P × j × YF₁` in day-count mode (the payload carries `yf1`), else
 * `P × i` when the payload carries `i` (periodic interest with `c ≠ m`), else `P × j ÷ m`.
 */
function firstInterest(payload: Payload): FirstInterest {
  if (payload.has('yf1')) {
    return { markup: 'I_{1} = P × j × YF_{1}', operands: ['j', 'yf1'] };
  }
  if (payload.has('i')) {
    return { markup: 'I_{1} = P × i', operands: ['i'] };
  }
  return { markup: 'I_{1} = P × j ÷ m', operands: ['j', 'm'] };
}

/**
 * Equal principal (SPEC §5.3): `q = R(P ÷ N)`, and the first payment `p₁ + I₁`, where
 * `p₁ = q`, or `p₁ = P − (N − 1)·q` when the rounding remainder comes first. Which one
 * applies is read from the payload's values; values that follow neither, or a `first`
 * that is not `p₁ + I₁`, are not shown with this formula.
 *
 * @throws RangeError for such values (the caller shows the raw payload).
 */
function equalPrincipal(payload: Payload): InstalmentFormula {
  const p1 = payload.minor('p1');
  const q = payload.minor('q');
  if (payload.minor('first') !== p1 + payload.minor('I1')) {
    throw new RangeError('The first payment is not p1 + I1');
  }
  let remainderFirst = false;
  if (p1 !== q) {
    const n = BigInt(payload.need('N'));
    if (p1 !== payload.minor('P') - (n - 1n) * q) {
      throw new RangeError('p1 is neither q nor P − (N − 1)·q');
    }
    remainderFirst = true;
  }
  const interest = firstInterest(payload);
  return {
    lines: [
      firstPaymentLine(' = p_{1} + I_{1}'),
      parse('q = R(P ÷ N)'),
      parse(remainderFirst ? 'p_{1} = P − (N − 1)·q' : 'p_{1} = q'),
      parse(interest.markup),
    ],
    substitutions: [
      ...(remainderFirst
        ? [step(payload, 'q = R(P ÷ N)', 'q'), step(payload, 'p_{1} = P − (N − 1)·q', 'p1')]
        : [step(payload, 'p_{1} = q = R(P ÷ N)', 'p1')]),
      step(payload, interest.markup, 'I1'),
      ...['P', 'N', ...interest.operands].map((name) => payload.substitution(name)),
    ],
    result: FIRST_PAYMENT,
  };
}

/**
 * Interest only (SPEC §5.4): no principal until the last payment, so the first payment is
 * `I₁`, or `P + I₁` with a single payment. Which one applies is read from the payload's
 * values (`P` is never zero, so they cannot both hold).
 *
 * @throws RangeError when `first` is neither (the caller shows the raw payload).
 */
function bullet(payload: Payload): InstalmentFormula {
  const first = payload.minor('first');
  const i1 = payload.minor('I1');
  const interest = firstInterest(payload);
  const principal = parse('p_{k} = 0 (k < N), p_{N} = P');
  const operands = ['P', 'N', ...interest.operands].map((name) => payload.substitution(name));
  if (first === i1) {
    return {
      lines: [firstPaymentLine(` = ${interest.markup}`), principal],
      substitutions: operands,
      result: FIRST_PAYMENT,
    };
  }
  if (first !== payload.minor('P') + i1) {
    throw new RangeError('The first payment is neither I1 nor P + I1');
  }
  return {
    lines: [firstPaymentLine(' = P + I_{1}'), parse(interest.markup), principal],
    // I₁ shows its value: the result adds P to it.
    substitutions: [step(payload, interest.markup, 'I1'), ...operands],
    result: FIRST_PAYMENT,
  };
}

interface InstalmentEntry {
  readonly build: (payload: Payload) => InstalmentFormula;
  readonly note: MessageKey;
}

const INSTALMENT_FORMULAS: ReadonlyMap<string, InstalmentEntry> = new Map<string, InstalmentEntry>([
  ['instalment.annuity', { build: annuity, note: 'explain.instalmentAnnuity' }],
  [
    'instalment.annuity-exact-basis',
    { build: annuityExactBasis, note: 'explain.instalmentExactBasis' },
  ],
  ['instalment.balloon', { build: balloon, note: 'explain.instalmentBalloon' }],
  [
    'instalment.equal-principal',
    { build: equalPrincipal, note: 'explain.instalmentEqualPrincipal' },
  ],
  ['instalment.bullet', { build: bullet, note: 'explain.instalmentBullet' }],
]);

/**
 * The instalment's formula (SPEC §5, §9.6) from the result's top-level `explain`.
 *
 * @param explain The payload: an `instalment.*` formula id and decimal-string values.
 * @param locale BCP 47 formatting locale.
 * @param minorUnits Digits of the currency's minor unit, for amounts.
 */
export function instalmentFormula(
  explain: Explain,
  locale: string,
  minorUnits: number,
): FormulaModel {
  const known = INSTALMENT_FORMULAS.get(explain.formulaId);
  if (known === undefined) {
    return unknownFormula(explain, locale, null);
  }
  const payload = new Payload(explain.values, locale, minorUnits);
  try {
    const formula = known.build(payload);
    const { name, symbol } = formula.result;
    return {
      id: explain.formulaId,
      lines: formula.lines,
      substitutions: formula.substitutions,
      values: payload.list(),
      result: {
        raw: payload.need(name),
        text: payload.number(name),
        symbol: symbol === null ? null : parse(symbol),
      },
      note: known.note,
      separator: substitutionSeparator(locale),
    };
  } catch {
    return unknownFormula(explain, locale, null);
  }
}

// ---------------------------------------------------------------------------------------
// Rate formulas (SPEC §9.2, §9.3)
// ---------------------------------------------------------------------------------------

const RATE_NOTES: Readonly<Record<RateMethodId, MessageKey>> = {
  nominal: 'explain.noteNominal',
  effective: 'explain.noteEffective',
  irrNominal: 'explain.noteIrrNominal',
  irrEffective: 'explain.noteIrrEffective',
  xirr: 'explain.noteXirr',
  usRegZApr: 'explain.noteUsRegZApr',
  ukAprc: 'explain.noteUkAprc',
  euAprc: 'explain.noteEuAprc',
  cnAnnualized: 'explain.noteCnAnnualized',
  uaRealAnnual: 'explain.noteUaRealAnnual',
  international: 'explain.noteInternational',
};

/** The regulatory or methodological note of a rate method (DESIGN §8.12). */
export function rateNote(method: RateMethodId): MessageKey {
  return RATE_NOTES[method];
}

/** `rate.effective`: periodic, continuous or day-count compounding (SPEC §9.2). */
function effectiveRate(payload: Payload): Formula {
  if (payload.has('k')) {
    return {
      lines: [parse('(1 + j·k ÷ m)^{m} − 1')],
      substitutions: ['j', 'k', 'm'].map((name) => payload.substitution(name)),
    };
  }
  if (payload.need('c') === 'continuous') {
    return { lines: [parse('e^{j} − 1')], substitutions: [payload.substitution('j')] };
  }
  return {
    lines: [parse('(1 + j ÷ c)^{c} − 1')],
    substitutions: ['j', 'c'].map((name) => payload.substitution(name)),
  };
}

/**
 * `rate.periodic-irr`: the periodic IRR `r` (SPEC §10), annualized as `(1 + r)^m − 1` for
 * `irrEffective` and `r × m` for the others (SPEC §9.2, §9.3).
 */
function periodicIrr(payload: Payload, method: RateMethodId): Formula {
  return {
    lines: [
      parse(method === 'irrEffective' ? '(1 + r)^{m} − 1' : 'r × m'),
      parse('Σ CF_{k}·(1 + r)^{−k} = 0'),
    ],
    substitutions: ['r', 'm'].map((name) => payload.substitution(name)),
  };
}

/**
 * `rate.regz-single-payment` (SPEC §9.3 a): under a year the unit-period rate times the
 * unit periods per year (12 ÷ M, or 365 ÷ D when the term is not whole months); a year or
 * more solves `A_f·(1 + f·i)·(1 + i)^t = P` for the annual `i`.
 */
function regZSinglePayment(payload: Payload): Formula {
  const substitutions = Object.keys(payload.values).map((name) => payload.substitution(name));
  // P is the single payment here, not the principal financed.
  const labels = new Map<string, MessageKey>([['P', 'explain.symPayment']]);
  if (payload.has('t')) {
    return { lines: [parse('A_{f}·(1 + f·i)·(1 + i)^{t} = P')], substitutions, labels };
  }
  const wholeMonths = !isZero(payload.need('months'));
  return {
    lines: [
      parse('i × U'),
      parse('i = P ÷ A_{f} − 1'),
      parse(wholeMonths ? 'U = 12 ÷ M' : 'U = 365 ÷ D'),
    ],
    substitutions,
    labels,
  };
}

/** `rate.annual-irr`: APRC and the XIRR family, `X` solved directly (SPEC §9.3, §10). */
function annualIrr(payload: Payload): Formula {
  return {
    lines: [parse('Σ CF_{k}·(1 + X)^{−t_{k}} = 0')],
    substitutions: ['X', 'timeBasis'].map((name) => payload.substitution(name)),
  };
}

type RateBuilder = (payload: Payload, method: RateMethodId) => Formula;

const RATE_FORMULAS: ReadonlyMap<string, RateBuilder> = new Map<string, RateBuilder>([
  [
    'rate.nominal',
    (payload) => ({ lines: [parse('j')], substitutions: [payload.substitution('j')] }),
  ],
  ['rate.effective', effectiveRate],
  ['rate.periodic-irr', periodicIrr],
  ['rate.regz-single-payment', regZSinglePayment],
  ['rate.annual-irr', annualIrr],
]);

/**
 * A rate metric's formula (SPEC §9.2, §9.3, §9.6) with its result in the method's
 * precision ("6.974%").
 *
 * @param method The metric's id, which picks the annualization of `rate.periodic-irr` and
 *   the note.
 * @param metric The computed metric (a failed one has no formula).
 * @param locale BCP 47 formatting locale.
 * @param minorUnits Digits of the currency's minor unit, for `A_f` and `P`.
 */
export function rateFormula(
  method: RateMethodId,
  metric: RateMetric,
  locale: string,
  minorUnits: number,
): FormulaModel {
  const result: FormulaResult = {
    raw: metric.display,
    text: formatPercent(percentToFraction(metric.display), metric.precision, locale),
    symbol: null,
  };
  const build = RATE_FORMULAS.get(metric.explain.formulaId);
  if (build === undefined) {
    return unknownFormula(metric.explain, locale, result);
  }
  const payload = new Payload(metric.explain.values, locale, minorUnits);
  try {
    const formula = build(payload, method);
    return {
      id: metric.explain.formulaId,
      lines: formula.lines,
      substitutions: formula.substitutions,
      values: payload.list(formula.labels),
      result,
      note: RATE_NOTES[method],
      separator: substitutionSeparator(locale),
    };
  } catch {
    return unknownFormula(metric.explain, locale, result);
  }
}

// ---------------------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------------------

/**
 * The formula strip as one run of parts (DESIGN §8.6): the main expression, the
 * substitutions and "→ result", e.g. `A = P·i ÷ (1 − (1 + i)^−N), P = 350,000.00,
 * i = 0.06875 ÷ 12, N = 360 → 2,299.25`. An unknown formula shows its id in place of the
 * expression.
 */
export function stripParts(model: FormulaModel): FormulaText {
  const parts: FormulaPart[] = [...(model.lines[0] ?? [text(model.id)])];
  for (const substitution of model.substitutions) {
    parts.push(text(model.separator), ...substitution.symbol, text(' = '), ...substitution.value);
  }
  if (model.result !== null) {
    parts.push(text(' → '));
    if (model.result.symbol !== null) {
      parts.push(...model.result.symbol, text(' = '));
    }
    parts.push(text(model.result.text));
  }
  return parts;
}
