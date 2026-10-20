// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, formatIsoDate, parseIsoDate } from './date';
import { FREQUENCY_IDS, scheduleDate } from './frequency';
import { parseDecimal } from './rational';
import type { CashFlowTerms, FrequencyId } from './types';
import { validateCashFlowInput } from './validate-cashflows';

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

type Flow = Record<string, unknown>;

function flow(date: string, amount: string, period?: unknown): Flow {
  return period === undefined ? { date, amount } : { date, amount, period };
}

/** Monthly flows with periods: 1 000 received, then three payments of 340. */
const PERIODIC: readonly Flow[] = [
  flow('2026-01-15', '1000', 0),
  flow('2026-02-15', '-340', 1),
  flow('2026-03-15', '-340', 2),
  flow('2026-04-15', '-340', 3),
];

/** The same flows on irregular dates, without periods. */
const IRREGULAR: readonly Flow[] = [
  flow('2026-01-15', '1000'),
  flow('2026-02-10', '-340'),
  flow('2026-03-20', '-340'),
  flow('2026-04-15', '-340'),
];

/** The errors as sorted `CODE@field` keys; fails the test if the input validated. */
function errorsOf(value: unknown): string[] {
  const result = validateCashFlowInput(value);
  if (result.ok) {
    throw new Error(`expected errors, got terms for ${JSON.stringify(value)}`);
  }
  return result.errors.map((error) => `${error.code}@${String(error.field)}`).sort();
}

function termsOf(value: unknown): CashFlowTerms {
  const result = validateCashFlowInput(value);
  if (!result.ok) {
    throw new Error(`expected terms, got ${JSON.stringify(result.errors)}`);
  }
  return result.terms;
}

/** `flows` with item `index` replaced by `item`. */
function replace(flows: readonly unknown[], index: number, item: unknown): unknown[] {
  return flows.map((original, i) => (i === index ? item : original));
}

/** `flows` with the properties of item `index` overridden. */
function patch(flows: readonly unknown[], index: number, overrides: Flow): unknown[] {
  const original = flows[index];
  const base = typeof original === 'object' && original !== null ? original : {};
  return replace(flows, index, { ...base, ...overrides });
}

// ---------------------------------------------------------------------------------------
// Valid inputs
// ---------------------------------------------------------------------------------------

