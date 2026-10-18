// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

// eslint-plugin-jsx-a11y ships no type declarations; this covers what eslint.config.js uses.
declare module 'eslint-plugin-jsx-a11y' {
  import type { Linter } from 'eslint';

  const plugin: {
    readonly flatConfigs: {
      readonly recommended: Linter.Config;
      readonly strict: Linter.Config & { readonly rules: Linter.RulesRecord };
    };
  };
  export default plugin;
}
