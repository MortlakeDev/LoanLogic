// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import compat from 'eslint-plugin-compat';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NAMED_EXPORTS_ONLY = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports (CLAUDE.md code style).',
};

const ENGINE_RULE = 'The engine is pure and deterministic (CLAUDE.md rule 6, SPEC §0).';

// Globals that would give the engine DOM access, I/O, time or global state.
const ENGINE_FORBIDDEN_GLOBALS = [
  {
    name: 'Date',
    message: 'Use the engine LocalDate; JS Date is only for the UI boundary (SPEC §2.1).',
  },
  ...[
    'window',
    'document',
    'navigator',
    'location',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'setTimeout',
    'setInterval',
    'queueMicrotask',
    'performance',
    'console',
    'process',
  ].map((name) => ({ name, message: ENGINE_RULE })),
  {
    name: 'Intl',
    message:
      'The engine does not read Intl (SPEC §0.3): minor units come from the embedded ISO 4217 table.',
  },
];

export default defineConfig([
  globalIgnores([
    'dist/',
    'dist-single/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    '.remember/',
  ]),

  js.configs.recommended,

  {
    name: 'loanlogic/typescript',
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-restricted-syntax': ['error', NAMED_EXPORTS_ONLY],
    },
  },

  {
    // JavaScript files are typed with JSDoc and checked by tsc (checkJs) instead.
    name: 'loanlogic/explicit-boundaries',
    files: ['**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'error' },
  },

  {
    name: 'loanlogic/browser',
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },

  {
    // Web APIs must exist in every supported browser (DESIGN §12, `browserslist` in
    // package.json). Tests run in Node and jsdom, so they are not checked.
    name: 'loanlogic/compat',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    ...compat.configs['flat/recommended'],
  },

  {
    name: 'loanlogic/accessibility',
    files: ['src/**/*.tsx'],
    ...jsxA11y.flatConfigs.strict,
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // Segmented-control labels wrap the input and render their text two elements deep.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 4 }],
    },
  },

  {
    name: 'loanlogic/node',
    files: ['*.config.{js,ts}', 'scripts/**/*.{js,mjs,ts}', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    // Tool configs must default-export their config; ambient module declarations mirror
    // third-party default exports.
    name: 'loanlogic/config-files',
    files: ['*.config.{js,ts}', '**/*.d.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    name: 'loanlogic/engine',
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...ENGINE_FORBIDDEN_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: ENGINE_RULE },
        { object: 'globalThis', message: ENGINE_RULE },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!decimal\\.js$)(?!\\.{1,2}/)',
              message: 'The engine depends only on decimal.js (CLAUDE.md rule 6).',
            },
            {
              regex: '^(\\.\\./)+(app|i18n|export|styles|config)(/|\\.|$)',
              message: 'The engine must not import UI, i18n, export or app modules.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        NAMED_EXPORTS_ONLY,
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No JS Date in the engine (SPEC §2.1).',
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Money is decimal: parse amounts with decimal.js (SPEC §0).',
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: 'Money is decimal: parse amounts with decimal.js (SPEC §0).',
        },
      ],
    },
  },

  prettier,
]);