describe('validateCashFlowInput — valid input', () => {
  it('builds flows without a frequency (the XIRR family)', () => {
    const terms = termsOf({ flows: IRREGULAR });
    expect(terms.frequency).toBeNull();
    expect(terms.hasPeriods).toBe(false);
    expect(terms.flows).toEqual([
      { date: { y: 2026, m: 1, d: 15 }, amount: parseDecimal('1000') },
      { date: { y: 2026, m: 2, d: 10 }, amount: parseDecimal('-340') },
      { date: { y: 2026, m: 3, d: 20 }, amount: parseDecimal('-340') },
      { date: { y: 2026, m: 4, d: 15 }, amount: parseDecimal('-340') },
    ]);
    expect(terms.flows.every((item) => !('period' in item))).toBe(true);
  });

  it('builds flows with a frequency and no periods (backward counting)', () => {
    const terms = termsOf({ frequency: 'monthly', flows: IRREGULAR });
    expect(terms.frequency).toBe('monthly');
    expect(terms.hasPeriods).toBe(false);
  });

  it('builds flows with a frequency and periods', () => {
    const terms = termsOf({ frequency: 'monthly', flows: PERIODIC });
    expect(terms.frequency).toBe('monthly');
    expect(terms.hasPeriods).toBe(true);
    expect(terms.flows.map((item) => item.period)).toEqual([0, 1, 2, 3]);
    expect(terms.flows[1]).toEqual({
      date: { y: 2026, m: 2, d: 15 },
      amount: parseDecimal('-340'),
      period: 1,
    });
  });

  it('keeps amounts exact in major units', () => {
    const terms = termsOf({ flows: [flow('2026-01-01', '0.1'), flow('2026-06-01', '-8833.3')] });
    expect(terms.flows.map((item) => item.amount)).toEqual([
      parseDecimal('0.1'),
      parseDecimal('-8833.3'),
    ]);
  });

  it('accepts equal consecutive dates, zero amounts and the amount limits', () => {
    const terms = termsOf({
      flows: [
        flow('2026-01-15', '1000000000000000'),
        flow('2026-01-15', '0'),
        flow('2026-02-15', '-1000000000000000'),
        flow('2026-02-15', '-0.00'),
      ],
    });
    expect(terms.flows).toHaveLength(4);
  });

  it('reads own properties only and ignores unknown keys', () => {
    const inherited = Object.create({ date: '2026-01-15', amount: '1' }) as Flow;
    expect(errorsOf({ flows: [inherited, flow('2026-02-15', '-1')] })).toEqual([
      'INPUT_INVALID@flows[0].amount',
      'INPUT_INVALID@flows[0].date',
    ]);
    expect(
      termsOf({ note: 'x', flows: IRREGULAR.map((item) => ({ ...item, memo: 1 })) }).flows,
    ).toEqual(termsOf({ flows: IRREGULAR }).flows);
  });

  it('never writes to the input (a deeply frozen input validates)', () => {
    const flows = PERIODIC.map((item) => Object.freeze({ ...item }));
    const frozen = Object.freeze({ frequency: 'monthly', flows: Object.freeze(flows) });
    const before = JSON.stringify(frozen);
    expect(termsOf(frozen).hasPeriods).toBe(true);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('treats an undefined frequency or period as absent', () => {
    expect(termsOf({ frequency: undefined, flows: IRREGULAR }).frequency).toBeNull();
    const flows = IRREGULAR.map((item) => ({ ...item, period: undefined }));
    expect(termsOf({ flows }).hasPeriods).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// Phase 1
// ---------------------------------------------------------------------------------------

describe('validateCashFlowInput — input shape and frequency', () => {
  it.each([null, undefined, 1, 'flows', [], [IRREGULAR]])(
    'rejects a non-object input (%j) with one error on field null',
    (value) => {
      expect(validateCashFlowInput(value)).toEqual({
        ok: false,
        errors: [{ code: 'INPUT_INVALID', field: null }],
      });
    },
  );

  it.each(['fortnightly', 'semimonthly', 'daily', 12, null, true])(
    'rejects frequency %j',
    (frequency) => {
      expect(errorsOf({ frequency, flows: IRREGULAR })).toEqual(['INPUT_INVALID@frequency']);
    },
  );

  it.each(FREQUENCY_IDS)('accepts frequency %s', (frequency) => {
    expect(termsOf({ frequency, flows: IRREGULAR }).frequency).toBe(frequency);
  });

  it.each([undefined, null, {}, 'x', [], [flow('2026-01-15', '1')]])(
    'rejects flows %j without checking items',
    (flows) => {
      expect(errorsOf({ flows })).toEqual(['INPUT_INVALID@flows']);
    },
  );

  it('reports an invalid frequency together with invalid flows', () => {
    expect(errorsOf({ frequency: 'x', flows: [{ date: 1 }] })).toEqual([
      'INPUT_INVALID@flows',
      'INPUT_INVALID@frequency',
    ]);
  });
});

describe('validateCashFlowInput — items', () => {
  it('rejects items that are not plain objects, holes included', () => {
    // eslint-disable-next-line no-sparse-arrays -- a hole is an item too
    const flows = [flow('2026-01-15', '1000'), null, 5, 'x', [], , flow('2026-04-15', '-340')];
    expect(errorsOf({ flows })).toEqual(
      [
        'INPUT_INVALID@flows[1]',
        'INPUT_INVALID@flows[2]',
        'INPUT_INVALID@flows[3]',
        'INPUT_INVALID@flows[4]',
        'INPUT_INVALID@flows[5]',
      ].sort(),
    );
  });

  it.each([undefined, 20260215, null, { y: 2026 }])('rejects date %j as INPUT_INVALID', (date) => {
    expect(errorsOf({ flows: patch(IRREGULAR, 1, { date }) })).toEqual([
      'INPUT_INVALID@flows[1].date',
    ]);
  });

  it.each(['2026-02-30', '2026-13-01', '0000-01-01', '2026-2-10', ''])(
    'rejects date %j as DATE_INVALID',
    (date) => {
      expect(errorsOf({ flows: patch(IRREGULAR, 1, { date }) })).toEqual([
        'DATE_INVALID@flows[1].date',
      ]);
    },
  );

  it('rejects a date earlier than the previous one', () => {
    expect(errorsOf({ flows: patch(IRREGULAR, 2, { date: '2026-02-09' }) })).toEqual([
      'INPUT_INVALID@flows[2].date',
    ]);
  });

  it('compares each date with the previous item only, when that date exists', () => {
    // Previous date invalid or item not an object: no comparison.
    expect(
      errorsOf({
        flows: [
          flow('2026-03-01', '1'),
          flow('2026-02-30', '-1'),
          flow('2026-01-01', '-1'),
          null,
          flow('2025-01-01', '-1'),
        ],
      }),
    ).toEqual(['DATE_INVALID@flows[1].date', 'INPUT_INVALID@flows[3]']);
    // An out-of-order date still exists: the next item is compared with it.
    expect(
      errorsOf({
        flows: [flow('2026-03-01', '1'), flow('2026-02-01', '-1'), flow('2026-02-15', '-1')],
      }),
    ).toEqual(['INPUT_INVALID@flows[1].date']);
    expect(
      errorsOf({
        flows: [flow('2026-03-01', '1'), flow('2026-02-01', '-1'), flow('2026-01-15', '-1')],
      }),
    ).toEqual(['INPUT_INVALID@flows[1].date', 'INPUT_INVALID@flows[2].date']);
  });

  it.each([undefined, -340, '1,000', '-3e2', '+5', '01', '', null])(
    'rejects amount %j as INPUT_INVALID',
    (amount) => {
      expect(errorsOf({ flows: patch(IRREGULAR, 3, { amount }) })).toEqual([
        'INPUT_INVALID@flows[3].amount',
      ]);
    },
  );

  it.each([
    '1000000000000000.01',
    '-1000000000000000.01',
    '-1000000000000001',
    '10000000000000000',
  ])('rejects amount %s as AMOUNT_RANGE', (amount) => {
    expect(errorsOf({ flows: patch(IRREGULAR, 3, { amount }) })).toEqual([
      'AMOUNT_RANGE@flows[3].amount',
    ]);
  });

  it('reports date and amount of one item separately', () => {
    expect(errorsOf({ flows: patch(IRREGULAR, 2, { date: '2026-02-31', amount: 'x' }) })).toEqual([
      'DATE_INVALID@flows[2].date',
      'INPUT_INVALID@flows[2].amount',
    ]);
  });
});

describe('validateCashFlowInput — periods', () => {
  const monthly = (flows: unknown[]): unknown => ({ frequency: 'monthly', flows });

  it('rejects periods on some items but not others, as flows[0] decides', () => {
    expect(errorsOf(monthly(patch(PERIODIC, 2, { period: undefined })))).toEqual([
      'INPUT_INVALID@flows[2].period',
    ]);
    expect(errorsOf({ frequency: 'monthly', flows: patch(IRREGULAR, 2, { period: 2 }) })).toEqual([
      'INPUT_INVALID@flows[2].period',
    ]);
    // flows[0] without a period: every item with one is reported.
    const flows = [flow('2026-01-15', '1000'), ...PERIODIC.slice(1)];
    expect(errorsOf(monthly(flows))).toEqual([
      'INPUT_INVALID@flows[1].period',
      'INPUT_INVALID@flows[2].period',
      'INPUT_INVALID@flows[3].period',
    ]);
  });

  it('checks period values only when every object item has one', () => {
    const flows = patch(patch(PERIODIC, 1, { period: undefined }), 2, { period: -1 });
    expect(errorsOf(monthly(flows))).toEqual(['INPUT_INVALID@flows[1].period']);
  });

  it('treats an item that is not an object as one without a period', () => {
    // flows[0] decides: not an object, so it has no period.
    expect(errorsOf(monthly(replace(PERIODIC, 0, 'x')))).toEqual([
      'INPUT_INVALID@flows[0]',
      'INPUT_INVALID@flows[1].period',
      'INPUT_INVALID@flows[2].period',
      'INPUT_INVALID@flows[3].period',
    ]);
    // A later non-object item does not stop the period checks of the others.
    expect(errorsOf(monthly(patch(replace(PERIODIC, 1, null), 3, { period: 1.5 })))).toEqual([
      'INPUT_INVALID@flows[1]',
      'INPUT_INVALID@flows[3].period',
    ]);
  });

  it.each([-1, 1.5, '1', null, true, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects period %j',
    (period) => {
      expect(errorsOf(monthly(patch(PERIODIC, 2, { period })))).toEqual([
        'INPUT_INVALID@flows[2].period',
      ]);
    },
  );

  it('requires the first period to be 0', () => {
    expect(errorsOf(monthly(patch(PERIODIC, 0, { period: 1 })))).toEqual([
      'INPUT_INVALID@flows[0].period',
    ]);
    expect(errorsOf(monthly(patch(PERIODIC, 0, { period: -1 })))).toEqual([
      'INPUT_INVALID@flows[0].period',
    ]);
  });

  it('rejects a period smaller than the previous valid period', () => {
    expect(errorsOf(monthly(patch(PERIODIC, 3, { period: 1 })))).toEqual([
      'INPUT_INVALID@flows[3].period',
    ]);
    // A previous invalid period is not compared.
    expect(errorsOf(monthly(patch(patch(PERIODIC, 1, { period: 'x' }), 2, { period: 0 })))).toEqual(
      ['INPUT_INVALID@flows[1].period'],
    );
    // A previous item that is not an object is not compared either.
    expect(errorsOf(monthly(patch(replace(PERIODIC, 2, 7), 3, { period: 0 })))).toEqual([
      'INPUT_INVALID@flows[2]',
    ]);
  });

  it('accepts repeated periods, 2.0 and -0', () => {
    const terms = termsOf(
      monthly([
        flow('2026-01-15', '-50', -0),
        flow('2026-01-15', '1000', 0),
        flow('2026-02-15', '-500', 1.0),
        flow('2026-03-15', '-500', 2.0),
      ]),
    );
    expect(terms.flows.map((item) => item.period)).toEqual([0, 0, 1, 2]);
    expect(Object.is(terms.flows[0]?.period, 0)).toBe(true);
  });

  it('requires a frequency when periods are given', () => {
    expect(errorsOf({ flows: PERIODIC })).toEqual(['INPUT_INVALID@frequency']);
    // Given counts whether or not the periods are valid.
    expect(errorsOf({ flows: patch(PERIODIC, 1, { period: -1 }) })).toEqual([
      'INPUT_INVALID@flows[1].period',
      'INPUT_INVALID@frequency',
    ]);
    // An invalid frequency is reported once.
    expect(errorsOf({ frequency: 'x', flows: PERIODIC })).toEqual(['INPUT_INVALID@frequency']);
    // Not every item has one: only the mix is reported.
    expect(errorsOf({ flows: patch(PERIODIC, 3, { period: undefined }) })).toEqual([
      'INPUT_INVALID@flows[3].period',
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------------------

describe('validateCashFlowInput — phase 2', () => {
  it('rejects flows that all fall on one date, on the last date', () => {
    const flows = [
      flow('2026-01-15', '1000'),
      flow('2026-01-15', '-500'),
      flow('2026-01-15', '-300'),
      flow('2026-01-15', '-200'),
    ];
    expect(errorsOf({ flows })).toEqual(['INPUT_INVALID@flows[3].date']);
    expect(errorsOf({ frequency: 'monthly', flows: flows.slice(0, 2) })).toEqual([
      'INPUT_INVALID@flows[1].date',
    ]);
  });

  it('rejects a date that is not the schedule date of its period', () => {
    expect(
      errorsOf({ frequency: 'monthly', flows: patch(PERIODIC, 2, { date: '2026-03-16' }) }),
    ).toEqual(['INPUT_INVALID@flows[2].period']);
    expect(errorsOf({ frequency: 'quarterly', flows: PERIODIC })).toEqual([
      'INPUT_INVALID@flows[1].period',
      'INPUT_INVALID@flows[2].period',
      'INPUT_INVALID@flows[3].period',
    ]);
    // Periods may skip: the date must still match.
    const skip = [flow('2021-04-15', '100000', 0), flow('2023-04-15', '-110000', 2)];
    expect(termsOf({ frequency: 'annual', flows: skip }).hasPeriods).toBe(true);
    expect(
      errorsOf({ frequency: 'annual', flows: replace(skip, 1, flow('2023-04-15', '-1', 1)) }),
    ).toEqual(['INPUT_INVALID@flows[1].period']);
  });

  it('accepts schedule dates with or without the end-of-month rule (SPEC §9.7)', () => {
    const fromFeb28 = (date: string): unknown => ({
      frequency: 'monthly',
      flows: [flow('2026-02-28', '100', 0), flow(date, '-101', 1)],
    });
    expect(termsOf(fromFeb28('2026-03-28')).hasPeriods).toBe(true);
    expect(termsOf(fromFeb28('2026-03-31')).hasPeriods).toBe(true);
    expect(errorsOf(fromFeb28('2026-03-30'))).toEqual(['INPUT_INVALID@flows[1].period']);
    // A day-31 anchor clamps: 2026-01-31 + 1 month = 2026-02-28.
    expect(
      termsOf({
        frequency: 'monthly',
        flows: [
          flow('2026-01-31', '100', 0),
          flow('2026-02-28', '-50', 1),
          flow('2026-03-31', '-51', 2),
        ],
      }).flows,
    ).toHaveLength(3);
  });

  it('checks weekly and biweekly periods by days', () => {
    const flows = [
      flow('2026-01-01', '100', 0),
      flow('2026-01-08', '-50', 1),
      flow('2026-01-29', '-51', 4),
    ];
    expect(termsOf({ frequency: 'weekly', flows }).flows).toHaveLength(3);
    expect(errorsOf({ frequency: 'biweekly', flows })).toEqual([
      'INPUT_INVALID@flows[1].period',
      'INPUT_INVALID@flows[2].period',
    ]);
  });

  it('rejects huge periods without failing', () => {
    for (const period of [1e9, Number.MAX_SAFE_INTEGER, 1e300]) {
      for (const frequency of ['weekly', 'monthly'] as const) {
        expect(
          errorsOf({
            frequency,
            flows: [flow('2026-01-01', '1', 0), flow('9999-12-31', '-1', period)],
          }),
        ).toEqual(['INPUT_INVALID@flows[1].period']);
      }
    }
  });

  it('reports all phase-2 errors together', () => {
    expect(
      errorsOf({
        frequency: 'monthly',
        flows: [flow('2026-01-15', '100', 0), flow('2026-01-15', '-101', 1)],
      }),
    ).toEqual(['INPUT_INVALID@flows[1].date', 'INPUT_INVALID@flows[1].period']);
  });

  it('runs phase 2 only after a clean phase 1', () => {
    expect(
      errorsOf({
        frequency: 'monthly',
        flows: [flow('2026-01-15', '100', 0), flow('2026-01-15', 'x', 1)],
      }),
    ).toEqual(['INPUT_INVALID@flows[1].amount']);
  });
});

// ---------------------------------------------------------------------------------------
// Golden vectors (kind "cashflows")
// ---------------------------------------------------------------------------------------

interface CashFlowVector {
  readonly id: string;
  readonly kind: string;
  readonly input: { readonly frequency?: string; readonly flows: readonly Flow[] };
  readonly expected: {
    readonly ok: boolean;
    readonly errors?: readonly { readonly code: string; readonly field: string | null }[];
  };
}

function isCashFlowVector(value: unknown): value is CashFlowVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'cashflows' &&
    'id' in value &&
    'input' in value &&
    'expected' in value
  );
}

const CASH_FLOW_VECTORS: readonly CashFlowVector[] = Object.values(
  import.meta.glob<unknown>('../../tests/vectors/core/*.json', { eager: true, import: 'default' }),
)
  .filter(isCashFlowVector)
  .sort((a, b) => a.id.localeCompare(b.id));

describe('validateCashFlowInput — golden vectors', () => {
  it('finds the cash-flow vectors', () => {
    expect(CASH_FLOW_VECTORS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(CASH_FLOW_VECTORS.map((vector) => [vector.id, vector] as const))('%s', (_id, vector) => {
    const { errors } = vector.expected;
    if (errors !== undefined) {
      expect(errorsOf(vector.input)).toEqual(
        errors.map((error) => `${error.code}@${String(error.field)}`).sort(),
      );
      return;
    }
    const terms = termsOf(vector.input);
    const flows = vector.input.flows;
    expect(terms.frequency).toBe(vector.input.frequency ?? null);
    expect(terms.hasPeriods).toBe(flows.every((item) => 'period' in item));
    expect(terms.flows.map((item) => formatIsoDate(item.date))).toEqual(
      flows.map((item) => item.date),
    );
    expect(terms.flows.map((item) => item.amount)).toEqual(
      flows.map((item) => parseDecimal(String(item.amount))),
    );
  });
});

// ---------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------

/** Random valid flows: sorted dates over at least two days, amounts within ±1e15. */
const validFlows = fc
  .record({
    start: fc.integer({ min: 0, max: 2_000_000 }),
    offsets: fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 30 }),
    amounts: fc.array(fc.bigInt({ min: -(10n ** 17n), max: 10n ** 17n }), {
      minLength: 31,
      maxLength: 31,
    }),
  })
  .filter((sample) => sample.offsets.some((offset) => offset > 0));

function toFlows(sample: { start: number; offsets: number[]; amounts: bigint[] }): Flow[] {
  // Day 0 = 0001-01-01 + start days; every date stays far below 9999-12-31.
  const first = addDays({ y: 1, m: 1, d: 1 }, sample.start);
  let day = 0;
  const days = [0, ...sample.offsets.map((offset) => (day += offset))];
  return days.map((offset, index) => {
    const amount = sample.amounts[index] ?? 0n;
    const sign = amount < 0n ? '-' : '';
    const magnitude = (amount < 0n ? -amount : amount).toString().padStart(3, '0');
    return flow(
      formatIsoDate(addDays(first, offset)),
      `${sign}${magnitude.slice(0, -2).replace(/^0+(?=\d)/, '')}.${magnitude.slice(-2)}`,
    );
  });
}

describe('validateCashFlowInput — properties', () => {
  it('accepts random valid flows and keeps them exactly', () => {
    fc.assert(
      fc.property(
        validFlows,
        fc.option(fc.constantFrom(...FREQUENCY_IDS), { nil: undefined }),
        (sample, frequency) => {
          const flows = toFlows(sample);
          const terms = termsOf(frequency === undefined ? { flows } : { frequency, flows });
          expect(terms.hasPeriods).toBe(false);
          expect(terms.frequency).toBe(frequency ?? null);
          expect(terms.flows.map((item) => formatIsoDate(item.date))).toEqual(
            flows.map((item) => item.date),
          );
          expect(terms.flows.map((item) => item.amount)).toEqual(
            flows.map((item) => parseDecimal(String(item.amount))),
          );
        },
      ),
    );
  });

  it('accepts the schedule dates of any frequency, with either end-of-month setting', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FREQUENCY_IDS),
        fc.integer({ min: 0, max: 3_000_000 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 20 }),
        fc.boolean(),
        (frequency: FrequencyId, start, steps, endOfMonth) => {
          const anchor = addDays({ y: 1, m: 1, d: 1 }, start);
          let period = 0;
          const periods = [0, ...steps.map((step) => (period += step + 1))];
          const flows = periods.map((k, index) =>
            flow(
              formatIsoDate(scheduleDate(anchor, k, frequency, endOfMonth)),
              index === 0 ? '100' : '-1',
              k,
            ),
          );
          const terms = termsOf({ frequency, flows });
          expect(terms.hasPeriods).toBe(true);
          expect(terms.flows.map((item) => item.period)).toEqual(periods);
        },
      ),
    );
  });

  it('never throws, and reports at most one error per field', () => {
    const value = fc.oneof(fc.jsonValue(), fc.constant(undefined));
    const date = fc.oneof(
      value,
      fc.constantFrom('2026-01-15', '2026-02-15', '2026-02-30', '2025-12-31'),
    );
    const item = fc.oneof(
      value,
      fc.record(
        {
          date,
          amount: fc.oneof(value, fc.constantFrom('100', '-50', '1e2', '2000000000000000')),
          period: fc.oneof(value, fc.integer({ min: -1, max: 3 })),
        },
        { requiredKeys: [] },
      ),
    );
    const arbitraryInput = fc.oneof(
      fc.anything(),
      fc.record(
        {
          frequency: fc.oneof(value, fc.constantFrom(...FREQUENCY_IDS)),
          flows: fc.oneof(value, fc.array(item, { maxLength: 6 })),
        },
        { requiredKeys: [] },
      ),
    );
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const result = validateCashFlowInput(input);
        if (!result.ok) {
          expect(result.errors.length).toBeGreaterThan(0);
          const fields = result.errors.map((error) => error.field);
          expect(new Set(fields).size).toBe(fields.length);
          for (const error of result.errors) {
            expect(['INPUT_INVALID', 'DATE_INVALID', 'AMOUNT_RANGE']).toContain(error.code);
          }
        } else {
          expect(result.terms.flows.length).toBeGreaterThanOrEqual(2);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(validFlows, (sample) => {
        const flows = toFlows(sample);
        expect(validateCashFlowInput({ flows })).toEqual(validateCashFlowInput({ flows }));
      }),
    );
  });

  it('parses every generated date back to the same day', () => {
    // Guards the generator above: formatIsoDate/parseIsoDate round-trip in its range.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3_000_000 }), (start) => {
        const date = addDays({ y: 1, m: 1, d: 1 }, start);
        expect(parseIsoDate(formatIsoDate(date))).toEqual(date);
      }),
    );
  });
});
