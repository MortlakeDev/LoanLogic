// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { parseIsoDate, type LocalDate } from '../date';
import { parseDecimal, rational } from '../rational';
import type { CashFlow } from '../types';
import { solveXirr, xirrTimes } from './xirr';

function date(text: string): LocalDate {
  const parsed = parseIsoDate(text);
  if (parsed === undefined) {
    throw new Error(`bad date ${text}`);
  }
  return parsed;
}

describe('xirrTimes (SPEC §9.2)', () => {
  it('measures days / 365 from the first flow, also in leap years', () => {
    const flows: CashFlow[] = [
      { date: date('2028-01-01'), amount: parseDecimal('-100') },
      { date: date('2028-01-01'), amount: parseDecimal('1000') },
      { date: date('2029-01-01'), amount: parseDecimal('-1000') },
    ];
    expect(xirrTimes(flows).map((flow) => flow.time)).toEqual([
      rational(0n),
      rational(0n),
      rational(366n, 365n),
    ]);
  });

  it('returns nothing for no flows', () => {
    expect(xirrTimes([])).toEqual([]);
  });
});

describe('solveXirr', () => {
  it('solves a one-year loan', () => {
    const result = solveXirr([
      { date: date('2026-01-01'), amount: parseDecimal('1000') },
      { date: date('2027-01-01'), amount: parseDecimal('-1100') },
    ]);
    expect(result.ok && Math.abs(result.root - 0.1)).toBeLessThanOrEqual(1e-12);
  });

  it('reproduces the Excel documentation example (0.373362535)', () => {
    const result = solveXirr(
      [
        ['2008-01-01', '-10000'],
        ['2008-03-01', '2750'],
        ['2008-10-30', '4250'],
        ['2009-02-15', '3250'],
        ['2009-04-01', '2750'],
      ].map(([day = '', amount = '']) => ({ date: date(day), amount: parseDecimal(amount) })),
    );
    // Excel shows 0.373362535 (its own iteration stops near 1e-8); the root is 0.37336253351883….
    expect(result.ok && Math.abs(result.root - 0.373362535)).toBeLessThanOrEqual(2e-9);
    expect(result.ok && Math.abs(result.root - 0.37336253351883)).toBeLessThanOrEqual(1e-12);
  });
});
