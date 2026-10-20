// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  amountFinancedForRates,
  periodicFeeAmount,
  principalFinanced,
  upfrontFeeAmount,
  upfrontTotals,
} from './fees';
import { toMinorUnits } from './money';
import { divRound, parseDecimal } from './rational';
import type { Fee, RoundingMode } from './types';

const MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];

function cents(text: string): bigint {
  const value = toMinorUnits(text, 2);
  if (value === undefined) {
    throw new Error(`Bad test amount ${text}`);
  }
  return value;
}

interface FeeOptions {
  readonly financing?: 'paid' | 'financed';
  readonly inApr?: boolean;
}

function fixed(id: string, kind: Fee['kind'], amount: string, options: FeeOptions = {}): Fee {
  return {
    id,
    kind,
    value: { calc: 'fixed', amount: cents(amount) },
    financing: options.financing ?? 'paid',
    inApr: options.inApr ?? true,
  };
}

function percent(
  id: string,
  kind: Fee['kind'],
  calc: 'percent' | 'pct-original' | 'pct-balance',
  pct: string,
  options: FeeOptions = {},
): Fee {
  return {
    id,
    kind,
    value: { calc, pct: parseDecimal(pct) },
    financing: options.financing ?? 'paid',
    inApr: options.inApr ?? true,
  };
}

describe('upfrontFeeAmount (SPEC §6.1)', () => {
  it('uses a fixed amount as entered, whatever the rounding mode', () => {
    const fee = fixed('origination', 'upfront', '495.00');
    for (const mode of MODES) {
      expect(upfrontFeeAmount(fee, cents('25000.00'), mode)).toBe(49500n);
    }
  });

  it('takes a percentage of the requested amount with the fee rounding mode', () => {
    // zero-rate-with-fee: 3 % of 1 200.00; ua-consumer-loan: 1.99 % of 30 000.00.
    expect(
      upfrontFeeAmount(percent('plan', 'upfront', 'percent', '3'), cents('1200.00'), 'half-up'),
    ).toBe(3600n);
    expect(
      upfrontFeeAmount(
        percent('issuance', 'upfront', 'percent', '1.99'),
        cents('30000.00'),
        'half-up',
      ),
    ).toBe(59700n);
    // rounding-fees-half-even: 1.5 % of 12 345.00 = 185.175 → 185.18 (8 is even).
    const arrangement = percent('arrangement', 'upfront', 'percent', '1.5');
    expect(upfrontFeeAmount(arrangement, cents('12345.00'), 'half-even')).toBe(18518n);
  });

  it('rounds ties and fractions per mode', () => {
    // 1 % of 2.50 = 2.5 minor units.
    const fee = percent('f', 'upfront', 'percent', '1');
    expect(MODES.map((mode) => upfrontFeeAmount(fee, 250n, mode))).toEqual([3n, 2n, 3n, 2n]);
    // 1 % of 3.50 = 3.5 minor units: half-even goes up to 4.
    expect(MODES.map((mode) => upfrontFeeAmount(fee, 350n, mode))).toEqual([4n, 4n, 4n, 3n]);
    // 1 % of 2.49 = 2.49 minor units.
    expect(MODES.map((mode) => upfrontFeeAmount(fee, 249n, mode))).toEqual([2n, 2n, 3n, 2n]);
    // 0 % is nothing.
    expect(upfrontFeeAmount(percent('z', 'upfront', 'percent', '0'), 250n, 'ceil')).toBe(0n);
  });

  it('is R_fee(amount × pct / 100) for random inputs', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 17n }),
        fc.integer({ min: 0, max: 100000 }),
        fc.constantFrom(...MODES),
        (amount, thousandths, mode) => {
          const pct = (thousandths / 1000).toFixed(3);
          const fee = percent('f', 'upfront', 'percent', pct);
          // amount × (thousandths / 1000) / 100.
          expect(upfrontFeeAmount(fee, amount, mode)).toBe(
            divRound(amount * BigInt(thousandths), 100000n, mode),
          );
        },
      ),
    );
  });
});

