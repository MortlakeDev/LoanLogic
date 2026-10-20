// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../date';
import { rational } from '../rational';
import type { Fee, LoanTerms } from '../types';
import { type Schedule, type ScheduleResult, buildSchedule } from './build';

const D0: LocalDate = { y: 2026, m: 1, d: 15 };

/** Validated terms: 100 000.00 USD at 6.5 %, 24 monthly annuity payments, defaults. */
function terms(overrides: Partial<LoanTerms> = {}): LoanTerms {
  return {
    currency: 'USD',
    minorUnits: 2,
    amount: 10_000_000n,
    annualRatePct: '6.5',
    rate: rational(13n, 200n),
    repayment: 'annuity',
    balloon: null,
    frequency: 'monthly',
    payments: 24,
    disbursementDate: D0,
    endOfMonth: true,
    accrual: { mode: 'periodic', compounding: 'monthly' },
    rounding: {
      interest: 'half-up',
      fees: 'half-up',
      payment: 'minor-half-up',
      principalRemainder: 'last',
    },
    fees: [],
    rateMethods: [],
    ...overrides,
  };
}

function schedule(result: ScheduleResult): Schedule {
  if (!result.ok) {
    throw new Error(`Unexpected error ${result.error.code}`);
  }
  return result.schedule;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

describe('buildSchedule: annuity (SPEC §5.2)', () => {
  it('reproduces SPEC E1', () => {
    const s = schedule(buildSchedule(terms()));
    expect(s.rows).toHaveLength(24);
    expect(s.regularInstalment).toBe(445_463n);
    expect(s.rows[0]).toMatchObject({
      index: 1,
      date: { y: 2026, m: 2, d: 15 },
      days: 31,
      opening: 10_000_000n,
      interest: 54_167n,
      principal: 391_296n,
      payment: 445_463n,
      closing: 9_608_704n,
    });
    expect(s.rows[23]?.payment).toBe(445_451n);
    expect(sum(s.rows.map((row) => row.payment))).toBe(10_691_100n);
    expect(sum(s.rows.map((row) => row.principal))).toBe(10_000_000n);
    expect(s.principalPerPeriod).toBeNull();
    expect(s.balloon).toBeNull();
    expect(s.earlyClose).toBe(false);
    expect(s.explain.formulaId).toBe('instalment.annuity');
    expect(s.explain.values).toMatchObject({
      P: '100000.00',
      N: '24',
      j: '0.065',
      m: '12',
      A: '4454.63',
    });
    expect(s.explain.values.Astar?.startsWith('4454.6251433')).toBe(true);
    expect(s.explain.values).not.toHaveProperty('i');
  });

  it('posts the E5 interest tie with the interest rounding mode', () => {
    const base = { amount: 270_000n, payments: 6 };
    const halfUp = schedule(buildSchedule(terms(base)));
    const halfEven = schedule(
      buildSchedule(terms({ ...base, rounding: { ...terms().rounding, interest: 'half-even' } })),
    );
    expect(halfUp.rows[0]?.interest).toBe(1_463n);
    expect(halfEven.rows[0]?.interest).toBe(1_462n);
  });

  it('keeps A* exact for N = 1 (SPEC E6) and pays the posted interest', () => {
    const s = schedule(
      buildSchedule(
        terms({
          amount: 150_000n,
          payments: 1,
          rounding: { ...terms().rounding, interest: 'half-even' },
        }),
      ),
    );
    expect(s.regularInstalment).toBe(150_813n);
    expect(s.explain.values.Astar).toBe('1508.125');
    expect(s.rows).toEqual([
      {
        index: 1,
        date: { y: 2026, m: 2, d: 15 },
        days: 31,
        opening: 150_000n,
        interest: 812n,
        principal: 150_000n,
        itemAmounts: [],
        fees: 0n,
        insurance: 0n,
        payment: 150_812n,
        closing: 0n,
      },
    ]);
  });

  it('closes early when the rounded-up instalment repays the balance before N', () => {
    // 50.00 at 12 % over 360 months with the instalment rounded up to whole dollars.
    const s = schedule(
      buildSchedule(
        terms({
          amount: 5_000n,
          rate: rational(3n, 25n),
          annualRatePct: '12',
          payments: 360,
          rounding: { ...terms().rounding, payment: 'unit-ceil' },
        }),
      ),
    );
    expect(s.regularInstalment).toBe(100n);
    expect(s.earlyClose).toBe(true);
    expect(s.rows.length).toBeLessThan(360);
    const last = s.rows[s.rows.length - 1];
    expect(last?.closing).toBe(0n);
    expect(last?.principal).toBeLessThanOrEqual(100n - (last?.interest ?? 0n));
    expect(sum(s.rows.map((row) => row.principal))).toBe(5_000n);
  });

  it('closes early exactly when the scheduled principal equals the balance', () => {
    // 1.00 at 0 % over 3 payments, rounded up to whole units: A = 1.00 repays all at once.
    const s = schedule(
      buildSchedule(
        terms({
          amount: 100n,
          rate: rational(0n),
          annualRatePct: '0',
          payments: 3,
          rounding: { ...terms().rounding, payment: 'unit-ceil' },
        }),
      ),
    );
    expect(s.earlyClose).toBe(true);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ principal: 100n, payment: 100n, closing: 0n });
  });

  it('rejects negative amortization with the period (SPEC §5.1)', () => {
    // ACT/360 interest at 30 % exceeds the instalment computed from j/12.
    const result = buildSchedule(
      terms({
        rate: rational(3n, 10n),
        annualRatePct: '30',
        payments: 360,
        accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'nominal' },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'NEG_AMORTIZATION', field: null, params: { period: '1' } },
    });
  });

  it('finds negative amortization in a later period and in a balloon loan', () => {
    const shortFirst = {
      rate: rational(3n, 10n),
      annualRatePct: '30',
      payments: 360,
      disbursementDate: { y: 2026, m: 2, d: 1 },
      accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'nominal' } as const,
    };
    // February's 28 days cost less than A = 2 500.xx; March's 31 days cost 2 58x.xx.
    expect(buildSchedule(terms(shortFirst))).toEqual({
      ok: false,
      error: { code: 'NEG_AMORTIZATION', field: null, params: { period: '2' } },
    });
    expect(
      buildSchedule(
        terms({
          ...shortFirst,
          repayment: 'balloon',
          balloon: { kind: 'percent', pct: rational(50n) },
        }),
      ),
    ).toEqual({
      ok: false,
      error: { code: 'NEG_AMORTIZATION', field: null, params: { period: '2' } },
    });
  });

  it('amortizes a negative rate (vector negative-rate-annuity)', () => {
    const s = schedule(
      buildSchedule(terms({ rate: rational(-1n, 200n), annualRatePct: '-0.5', payments: 120 })),
    );
    expect(s.regularInstalment).toBe(81_250n);
    expect(s.rows[0]).toMatchObject({ interest: -4_167n, principal: 85_417n, payment: 81_250n });
    expect(s.rows[119]?.payment).toBe(81_246n);
    expect(s.explain.values.j).toBe('-0.005');
  });
});

