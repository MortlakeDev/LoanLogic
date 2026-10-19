// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { type LocalDate, parseIsoDate } from '../date';
import { isFrequencyId } from '../frequency';
import { type Rational, add, div, fromInteger, neg, parseDecimal } from '../rational';
import {
  type Accrual,
  type CashFlow,
  type CompoundingId,
  type DayCountId,
  type RateFailure,
  type RateMethodId,
  type RateMetric,
  RATE_METHOD_IDS,
} from '../types';
import { type ContractRate, type RateRequest, computeRates } from './index';

interface ExpectedRate {
  readonly value?: string;
  readonly display?: string;
  readonly precision?: number;
  readonly warnings?: readonly string[];
  readonly ok?: false;
  readonly reason?: string;
}

interface LoanVector {
  readonly id: string;
  readonly kind: 'loan';
  readonly input: {
    readonly annualRatePct: string;
    readonly frequency: string;
    readonly disbursementDate: string;
    readonly accrual?: {
      readonly mode: string;
      readonly compounding?: string;
      readonly method?: string;
      readonly paymentBasis?: string;
    };
    readonly fees?: readonly { readonly kind: string; readonly inApr?: boolean }[];
    readonly rateMethods?: readonly string[];
  };
  readonly expected: {
    readonly ok: true;
    readonly summary: { readonly amountFinancedForRates: string };
    readonly rows: readonly {
      readonly index: number;
      readonly date: string;
      readonly interestPaid: string;
      readonly principal: string;
      readonly fees: string;
      readonly insurance: string;
    }[];
    readonly rates: Readonly<Record<string, ExpectedRate>>;
  };
}

const FILES = import.meta.glob<unknown>('../../../tests/vectors/core/*.json', {
  eager: true,
  import: 'default',
});

function isLoanVector(value: unknown): value is LoanVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'loan' &&
    'expected' in value &&
    typeof value.expected === 'object' &&
    value.expected !== null &&
    'ok' in value.expected &&
    value.expected.ok === true
  );
}

const LOAN_VECTORS: readonly LoanVector[] = Object.values(FILES)
  .filter(isLoanVector)
  .sort((a, b) => a.id.localeCompare(b.id));

function date(text: string): LocalDate {
  const parsed = parseIsoDate(text);
  if (parsed === undefined) {
    throw new Error(`bad date ${text}`);
  }
  return parsed;
}

const HUNDRED = fromInteger(100);

function contractOf(vector: LoanVector): ContractRate {
  const { input } = vector;
  if (!isFrequencyId(input.frequency)) {
    throw new Error(`bad frequency ${input.frequency}`);
  }
  const accrual: Accrual =
    input.accrual?.mode === 'daycount'
      ? {
          mode: 'daycount',
          method: input.accrual.method as DayCountId,
          paymentBasis: input.accrual.paymentBasis === 'exact' ? 'exact' : 'nominal',
        }
      : {
          mode: 'periodic',
          compounding: (input.accrual?.compounding ?? input.frequency) as CompoundingId,
        };
  return {
    annualRatePct: input.annualRatePct,
    rate: div(parseDecimal(input.annualRatePct), HUNDRED),
    frequency: input.frequency,
    accrual,
  };
}

/** Whether every item of a kind is (or is not) in the APR; `null` when mixed. */
function inAprForKind(vector: LoanVector, kind: string): boolean | null {
  const flags = (vector.input.fees ?? [])
    .filter((fee) => fee.kind === kind)
    .map((fee) => fee.inApr ?? true);
  if (flags.every((flag) => flag)) {
    return true;
  }
  return flags.every((flag) => !flag) ? false : null;
}

/**
 * The §9.1 cash flows of a loan vector, rebuilt from its expected summary and rows: the
 * amount financed at D0, then interest + principal + the periodic items in the APR.
 */
function flowsOf(vector: LoanVector): CashFlow[] | null {
  const fees = inAprForKind(vector, 'periodic');
  const insurance = inAprForKind(vector, 'insurance');
  if (fees === null || insurance === null) {
    return null;
  }
  const start = date(vector.input.disbursementDate);
  return [
    {
      date: start,
      amount: parseDecimal(vector.expected.summary.amountFinancedForRates),
      period: 0,
    },
    ...vector.expected.rows.map((row) => {
      let outflow: Rational = add(parseDecimal(row.interestPaid), parseDecimal(row.principal));
      if (fees) {
        outflow = add(outflow, parseDecimal(row.fees));
      }
      if (insurance) {
        outflow = add(outflow, parseDecimal(row.insurance));
      }
      return { date: date(row.date), amount: neg(outflow), period: row.index };
    }),
  ];
}

