// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { defineConfig } from 'vitest/config';

/**
 * Performance budgets (`npm run bench`), run apart from the unit tests: coverage
 * instrumentation and dozens of parallel test files would otherwise share the CPU and
 * make the timing meaningless.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.bench.test.ts'],
    environment: 'node',
    fileParallelism: false,
    // Verbose, so the measured median appears in plain (CI) logs, not only in a terminal.
    reporters: ['verbose'],
  },
});
