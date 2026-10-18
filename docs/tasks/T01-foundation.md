# T01 — Foundation: scaffold, tooling, CI, app shell, i18n, themes

- **Milestone:** M0 · **Status:** in review · **Depends on:** — · **Blocks:** everything
- **Branch:** `task/T01-foundation`

## Goal

A production-grade skeleton of the LoanLogic web app — tooling, CI, deploy and the app
shell — with no financial logic yet. Everything later builds on this, so quality and
conventions matter more than speed.

## Scope

### 1. Scaffold
- Vite + TypeScript (`strict`, `noUncheckedIndexedAccess`) + Preact + `@preact/signals`.
- npm; commit `package-lock.json`. Node.js LTS ≥ 22: set `engines.node` and `.nvmrc`.
- Folders per `docs/PLAN.md` §5.4: `src/engine` (placeholder `index.ts`), `src/app`,
  `src/i18n`, `src/export`, `src/styles`, `tests/vectors`, `tests/e2e`,
  `tools/reference` (README stub only — the architect fills it), `scripts`.

### 2. Tooling
- ESLint flat config: typescript-eslint (type-aware), jsx-a11y, eslint-config-prettier.
  Add a rule (or a small custom check) that forbids `Date` arithmetic and `number`
  money in `src/engine/**` where practical (at minimum: ban `new Date` in the engine).
- Prettier, EditorConfig, `.gitignore`.
- Vitest with coverage (v8) and `@testing-library/preact` for components; `fast-check`
  installed for later property tests.
- Playwright (Chromium + WebKit) with a smoke test; `@axe-core/playwright` scan of the
  shell in both themes.
- Scripts exactly as listed in `CLAUDE.md` (`dev`, `build`, `build:single`, `preview`,
  `lint`, `format`, `typecheck`, `test`, `coverage`, `e2e`, `check`).

### 3. App shell (UI)
- **Header:** wordmark "LoanLogic" (text) and "by Mortlake"; language switcher
  (English, 简体中文, Русский, Українська); theme switcher (System / Dark / Light).
- **Main:** responsive two-column layout — "Loan parameters" panel and "Results" panel
  with tasteful empty states. Stacks on screens < 1024 px. No horizontal scroll at 360 px.
- **Footer:** "© 2026 Mortlake · AGPL-3.0-or-later · Source code" (link from
  `src/config.ts`, default `https://github.com/MortlakeDev/LoanLogic`) and a short
  disclaimer: for information only, not financial advice, results may differ from the
  lender's figures.
- Localized `<title>` and meta description; `<html lang>` follows the UI language;
  simple SVG favicon (monogram placeholder).

### 4. i18n infrastructure
- Locales `en` (source of truth), `zh-CN`, `ru`, `uk` as JSON. Keys are type-checked
  (a missing or misspelled key is a compile error).
- Interpolation `{name}` and plurals via `Intl.PluralRules` (`_one`, `_few`, `_many`,
  `_other` — needed for ru/uk).
- Language detection: saved choice → `navigator.languages` → `en`. Switching is instant
  (no reload) and persisted.
- Formatting helpers (all via Intl; locale passed explicitly):
  `formatMoney(value: string, currency, locale)`, `formatNumber`, `formatPercent(value,
  digits)`, `formatDate({ y, m, d }, locale, style)`. Dates must be formatted with
  `timeZone: 'UTC'` from `Date.UTC(...)` so no off-by-one-day shifts occur.
- Default formatting locale per UI language: en → en-US, zh-CN → zh-CN, ru → ru-RU,
  uk → uk-UA (region profiles will override this in T05).
- Unit tests: identical key sets in all locales, no empty values; formatter samples —
  1234567.891 USD (en-US) → `$1,234,567.89`; JPY shows no decimals; uk-UA and ru-RU
  use their native grouping and decimal separators; zh-CN currency CNY.
- Translate every shell string into all four languages, naturally.

### 5. Themes and design tokens
- `src/styles/tokens.css`: CSS custom properties — neutral scale (black → graphite →
  grays), surface levels (bg, surface-1/2/3), text levels (primary, secondary, muted),
  borders, one accent (temporary value; the final accent comes from `DESIGN.md`),
  semantic colors (success, warning, danger, info), radii, spacing scale, shadows, type
  scale, focus ring.
- Dark (default when system is dark) and light themes via `data-theme` on `<html>`;
  "System" follows `prefers-color-scheme` live. Choice persisted. An inline script in
  `index.html` applies the theme before first paint (no flash).
- Font: self-hosted Inter variable (`@fontsource-variable/inter`, OFL) with tabular
  numerals for amounts; CJK falls back to system fonts.
- Both themes must meet WCAG 2.2 AA contrast for text and UI components.

### 6. Persistence utility
- `src/app/storage.ts`: safe `localStorage` wrapper (try/catch, JSON, namespace
  `loanlogic:`, versioned keys, never throws to the caller).

### 7. Builds and deploy
- `npm run build` → `dist/`, base path configurable (default `/LoanLogic/` for Pages).
- `npm run build:single` → `dist-single/LoanLogic.html` via `vite-plugin-singlefile`;
  must open from `file://` with no network.
- GitHub Actions:
  - `ci.yml` (PRs and pushes): `npm ci`, lint, typecheck, unit tests with coverage
    summary, build, build:single, Playwright e2e (Chromium + WebKit), SPDX check,
    license check; upload `LoanLogic.html` as an artifact.
  - `deploy.yml` (push to `main`): build and deploy to GitHub Pages.
- Third-party notices for bundled dependencies generated at build time
  (e.g. `rollup-plugin-license`); CI fails on a license outside the allowlist in
  `CLAUDE.md`.