describe('buildSchedule: periodic rate and explanation (SPEC §3.2, §9.6)', () => {
  it('shows i when the compounding differs from the payment frequency', () => {
    const quarterly = schedule(
      buildSchedule(
        terms({
          amount: 18_000_000n,
          rate: rational(33n, 500n),
          annualRatePct: '6.6',
          frequency: 'quarterly',
          payments: 20,
          accrual: { mode: 'periodic', compounding: 'monthly' },
        }),
      ),
    );
    // i = 1.0055^3 − 1, rational and exact.
    expect(quarterly.explain.values).toMatchObject({ m: '4', i: '0.016590916375', A: '10649.39' });
    expect(quarterly.rows[0]?.interest).toBe(298_636n);

    const canada = schedule(
      buildSchedule(
        terms({
          amount: 50_000_000n,
          rate: rational(529n, 10_000n),
          annualRatePct: '5.29',
          payments: 300,
          disbursementDate: { y: 2026, m: 9, d: 1 },
          accrual: { mode: 'periodic', compounding: 'semiannual' },
        }),
      ),
    );
    expect(canada.regularInstalment).toBe(299_112n);
    expect(canada.rows[0]?.interest).toBe(218_026n);
    expect(canada.explain.values.i).toBe('0.0043605207040370690871');
  });

  it('accrues continuously compounded interest', () => {
    const s = schedule(
      buildSchedule(
        terms({
          rate: rational(2n, 25n),
          annualRatePct: '8',
          payments: 12,
          accrual: { mode: 'periodic', compounding: 'continuous' },
        }),
      ),
    );
    // i = e^(0.08/12) − 1 = 0.0066889…
    expect(s.explain.values.i?.startsWith('0.006688')).toBe(true);
    expect(s.rows[0]?.interest).toBe(66_889n);
  });

  it('rounds the instalment of a tiny irrational rate like its exact value', () => {
    // 960 000 000 000 000.00 over 1 200 months at 1.2e−26 %: A* = P / N + about 5e−13
    // minor units, so minor-ceil adds a cent with continuous compounding as with c = m.
    const tiny = {
      amount: 96_000_000_000_000_000n,
      rate: rational(12n, 10n ** 29n),
      annualRatePct: '0.000000000000000000000000012',
      payments: 1200,
      rounding: { ...terms().rounding, payment: 'minor-ceil' as const },
    };
    const periodic = schedule(buildSchedule(terms(tiny)));
    const continuous = schedule(
      buildSchedule(terms({ ...tiny, accrual: { mode: 'periodic', compounding: 'continuous' } })),
    );
    expect(periodic.regularInstalment).toBe(80_000_000_000_001n);
    expect(continuous.regularInstalment).toBe(80_000_000_000_001n);
  });

  it('posts zero interest at a zero rate whatever the compounding', () => {
    const s = schedule(
      buildSchedule(
        terms({
          amount: 1_200_000n,
          rate: rational(0n),
          annualRatePct: '0',
          payments: 12,
          accrual: { mode: 'periodic', compounding: 'semiannual' },
          rounding: { ...terms().rounding, interest: 'ceil' },
        }),
      ),
    );
    expect(s.rows.every((row) => row.interest === 0n && row.principal === 100_000n)).toBe(true);
    expect(s.explain.values).toMatchObject({ i: '0', Astar: '1000', A: '1000.00' });
  });
});

