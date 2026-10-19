// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { htmlI18n } from './scripts/vite/html-i18n.ts';
import { thirdPartyNotices } from './scripts/vite/third-party-notices.ts';
import { APP_NAME } from './src/config.ts';
import { LANGUAGES } from './src/i18n/languages.ts';

/** Base path of the multi-file build; GitHub Pages serves the site under /LoanLogic/. */
const DEFAULT_BASE = '/LoanLogic/';
const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';
const SINGLE_FILE_NAME = 'LoanLogic.html';

/**
 * Any mode but `single` (dev server, `npm run build`, preview): the multi-file site under
 * `BASE_PATH` or /LoanLogic/, built into dist/. `--mode single` (`npm run build:single`):
 * one self-contained dist-single/LoanLogic.html with relative URLs and the third-party
 * notices embedded. Also holds the Vitest configuration.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: single ? './' : (process.env.BASE_PATH ?? DEFAULT_BASE),
    plugins: [
      preact(),
      htmlI18n({ localesDir: 'src/i18n/locales', languages: LANGUAGES, params: { app: APP_NAME } }),
      single ? viteSingleFile({ outputFileName: SINGLE_FILE_NAME }) : undefined,
      thirdPartyNotices({
        fileName: NOTICES_FILE,
        ...(single ? { embedInHtml: SINGLE_FILE_NAME } : {}),
      }),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      // The polyfill would ship Vite runtime code for a feature every target browser has.
      modulePreload: { polyfill: false },
      reportCompressedSize: true,
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
      environment: 'node',
      restoreMocks: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/**/__tests__/**',
          'src/**/*.d.ts',
          // Entry point: only wires modules together; covered by the e2e suite.
          'src/app/main.tsx',
        ],
        reporter: ['text', 'text-summary', 'json-summary', 'html'],
        // A floor against regressions; the engine gets its own ≥ 95 % gate in T02.
        thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
        reportsDirectory: 'coverage',
      },
    },
  };
});