### 8. Repository documents
- `README.md` (English): what LoanLogic is, status (pre-alpha), planned features in
  brief, privacy (everything runs locally), development setup, scripts, contributing,
  license, author Mortlake.
- `CONTRIBUTING.md`: workflow, Conventional Commits, tests required, i18n rule, SPDX rule.
- `.github/pull_request_template.md`; issue templates (bug, feature).
- `.coderabbit.yaml`: reviews on; path instructions —
  `src/engine/**`: financial correctness per `docs/SPEC-finance.md`, decimal-only
  money, invariants, no `Date` arithmetic; `src/i18n/**`: key parity across 4 locales,
  natural translations; `src/app/**`: accessibility, no hardcoded strings, no business
  logic in components; `tests/**`: meaningful assertions, no snapshot-only tests for
  logic. Ignore the lockfile and generated files.
- `scripts/check-spdx.mjs`: fails if a source file lacks the SPDX + copyright header.

## Out of scope

Financial engine, real inputs, charts and exports (later tasks).

## Acceptance criteria

- [ ] `npm ci && npm run check && npm run e2e` pass locally and in CI.
- [ ] The shell renders in all four languages; switching updates text and `<html lang>`
      without reload; the choice persists across reloads.
- [ ] Theme System / Dark / Light works and persists; no flash of the wrong theme.
- [ ] axe reports no serious or critical violations in either theme.
- [ ] No horizontal scroll at 360 px; two columns at ≥ 1024 px.
- [ ] `dist-single/LoanLogic.html` opens offline from `file://` and shows the shell.
- [ ] Initial JS ≤ 60 KB gzip at this stage (report the number in the PR).
- [ ] README, CONTRIBUTING, templates, `.coderabbit.yaml`, SPDX and license checks present.
- [ ] Author is "Mortlake" everywhere; no code or text copied from outside the repository.

## Notes

- The repository URL in `src/config.ts` is a single constant so it is easy to change.
- Keep design tokens easy to change: `DESIGN.md` (after the design concept) may replace
  values, not the structure.

## Completion notes

**Status:** in review, [PR #1](https://github.com/MortlakeDev/LoanLogic/pull/1) (branch
`task/T01-foundation`).

**Acceptance criteria (local evidence, 2026-10-19):**

- `npm ci && npm run check && npm run e2e` pass locally on Windows (Node 24.19). CI runs
  on the PR; its first result is not in yet. `check`: lint, format, typecheck, SPDX
  (60 files), licenses, 591 unit/component tests at 100 % coverage of `src/` (gate 90 %),
  both builds and the size budget. `e2e`: 148 passed, 8 skipped, 0 failed across Chromium
  and WebKit.
- Four languages switch instantly without a reload, update `<html lang>`, the title and the
  meta description, and persist (e2e `i18n.spec.ts`).
- System/Dark/Light works, persists and follows `prefers-color-scheme` live. No flash: the
  inline head script applies the theme even with the app JS blocked (e2e `theme.spec.ts`).
- axe finds no serious or critical violations in either theme, at 360 and 1280 px, in all
  four languages (e2e `a11y.spec.ts`).
- No horizontal scroll at 360 px in any language or theme. Two columns at ≥ 1024 px,
  stacked below (e2e `layout.spec.ts`).
- `dist-single/LoanLogic.html` opens from `file://` with every http(s) request blocked;
  zero requests are attempted (e2e `single-file.spec.ts`).
- Initial JS is **13.97 KiB gzip** (budget 60 KiB).
- README, CONTRIBUTING, PR/issue templates, `.coderabbit.yaml`, SPDX and license checks
  are present. The author is Mortlake everywhere.

**Deviations and decisions (details in the PR):**

- Toolchain: Preact 10.29 (Preact 11 is three weeks old); ESLint 10, with an npm override
  for jsx-a11y's stale peer range; TypeScript 6.0 (typescript-eslint does not support 7).
- Third-party notices come from a small custom Vite plugin, not `rollup-plugin-license`.
  It covers the OFL font asset, fails on a disallowed license or a missing license file,
  and embeds the notices verbatim in the single file.
- Theme work covers mechanics and token structure only; every palette and font value is a
  placeholder for `docs/DESIGN.md` (font swap point: `src/styles/fonts.ts`). Tests check
  contrast rules, not values.
- Plural keys carry exactly the categories `Intl.PluralRules` gives for each language;
  base keys are identical across locales.
- `ci.yml` runs on PRs, pushes to `main` and manual dispatch. `deploy.yml` takes the base
  path from `configure-pages`.
- `.gitattributes` now forces `eol=lf`. Without it, a Windows checkout gets CRLF and
  Prettier's LF check fails `npm run check`.
- `engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`, because jsdom 30 and ESLint 10
  need these minimums.
- The language switcher applies keyboard browsing of the closed select on Enter or blur
  (WCAG 3.2.2). Mouse and touch picks apply instantly.

**Open questions for the owner:**

1. Confirm the dev-only transitive license exceptions: BlueOak-1.0.0, MIT-0, CC0-1.0,
   CC-BY-4.0.
2. CSP (PLAN §5.7) is deferred: the single-file build needs hashed inline script and
   style. Which task should take it?
3. How should an amount that rounds to zero but is negative be shown? Today it shows as
   "-$0.00"; the SPEC is silent.
4. A shared financial glossary for zh-CN, ru and uk (PLAN §10). The PR lists the terms
   the translation reviews suggested.
5. GitHub Pages must be set to *Source = GitHub Actions* in the repository settings.
6. CLAUDE.md's command table describes `npm run check` as fewer steps than it now runs.
7. 2 keyboard tests skip in WebKit on Windows, which does not Tab to links. They are
   expected to run on Linux CI.