describe('periodicFeeAmount (SPEC §6.2–6.3)', () => {
  it('charges a fixed amount every period', () => {
    const service = fixed('service', 'periodic', '9.95');
    expect(periodicFeeAmount(service, cents('25000.00'), cents('25750.00'), 'half-up')).toBe(995n);
    expect(periodicFeeAmount(service, cents('25000.00'), 0n, 'floor')).toBe(995n);
    const insurance = fixed('vehicle-insurance', 'insurance', '320.00');
    expect(periodicFeeAmount(insurance, cents('150000.00'), cents('146117.82'), 'half-up')).toBe(
      32000n,
    );
  });

  it('takes pct-original of the requested amount, not the balance', () => {
    // car-loan-fixed-insurance-and-gps-fee: 0.05 % of 150 000.00 = 75.00 every month.
    const gps = percent('gps', 'periodic', 'pct-original', '0.05');
    expect(periodicFeeAmount(gps, cents('150000.00'), cents('150000.00'), 'half-up')).toBe(7500n);
    expect(periodicFeeAmount(gps, cents('150000.00'), cents('146117.82'), 'half-up')).toBe(7500n);
    // ua-consumer-loan-monthly-commission: 2.5 % of 30 000.00 = 750.00.
    const commission = percent('monthly-commission', 'periodic', 'pct-original', '2.5');
    expect(periodicFeeAmount(commission, cents('30000.00'), cents('27500.11'), 'half-up')).toBe(
      75000n,
    );
  });

  it('takes pct-balance of the opening balance', () => {
    // rounding-fees-half-even: 0.05 % of 12 345.00 = 6.1725 → 6.17; of 11 849.59 → 5.92.
    const servicing = percent('servicing', 'periodic', 'pct-balance', '0.05');
    expect(periodicFeeAmount(servicing, cents('12345.00'), cents('12345.00'), 'half-even')).toBe(
      617n,
    );
    expect(periodicFeeAmount(servicing, cents('12345.00'), cents('11849.59'), 'half-even')).toBe(
      592n,
    );
    // us-loan-mixed-fees-apr-inclusion: credit life 0.05 % of 25 750.00 = 12.875 → 12.88.
    const creditLife = percent('credit-life', 'insurance', 'pct-balance', '0.05', { inApr: false });
    expect(periodicFeeAmount(creditLife, cents('25000.00'), cents('25750.00'), 'half-up')).toBe(
      1288n,
    );
    expect(periodicFeeAmount(creditLife, cents('25000.00'), cents('25750.00'), 'floor')).toBe(
      1287n,
    );
    // eu-consumer-credit: payment protection 0.07 % of 14 731.07 = 10.3117… → 10.31.
    const ppi = percent('ppi', 'insurance', 'pct-balance', '0.07');
    expect(periodicFeeAmount(ppi, cents('15000.00'), cents('14731.07'), 'half-up')).toBe(1031n);
    // equal-principal-quarterly-fees: 0.125 % of 220 000.00 = 275.00.
    const guarantee = percent('guarantee', 'periodic', 'pct-balance', '0.125');
    expect(periodicFeeAmount(guarantee, cents('240000.00'), cents('220000.00'), 'half-up')).toBe(
      27500n,
    );
    expect(periodicFeeAmount(guarantee, cents('240000.00'), 0n, 'ceil')).toBe(0n);
  });

  it('rounds percentage fees per mode at ties', () => {
    const fee = percent('f', 'periodic', 'pct-balance', '1');
    expect(MODES.map((mode) => periodicFeeAmount(fee, 0n, 250n, mode))).toEqual([3n, 2n, 3n, 2n]);
    const original = percent('o', 'insurance', 'pct-original', '1.5');
    // 1.5 % of 3.00 = 4.5 minor units.
    expect(MODES.map((mode) => periodicFeeAmount(original, 300n, 999999n, mode))).toEqual([
      5n,
      4n,
      5n,
      4n,
    ]);
  });
});