describe('buildSchedule: day-count mode (SPEC §3.3, §5.2)', () => {
  const daycount = terms({
    amount: 20_000_000n,
    rate: rational(549n, 10_000n),
    annualRatePct: '5.49',
    payments: 120,
    disbursementDate: { y: 2026, m: 3, d: 25 },
  });

  it('charges actual days with the instalment from j / m (nominal basis)', () => {
    const s = schedule(
      buildSchedule({
        ...daycount,
        accrual: { mode: 'daycount', method: 'act-365f', paymentBasis: 'nominal' },
      }),
    );
    // 200 000.00 × 0.0549 × 31/365 = 932.547… → 932.55.
    expect(s.rows[0]).toMatchObject({ days: 31, interest: 93_255n });
    expect(s.explain.values).not.toHaveProperty('i');
    expect(s.explain.values.m).toBe('12');
  });

  it('solves the actual-day recurrence with the exact basis', () => {
    const s = schedule(
      buildSchedule({
        ...daycount,
        accrual: { mode: 'daycount', method: 'act-365f', paymentBasis: 'exact' },
      }),
    );
    // Vector daycount-act365f-exact-basis.
    expect(s.regularInstalment).toBe(217_023n);
    expect(s.rows[119]?.payment).toBe(217_058n);
    // The exact basis has a rate per period, r_k = j × YF_k, so its explanation names the
    // day count instead of m and i (SPEC v0.2.2 §9.6).
    expect(s.explain.formulaId).toBe('instalment.annuity-exact-basis');
    expect(s.explain.values).toMatchObject({
      P: '200000.00',
      N: '120',
      j: '0.0549',
      dayCount: 'act-365f',
      A: '2170.23',
    });
    expect(s.explain.values.Astar?.startsWith('2170.2')).toBe(true);
    expect(Object.keys(s.explain.values).sort()).toEqual(['A', 'Astar', 'N', 'P', 'dayCount', 'j']);
  });

  it('applies the 30/360 US February rules on an end-of-month schedule', () => {
    const s = schedule(
      buildSchedule(
        terms({
          disbursementDate: { y: 2026, m: 1, d: 31 },
          endOfMonth: false,
          payments: 13,
          accrual: { mode: 'daycount', method: '30u-360', paymentBasis: 'nominal' },
        }),
      ),
    );
    // Every period counts 30 days under the rules, so every interest is B × j / 12.
    const second = s.rows[1];
    expect(second?.date).toEqual({ y: 2026, m: 3, d: 31 });
    expect(second?.days).toBe(31);
    const opening = second?.opening ?? 0n;
    expect(second?.interest).toBe((opening * 13n * 30n + (200n * 360n) / 2n) / (200n * 360n));
  });

  it('charges a bullet loan day-count interest every period', () => {
    const s = schedule(
      buildSchedule(
        terms({
          repayment: 'bullet',
          frequency: 'quarterly',
          payments: 4,
          accrual: { mode: 'daycount', method: 'act-360', paymentBasis: 'nominal' },
        }),
      ),
    );
    // 100 000.00 × 0.065 × 90/360 = 1 625.00 for 15 Jan → 15 Apr.
    expect(s.rows[0]).toMatchObject({ days: 90, interest: 162_500n, principal: 0n });
    expect(s.explain).toEqual({
      formulaId: 'instalment.bullet',
      values: { P: '100000.00', N: '4', I1: '1625.00' },
    });
  });
});

