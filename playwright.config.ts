// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_PATH = (process.env.BASE_PATH ?? '/LoanLogic/').replace(/\/?$/, '/');
const CI = process.env.CI !== undefined && process.env.CI !== '';

/**
 * End-to-end tests run against the production build served by `vite preview`
 * (`npm run e2e` builds first) and against the single-file build from `file://`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  ...(CI ? { workers: 2 } : {}),
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}${BASE_PATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run preview -- --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}${BASE_PATH}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
