# T01 — Foundation: scaffold, tooling, CI, app shell, i18n, themes

- **Milestone:** M0 · **Status:** done (PR #1) · **Depends on:** — · **Blocks:** everything
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

**Acceptance criteria (local evidence, 2026-10-19, re-run after the architect review):**

- `npm ci && npm run check && npm run e2e` pass locally on Windows (Node 24.19), and both
  CI jobs passed on the PR before the review fixes. `check`: lint, format, typecheck, SPDX
  (60 files), licenses, 617 unit/component tests at 100 % coverage of `src/` (gate 90 %),
  both builds and the size budget. `e2e`: 148 passed, 8 skipped, 0 failed across Chromium
  and WebKit on Windows; on Linux CI 150 passed and 6 skipped.
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
- Initial JS is **13.98 KiB gzip** (budget 60 KiB).
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

**Architect review (2026-10-19): accepted, with required changes, all done:**

1. CI hardening committed (`d6aaec6`): `ci.yml` validates the `@playwright/test` version
   read from the lockfile and writes the cache key with `printf`; a manual `deploy.yml`
   run from a branch other than `main` does nothing.
2. Deploy gating (CodeRabbit, `70834d8`): `deploy.yml` runs on `workflow_run` of `CI`
   (`completed`, `main`) and on `workflow_dispatch`. Both jobs run only for a CI run that
   succeeded, came from a `push` and whose head repository is this one, or for a manual run
   on `refs/heads/main`. After CI, the build checks out `workflow_run.head_sha`, the commit
   CI tested. GitHub reads `workflow_run` triggers from the default branch, so the gate
   takes effect once this PR is merged.
3. SPDX parser (CodeRabbit, `77aa13c`): `parseAtom` throws on `)` and on `AND` / `OR` /
   `WITH` as an operand, so `"MIT OR OR"` is no longer allowed. Tests cover the
   requested cases plus a test with the operators in the allowlist.
4. Negative zero (`a0596a8`): `formatMoney`, `formatNumber` and `formatPercent` use
   `signDisplay: 'negative'`. `"-0.004"` USD → `$0.00`, `"-0.005"` → `-$0.01`, `"-0"` →
   `$0.00`, `"-0.00001"` at 2 decimals → `0.00%`, with ru-RU, uk-UA and zh-CN samples.
   The money rounding property test now covers amounts near zero too.
5. TSDoc (CodeRabbit docstring check, `81ab706`): every top-level function and component
   now has a short TSDoc (149 of 149, up from 90), including all exported ones, test and
   e2e helpers, and the language switcher's non-obvious key handlers. Comments only. Each
   doc was checked against the code; three existing docs were corrected on the way (the
   parameters art, `storageKey`/`createStorageSlot` errors, the notices plugin).
6. These notes; `npm run check` and `npm run e2e` re-run (numbers above).

**Owner's answers to the earlier open questions:**

1. BlueOak-1.0.0, MIT-0, CC0-1.0 and CC-BY-4.0 are approved for dev-only use and must never
   ship (the build gate enforces that). CLAUDE.md rule 11 is updated in the architect PR.
2. CSP goes to T18: a hash-based CSP for both builds that covers the inline theme script.
3. A value that displays as zero never shows a sign (item 4). The rule also goes into
   `docs/DESIGN.md` (architect PR).
4. The architect delivers `docs/GLOSSARY.md` (en / zh-CN / ru / uk) before T03, taking in
   the translation-review suggestions from this PR.
5. The owner sets *Settings → Pages → Source* to "GitHub Actions".
6. The architect updates the CLAUDE.md command table.
7. Confirmed: the two WebKit "Tab to link" keyboard tests run and pass on Linux CI.

Design (accent, Onest, JetBrains Mono, Unbounded) arrives with `docs/DESIGN.md` and is
applied in T03; T01 keeps the placeholders. T02 stays blocked until the R1 vectors land.

**Open questions:**

1. **Browser baseline.** `signDisplay: 'negative'` is part of Intl.NumberFormat v3
   (Chrome/Edge 106, Firefox 116, Safari 15.4). Older engines throw a `RangeError` for it,
   so every formatted figure would fail there, where `roundingMode` was merely ignored.
   PLAN does not name supported browsers; should one be recorded (T18/T19)?
2. **Task index.** The review says CSP is recorded under T18 in the task index. This PR
   does not edit `docs/tasks/README.md`, to stay clear of the architect PR.