describe('buildSchedule: equal principal (SPEC §5.3)', () => {
  const ep = terms({
    repayment: 'equal-principal',
    rate: rational(1n, 10n),
    annualRatePct: '10',
    payments: 7,
  });

  it('reproduces SPEC E2 with the remainder last', () => {
    const s = schedule(buildSchedule(ep));
    expect(s.principalPerPeriod).toBe(1_428_571n);
    expect(s.rows.slice(0, 6).every((row) => row.principal === 1_428_571n)).toBe(true);
    expect(s.rows[6]?.principal).toBe(1_428_574n);
    expect(sum(s.rows.map((row) => row.interest))).toBe(333_334n);
    expect(s.regularInstalment).toBeNull();
    expect(s.explain).toEqual({
      formulaId: 'instalment.equal-principal',
      values: { P: '100000.00', N: '7', q: '14285.71' },
    });
  });

  it('puts the remainder first when asked', () => {
    const s = schedule(
      buildSchedule({ ...ep, rounding: { ...ep.rounding, principalRemainder: 'first' } }),
    );
    expect(s.rows[0]?.principal).toBe(1_428_574n);
    expect(s.rows.slice(1).every((row) => row.principal === 1_428_571n)).toBe(true);
  });

  it('closes early when q rounds up on a very small amount', () => {
    // 0.11 over 7: q = R(1.571…) = 0.02; the balance is gone after 6 payments.
    const s = schedule(buildSchedule({ ...ep, amount: 11n }));
    expect(s.principalPerPeriod).toBe(2n);
    expect(s.earlyClose).toBe(true);
    expect(s.rows.map((row) => row.principal)).toEqual([2n, 2n, 2n, 2n, 2n, 1n]);
  });

  it('closes at once when q is 0 and the remainder comes first', () => {
    const s = schedule(
      buildSchedule({
        ...ep,
        amount: 1n,
        payments: 3,
        rounding: { ...ep.rounding, principalRemainder: 'first' },
      }),
    );
    expect(s.principalPerPeriod).toBe(0n);
    expect(s.earlyClose).toBe(true);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]?.principal).toBe(1n);
  });

  it('allows negative payments with a negative rate', () => {
    const s = schedule(
      buildSchedule({
        ...ep,
        amount: 100n,
        rate: rational(-1n, 5n),
        annualRatePct: '-20',
        payments: 120,
      }),
    );
    expect(s.rows.some((row) => row.payment < 0n)).toBe(true);
    expect(s.rows[s.rows.length - 1]?.closing).toBe(0n);
  });
});

