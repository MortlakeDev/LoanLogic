// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { describe, expect, it } from 'vitest';
import { bulletPrincipal } from './bullet';

describe('bulletPrincipal', () => {
  it('repays nothing before the last period and everything in it (SPEC §5.4)', () => {
    expect(bulletPrincipal(1, 12, 20_000_000n)).toBe(0n);
    expect(bulletPrincipal(11, 12, 20_000_000n)).toBe(0n);
    expect(bulletPrincipal(12, 12, 20_000_000n)).toBe(20_000_000n);
  });

  it('repays the principal at once with a single payment', () => {
    expect(bulletPrincipal(1, 1, 500n)).toBe(500n);
  });
});