describe('upfrontTotals, principalFinanced, amountFinancedForRates (SPEC §6.1, §9.1)', () => {
  it('splits upfront items by financing and APR inclusion (us-loan-mixed-fees-apr-inclusion)', () => {
    const fees: Fee[] = [
      fixed('origination', 'upfront', '495.00'),
      fixed('gap-cover', 'upfront', '750.00', { financing: 'financed', inApr: false }),
      fixed('service', 'periodic', '9.95'),
      percent('credit-life', 'insurance', 'pct-balance', '0.05', { inApr: false }),
    ];
    const amount = cents('25000.00');
    const totals = upfrontTotals(fees, amount, 'half-up');
    expect(totals.items).toEqual([
      { fee: fees[0], amount: 49500n },
      { fee: fees[1], amount: 75000n },
    ]);
    expect(totals.paid).toBe(49500n);
    expect(totals.financed).toBe(75000n);
    expect(totals.paidInApr).toBe(49500n);
    expect(totals.financedNotInApr).toBe(75000n);
    expect(principalFinanced(amount, totals)).toBe(cents('25750.00'));
    expect(amountFinancedForRates(amount, totals)).toBe(cents('25255.00'));
  });

  it('adds a financed finance charge to P but not to the amount financed (payday vector)', () => {
    const fees = [fixed('finance-charge', 'upfront', '45.00', { financing: 'financed' })];
    const totals = upfrontTotals(fees, cents('300.00'), 'half-up');
    expect(principalFinanced(cents('300.00'), totals)).toBe(cents('345.00'));
    expect(amountFinancedForRates(cents('300.00'), totals)).toBe(cents('300.00'));
  });

  it('reduces the amount financed only by paid items in the APR', () => {
    const amount = cents('10000.00');
    const fees: Fee[] = [
      fixed('paid-in', 'upfront', '100.00'),
      fixed('paid-out', 'upfront', '20.00', { inApr: false }),
      percent('financed-in', 'upfront', 'percent', '1', { financing: 'financed' }),
      percent('financed-out', 'upfront', 'percent', '0.5', { financing: 'financed', inApr: false }),
    ];
    const totals = upfrontTotals(fees, amount, 'half-up');
    expect(totals.paid).toBe(12000n);
    expect(totals.financed).toBe(15000n);
    expect(totals.paidInApr).toBe(10000n);
    expect(totals.financedNotInApr).toBe(5000n);
    expect(principalFinanced(amount, totals)).toBe(cents('10150.00'));
    // 10 000 + 50 (financed, not a finance charge) − 100 (paid finance charge).
    expect(amountFinancedForRates(amount, totals)).toBe(cents('9950.00'));
  });

  it('rounds percentage items with the fee mode', () => {
    const fees = [percent('arrangement', 'upfront', 'percent', '1.5')];
    expect(upfrontTotals(fees, cents('123.00'), 'half-up').paid).toBe(185n); // 184.5
    expect(upfrontTotals(fees, cents('123.00'), 'half-even').paid).toBe(184n);
  });

  it('is all zeros without upfront items', () => {
    const totals = upfrontTotals(
      [fixed('service', 'periodic', '9.95')],
      cents('1000.00'),
      'half-up',
    );
    expect(totals).toEqual({
      items: [],
      paid: 0n,
      financed: 0n,
      paidInApr: 0n,
      financedNotInApr: 0n,
    });
    expect(principalFinanced(cents('1000.00'), totals)).toBe(cents('1000.00'));
    expect(amountFinancedForRates(cents('1000.00'), totals)).toBe(cents('1000.00'));
    expect(upfrontTotals([], cents('1000.00'), 'ceil').items).toEqual([]);
  });

  it('keeps the totals consistent for random fee lists', () => {
    const feeArbitrary = fc.record({
      amount: fc.bigInt({ min: 0n, max: 10n ** 8n }),
      kind: fc.constantFrom<Fee['kind']>('upfront', 'periodic', 'insurance'),
      financing: fc.constantFrom<Fee['financing']>('paid', 'financed'),
      inApr: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(feeArbitrary, { maxLength: 8 }), (specs) => {
        const fees: Fee[] = specs.map((spec, index) => ({
          id: `f${String(index)}`,
          kind: spec.kind,
          value: { calc: 'fixed', amount: spec.amount },
          financing: spec.financing,
          inApr: spec.inApr,
        }));
        const totals = upfrontTotals(fees, 10n ** 9n, 'half-up');
        const upfront = specs.filter((spec) => spec.kind === 'upfront');
        expect(totals.items).toHaveLength(upfront.length);
        expect(totals.paid + totals.financed).toBe(upfront.reduce((sum, s) => sum + s.amount, 0n));
        expect(totals.paidInApr <= totals.paid).toBe(true);
        expect(totals.financedNotInApr <= totals.financed).toBe(true);
      }),
    );
  });
});