function isFailure(rate: RateMetric | RateFailure): rate is RateFailure {
  return 'ok' in rate;
}

function expectRate(actual: RateMetric | RateFailure | undefined, expected: ExpectedRate): void {
  expect(actual).toBeDefined();
  if (actual === undefined) {
    return;
  }
  if (expected.ok === false) {
    expect(actual).toEqual({ ok: false, reason: expected.reason });
    return;
  }
  expect(isFailure(actual)).toBe(false);
  if (isFailure(actual)) {
    return;
  }
  const value = Number(expected.value);
  expect(Math.abs(actual.value - value)).toBeLessThanOrEqual(
    Math.max(1e-7, 1e-9 * Math.abs(value)),
  );
  expect(actual.display).toBe(expected.display);
  expect(actual.precision).toBe(expected.precision);
  expect([...(actual.warnings ?? [])].sort()).toEqual([...(expected.warnings ?? [])].sort());
}

describe('rates of the loan golden vectors, from their expected rows (SPEC §9, §14)', () => {
  it('covers the rate vectors', () => {
    expect(LOAN_VECTORS.length).toBeGreaterThanOrEqual(60);
  });

  for (const vector of LOAN_VECTORS) {
    it(vector.id, () => {
      const flows = flowsOf(vector);
      expect(flows).not.toBeNull();
      if (flows === null) {
        return;
      }
      const contract = contractOf(vector);
      const methods = (vector.input.rateMethods ?? RATE_METHOD_IDS) as readonly RateMethodId[];
      const outcome = computeRates({
        flows,
        frequency: contract.frequency,
        hasPeriods: true,
        methods,
        contract,
      });
      expect(Object.keys(outcome.rates)).toEqual(Object.keys(vector.expected.rates));
      for (const [method, rate] of Object.entries(vector.expected.rates)) {
        expectRate(outcome.rates[method as RateMethodId], rate);
      }
      expect(outcome.warnings).toEqual([]);
    });
  }
});

const D0: LocalDate = { y: 2026, m: 1, d: 1 };

function annualFlows(amounts: readonly string[]): CashFlow[] {
  return amounts.map((amount, period) => ({
    date: { y: D0.y + period, m: 1, d: 1 },
    amount: parseDecimal(amount),
    period,
  }));
}

const CONTRACT: ContractRate = {
  annualRatePct: '6.5',
  rate: div(parseDecimal('6.5'), HUNDRED),
  frequency: 'annual',
  accrual: { mode: 'periodic', compounding: 'annual' },
};

function request(overrides: Partial<RateRequest>): RateRequest {
  return {
    flows: annualFlows(['100', '-110']),
    frequency: 'annual',
    hasPeriods: true,
    methods: RATE_METHOD_IDS,
    contract: CONTRACT,
    ...overrides,
  };
}