describe('buildSchedule: bullet (SPEC §5.4)', () => {
  it('pays interest only, then the principal', () => {
    const s = schedule(
      buildSchedule(
        terms({
          repayment: 'bullet',
          amount: 20_000_000n,
          rate: rational(2n, 25n),
          annualRatePct: '8',
          payments: 12,
        }),
      ),
    );
    expect(
      s.rows.slice(0, 11).every((row) => row.principal === 0n && row.payment === 133_333n),
    ).toBe(true);
    expect(s.rows[11]).toMatchObject({ principal: 20_000_000n, payment: 20_133_333n, closing: 0n });
    expect(s.explain.values).toEqual({ P: '200000.00', N: '12', I1: '1333.33' });
  });

  it('allows a negative payment with a negative rate', () => {
    const s = schedule(
      buildSchedule(
        terms({ repayment: 'bullet', rate: rational(-1n, 20n), annualRatePct: '-5', payments: 3 }),
      ),
    );
    expect(s.rows[0]?.payment).toBe(-41_667n);
    expect(s.earlyClose).toBe(false);
  });
});

describe('buildSchedule: balloon (SPEC §5.5)', () => {
  const balloon = terms({
    repayment: 'balloon',
    balloon: { kind: 'percent', pct: rational(30n) },
    amount: 3_000_000n,
    rate: rational(699n, 10_000n),
    annualRatePct: '6.99',
    payments: 48,
    disbursementDate: { y: 2026, m: 5, d: 12 },
  });

  it('leaves the balloon in the last payment (vector balloon-percent-auto-loan)', () => {
    const s = schedule(buildSchedule(balloon));
    expect(s.regularInstalment).toBe(55_520n);
    expect(s.balloon).toBe(899_992n);
    expect(s.rows[47]).toMatchObject({ principal: 949_978n, interest: 5_534n, payment: 955_512n });
    expect(s.explain.formulaId).toBe('instalment.balloon');
    expect(s.explain.values).toMatchObject({ A: '555.20', Bal: '9000.00', N: '48' });
  });

  it('pays no balloon after an early close (vector balloon-unit-ceil-early-close)', () => {
    const s = schedule(
      buildSchedule(
        terms({
          repayment: 'balloon',
          balloon: { kind: 'amount', amount: 100n },
          amount: 1_000n,
          rate: rational(1n, 100n),
          annualRatePct: '1',
          payments: 12,
          rounding: { ...terms().rounding, payment: 'unit-ceil' },
        }),
      ),
    );
    expect(s.earlyClose).toBe(true);
    expect(s.rows).toHaveLength(11);
    expect(s.rows[10]).toMatchObject({ principal: 5n, payment: 5n });
    expect(s.balloon).toBe(0n);
  });

  it('uses the nominal basis in day-count mode', () => {
    const s = schedule(
      buildSchedule({
        ...balloon,
        accrual: { mode: 'daycount', method: 'act-365f', paymentBasis: 'nominal' },
      }),
    );
    expect(s.regularInstalment).toBe(55_520n);
    expect(s.explain.values).not.toHaveProperty('i');
  });

  it('reports the phase-2 conditions instead of computing another schedule', () => {
    expect(
      buildSchedule({
        ...balloon,
        accrual: { mode: 'daycount', method: 'act-365f', paymentBasis: 'exact' },
      }),
    ).toEqual({ ok: false, error: { code: 'UNSUPPORTED', field: 'accrual.paymentBasis' } });
    expect(buildSchedule({ ...balloon, balloon: { kind: 'amount', amount: 3_000_000n } })).toEqual({
      ok: false,
      error: { code: 'BALLOON_RANGE', field: 'balloon.value' },
    });
    expect(buildSchedule({ ...balloon, balloon: { kind: 'percent', pct: rational(0n) } })).toEqual({
      ok: false,
      error: { code: 'BALLOON_RANGE', field: 'balloon.value' },
    });
  });

  it('throws on balloon terms without a balloon', () => {
    expect(() => buildSchedule({ ...balloon, balloon: null })).toThrow(RangeError);
  });
});

