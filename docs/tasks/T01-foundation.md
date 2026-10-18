# T01 — Foundation: scaffold, tooling, CI, app shell, i18n, themes

- **Milestone:** M0 · **Status:** ready · **Depends on:** — · **Blocks:** everything
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

_(to be filled by the implementer)_
