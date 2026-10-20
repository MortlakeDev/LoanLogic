// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { RATE_METHOD_IDS, type RateMethodId } from '../../engine';
import { headlineMethodFor, rateSourceOf, secondaryMethodFor } from './headline';

describe('headlineMethodFor (T03 brief §6)', () => {
  it.each([
    ['USD', 'usRegZApr'],
    ['GBP', 'ukAprc'],
    ['EUR', 'euAprc'],
    ['PLN', 'euAprc'],
    ['CZK', 'euAprc'],
    ['HUF', 'euAprc'],
    ['RON', 'euAprc'],
    ['SEK', 'euAprc'],
    ['DKK', 'euAprc'],
    ['CNY', 'cnAnnualized'],
    ['UAH', 'uaRealAnnual'],
    ['JPY', 'international'],
    ['CHF', 'international'],
    ['CAD', 'international'],
    ['AUD', 'international'],
    ['NOK', 'international'],
    ['', 'international'],
  ] as const)('%s → %s', (currency, method) => {
    expect(headlineMethodFor(currency)).toBe(method);
  });

  it('matches currency codes exactly (no case folding)', () => {
    expect(headlineMethodFor('usd')).toBe('international');
  });
});

describe('secondaryMethodFor (DESIGN §8.7)', () => {
  it('pairs the Chinese simple annualized rate with the IRR method', () => {
    expect(secondaryMethodFor('cnAnnualized')).toBe('irrEffective');
  });

  it.each(RATE_METHOD_IDS.filter((method) => method !== 'cnAnnualized'))(
    '%s → the effective rate without fees',
    (method) => {
      expect(secondaryMethodFor(method)).toBe('effective');
    },
  );
});

describe('rateSourceOf', () => {
  const sources: Record<RateMethodId, ReturnType<typeof rateSourceOf>> = {
    nominal: null,
    effective: null,
    irrNominal: null,
    irrEffective: null,
    xirr: null,
    usRegZApr: 'regZ',
    ukAprc: 'fca',
    euAprc: 'eu',
    cnAnnualized: 'pboc',
    uaRealAnnual: 'nbu',
    international: null,
  };

  it.each(RATE_METHOD_IDS)('%s', (method) => {
    expect(rateSourceOf(method)).toBe(sources[method]);
  });
});