describe('buildSchedule: fees and insurance (SPEC §6)', () => {
  const fees: Fee[] = [
    {
      id: 'origination',
      kind: 'upfront',
      value: { calc: 'fixed', amount: 49_500n },
      financing: 'paid',
      inApr: true,
    },
    {
      id: 'gap',
      kind: 'upfront',
      value: { calc: 'fixed', amount: 75_000n },
      financing: 'financed',
      inApr: false,
    },
    {
      id: 'service',
      kind: 'periodic',
      value: { calc: 'fixed', amount: 995n },
      financing: 'paid',
      inApr: true,
    },
    {
      id: 'credit-life',
      kind: 'insurance',
      value: { calc: 'pct-balance', pct: rational(1n, 20n) },
      financing: 'paid',
      inApr: false,
    },
    {
      id: 'gps',
      kind: 'periodic',
      value: { calc: 'pct-original', pct: rational(1n, 20n) },
      financing: 'paid',
      inApr: true,
    },
  ];

  it('finances upfront items and charges periodic items on the right base', () => {
    const s = schedule(
      buildSchedule(
        terms({
          amount: 2_500_000n,
          rate: rational(849n, 10_000n),
          annualRatePct: '8.49',
          payments: 60,
          disbursementDate: { y: 2026, m: 3, d: 10 },
          fees,
        }),
      ),
    );
    expect(s.principalFinanced).toBe(2_575_000n);
    expect(s.upfront).toMatchObject({ paid: 49_500n, financed: 75_000n });
    const first = s.rows[0];
    // Insurance 0.05 % of the opening balance 25 750.00; gps 0.05 % of the amount 25 000.00.
    expect(first?.itemAmounts).toEqual([0n, 0n, 995n, 1_288n, 1_250n]);
    expect(first?.fees).toBe(2_245n);
    expect(first?.insurance).toBe(1_288n);
    expect(first?.payment).toBe(
      (first?.interest ?? 0n) + (first?.principal ?? 0n) + 2_245n + 1_288n,
    );
    const second = s.rows[1];
    expect(second?.itemAmounts[3]).toBe(((second?.opening ?? 0n) * 5n + 5_000n) / 10_000n);
  });

  it('rounds percentage fees with the fee rounding mode', () => {
    const tie: Fee = {
      id: 'tie',
      kind: 'periodic',
      value: { calc: 'pct-original', pct: rational(1n, 8n) },
      financing: 'paid',
      inApr: true,
    };
    // 1.00 × 0.125 % = 0.00125 → 0.00 either way; 10.00 × 0.125 % = 0.0125 → half-up 0.01.
    const halfUp = schedule(buildSchedule(terms({ amount: 1_000n, payments: 2, fees: [tie] })));
    const ceil = schedule(
      buildSchedule(
        terms({
          amount: 1_000n,
          payments: 2,
          fees: [tie],
          rounding: { ...terms().rounding, fees: 'ceil' },
        }),
      ),
    );
    expect(halfUp.rows[0]?.fees).toBe(1n);
    expect(ceil.rows[0]?.fees).toBe(2n);
  });
});

describe('buildSchedule: input guards and determinism', () => {
  it('rejects a remainder-first amount too small for the term', () => {
    expect(
      buildSchedule(
        terms({
          repayment: 'equal-principal',
          amount: 36_180n,
          payments: 360,
          rounding: { ...terms().rounding, principalRemainder: 'first' },
        }),
      ),
    ).toEqual({ ok: false, error: { code: 'AMOUNT_TOO_SMALL_FOR_TERM', field: 'amount' } });
  });

  it('throws on a term without payments', () => {
    expect(() => buildSchedule(terms({ payments: 0 }))).toThrow(RangeError);
    expect(() => buildSchedule(terms({ payments: 1.5 }))).toThrow(RangeError);
  });

  it('gives the same schedule for the same terms', () => {
    const input = terms({ accrual: { mode: 'periodic', compounding: 'continuous' } });
    expect(buildSchedule(input)).toEqual(buildSchedule(input));
  });
});