describe('computeRates', () => {
  it('returns exactly the requested methods in request order', () => {
    const outcome = computeRates(request({ methods: ['xirr', 'nominal', 'ukAprc'] }));
    expect(Object.keys(outcome.rates)).toEqual(['xirr', 'nominal', 'ukAprc']);
  });

  it('computes a duplicated method once', () => {
    const outcome = computeRates(request({ methods: ['xirr', 'xirr'] }));
    expect(Object.keys(outcome.rates)).toEqual(['xirr']);
  });

  it('returns nothing for no methods', () => {
    expect(computeRates(request({ methods: [] }))).toEqual({ rates: {}, warnings: [] });
  });

  it('reports IRR_MULTIPLE once, listing the methods in request order', () => {
    const outcome = computeRates(
      request({
        flows: annualFlows(['100', '-230', '132']),
        methods: ['nominal', 'ukAprc', 'irrNominal', 'xirr'],
      }),
    );
    expect(outcome.warnings).toEqual([
      { code: 'IRR_MULTIPLE', params: { methods: 'ukAprc,irrNominal,xirr' } },
    ]);
    const nominal = outcome.rates.nominal;
    expect(nominal !== undefined && !isFailure(nominal) && 'warnings' in nominal).toBe(false);
    const aprc = outcome.rates.ukAprc;
    expect(aprc !== undefined && !isFailure(aprc) && aprc.warnings).toEqual(['IRR_MULTIPLE']);
  });

  it('fails metrics without a root individually', () => {
    const outcome = computeRates(
      request({
        flows: annualFlows(['100', '10', '10']),
        methods: ['nominal', 'xirr', 'usRegZApr'],
      }),
    );
    expect(outcome.rates.xirr).toEqual({ ok: false, reason: 'IRR_NO_CONVERGENCE' });
    expect(outcome.rates.usRegZApr).toEqual({ ok: false, reason: 'IRR_NO_CONVERGENCE' });
    const nominal = outcome.rates.nominal;
    expect(nominal !== undefined && !isFailure(nominal) && nominal.display).toBe('6.50');
  });

  it('explains every metric with its formula id', () => {
    const outcome = computeRates(request({ flows: annualFlows(['100', '-50', '-60']) }));
    const formula = (method: RateMethodId): string | undefined => {
      const rate = outcome.rates[method];
      return rate !== undefined && !isFailure(rate) ? rate.explain.formulaId : undefined;
    };
    expect(formula('nominal')).toBe('rate.nominal');
    expect(formula('effective')).toBe('rate.effective');
    expect(formula('irrNominal')).toBe('rate.periodic-irr');
    expect(formula('irrEffective')).toBe('rate.periodic-irr');
    expect(formula('cnAnnualized')).toBe('rate.periodic-irr');
    expect(formula('usRegZApr')).toBe('rate.periodic-irr');
    expect(formula('xirr')).toBe('rate.annual-irr');
    expect(formula('ukAprc')).toBe('rate.annual-irr');
    expect(formula('euAprc')).toBe('rate.annual-irr');
    expect(formula('uaRealAnnual')).toBe('rate.annual-irr');
    expect(formula('international')).toBe('rate.annual-irr');
    const aprc = outcome.rates.ukAprc;
    expect(aprc !== undefined && !isFailure(aprc) && aprc.explain.values.timeBasis).toBe('periods');
    const xirr = outcome.rates.xirr;
    expect(xirr !== undefined && !isFailure(xirr) && xirr.explain.values.timeBasis).toBe(
      'days-365',
    );
  });

  it('uses the single-payment rule for usRegZApr with exactly two flows', () => {
    const outcome = computeRates(request({ methods: ['usRegZApr'] }));
    const apr = outcome.rates.usRegZApr;
    expect(apr !== undefined && !isFailure(apr) && apr.explain.formulaId).toBe(
      'rate.regz-single-payment',
    );
  });

  it('counts back from each date for the APRC without periods', () => {
    const flows: CashFlow[] = [
      { date: { y: 2026, m: 1, d: 31 }, amount: parseDecimal('100') },
      { date: { y: 2026, m: 3, d: 31 }, amount: parseDecimal('-101') },
    ];
    const outcome = computeRates(
      request({
        flows,
        frequency: 'monthly',
        hasPeriods: false,
        methods: ['ukAprc'],
        contract: null,
      }),
    );
    const aprc = outcome.rates.ukAprc;
    expect(aprc !== undefined && !isFailure(aprc) && aprc.explain.values.timeBasis).toBe(
      'counted-back',
    );
    // Exactly two months: (1.01)^6 − 1.
    expect(aprc !== undefined && !isFailure(aprc) && aprc.value).toBeCloseTo(
      (1.01 ** 6 - 1) * 100,
      9,
    );
  });

  it('rejects methods whose inputs are missing (programming errors)', () => {
    expect(() => computeRates(request({ contract: null, methods: ['nominal'] }))).toThrow(
      RangeError,
    );
    expect(() => computeRates(request({ contract: null, methods: ['effective'] }))).toThrow(
      RangeError,
    );
    expect(() => computeRates(request({ frequency: null, methods: ['irrNominal'] }))).toThrow(
      RangeError,
    );
    expect(() => computeRates(request({ frequency: null, methods: ['ukAprc'] }))).toThrow(
      RangeError,
    );
    expect(() => computeRates(request({ hasPeriods: false, methods: ['usRegZApr'] }))).toThrow(
      RangeError,
    );
    expect(() => computeRates(request({ hasPeriods: false, methods: ['cnAnnualized'] }))).toThrow(
      RangeError,
    );
  });

  it('is deterministic', () => {
    const input = request({ flows: annualFlows(['1000', '-300', '-400', '-500']) });
    expect(computeRates(input)).toEqual(computeRates(input));
  });
});
