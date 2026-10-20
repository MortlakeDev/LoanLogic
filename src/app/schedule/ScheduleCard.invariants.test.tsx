// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as engine from '../../engine';
import { checkInvariants } from '../../engine';
import { setLanguage } from '../state/i18n';
import { resetForm, updateForm } from '../state/loan';
import { ScheduleCard } from './ScheduleCard';
import { resetScheduleView } from './view';

// The engine's ledgers always reconcile, so a failing check can only be simulated.
vi.mock('../../engine', async (importOriginal) => ({
  ...(await importOriginal<typeof engine>()),
  checkInvariants: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(checkInvariants).mockReturnValue([
    { invariant: 'I1', index: 3, message: 'closing ≠ opening − principal (developer text)' },
  ]);
  resetForm();
  setLanguage('en');
  resetScheduleView();
  updateForm({ disbursementDate: '2026-11-01' });
});

afterEach(() => {
  cleanup();
});

it('hides the reconciliation note and reports the violations to developers only', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<ScheduleCard />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.queryByText(/reconciles to the cent/)).toBeNull();
  expect(screen.queryByText(/developer text/)).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith('[schedule] ledger invariants failed', [
    'closing ≠ opening − principal (developer text)',
  ]);
});
