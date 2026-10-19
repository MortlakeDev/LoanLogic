# Contributing to LoanLogic

Thank you for helping. LoanLogic is a financial tool, so correctness, privacy and
accessibility come before speed. This guide summarizes the rules. [`CLAUDE.md`](CLAUDE.md) is
the authoritative list and applies to every contributor, human or AI.

## Before you start

Read these documents first:

1. [`docs/PLAN.md`](docs/PLAN.md) for scope, architecture, milestones and the Definition of
   Done.
2. [`docs/SPEC-finance.md`](docs/SPEC-finance.md) for the financial methodology. It is
   **normative**: if code and SPEC disagree, the SPEC wins.
3. `docs/DESIGN.md` for the design system, once it exists.
4. The brief for your task in [`docs/tasks/`](docs/tasks/), with its acceptance criteria.

Found a bug or have an idea? Open an issue with one of the issue forms. The owner turns
accepted work into a task.

## Workflow

- The owner (Mortlake) assigns tasks. Do not start a task that has not been assigned to you,
  and do not move on to the next one on your own.
- **One task = one branch = one pull request into `main`.** Name the branch
  `task/Txx-short-name`, for example `task/T01-foundation`.
- Fill in the pull request template completely: summary, task link, screenshots for UI
  changes, test evidence, new dependencies and SPEC questions.
- When the task is finished, add a **Completion notes** section to its task file: status, PR
  number, deviations from the brief and open questions.
- The lifecycle of a task: brief → implementation PR → CI green → CodeRabbit comments
  addressed → architect acceptance → merge → task marked done.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, in
the imperative mood. Common types are `feat`, `fix`, `test`, `docs`, `refactor`, `perf` and
`chore`. Scopes follow the source folders: `engine`, `app` or `ui`, `i18n`, `export`, `styles`
and `ci`. Examples:

```text
feat(engine): add equal-principal schedule
fix(ui): keep focus on the language switcher after a change
test: add property tests for ledger invariants I1–I9
docs: clarify the SPDX header rule
chore: bump Playwright to the latest patch release
```

## Tests come with every change

- **Engine** (`src/engine/**`) changes need unit tests and property tests (fast-check) wherever
  an invariant applies, such as the ledger invariants I1–I9 in SPEC §8.3. They must also pass
  every golden vector in [`tests/vectors`](tests/vectors). Ledger values are compared exactly,
  as decimal strings.
- **UI** changes need component tests (Vitest + `@testing-library/preact`) or end-to-end
  tests (Playwright in `tests/e2e`) that cover the new behavior.
- Tests live next to the code as `*.test.ts` or `*.test.tsx`. Import test APIs explicitly from
  `vitest`; there are no globals. Tests run in Node by default. A test that needs the DOM puts
  `// @vitest-environment jsdom` right after the SPDX header.
- Assertions must be meaningful. Do not use snapshot-only tests for logic.

## Financial rules

- **The SPEC decides.** Never invent a financial rule in code. If the SPEC is ambiguous,
  incomplete or looks wrong, stop and report it in the pull request description and the task
  file. The architect resolves it in the SPEC.
- **Money is decimal.** Ledger amounts use decimal.js at the currency's minor unit. Never use a
  JS `number` for ledger money. Floats are allowed only in analytics such as rate solvers and
  NPV (SPEC §0).
- **Dates have no time zone.** Use the engine's `LocalDate`. Never do date arithmetic with JS
  `Date`. `Date` is allowed only at the UI boundary, for example to get "today". ESLint bans
  `Date` in the engine.
- **The engine is pure.** `src/engine/**` has no DOM, no UI imports, no global state and no
  I/O, and depends only on decimal.js. The same input always gives the same output.
- **No silent fallbacks.** Errors and unsupported combinations become structured errors
  (`{ code, field, params }`) that the UI localizes. Never compute something other than what
  was asked.

## Internationalization (i18n)

- Every user-facing string goes through an i18n key. Add each key to **all four locales** in
  the same change: `en`, `zh-CN`, `ru` and `uk` (`src/i18n/locales/*.json`).
- `en.json` is the source of truth. Keys are type-checked against it, so a missing or
  misspelled key is a compile error.
- Keys are **flat and dotted**, for example `panels.results.title`. A key never contains `_`,
  except in a plural suffix.
- **Plurals:** add suffixed variants (`_zero`, `_one`, `_two`, `_few`, `_many`, `_other`) and
  pass a numeric `count`. The form is chosen with `Intl.PluralRules` for the UI language.
  Always provide `_other`. Russian and Ukrainian need `_one`, `_few`, `_many` and `_other`.
- **Placeholders** use `{name}` and are copied unchanged into every translation. Brand names
  are never translated or hard-coded. Use `{app}` for LoanLogic and `{author}` for Mortlake.
- Translations must read naturally in each language, not word for word. Use the established
  financial term for each market.
- Format numbers, amounts, percentages and dates only with the helpers in
  [`src/i18n/format.ts`](src/i18n/format.ts): `formatMoney`, `formatNumber`, `formatPercent`
  (takes a fraction, so `"0.065"` → 6.5 %) and `formatDate` (takes a `{ y, m, d }` calendar
  date and formats in UTC). Always pass the locale explicitly.

## Accessibility

- Use semantic HTML. Every input has a label, and a native control is better than an ARIA
  imitation.
- Everything works with the keyboard alone, and focus is always visible.
- Meet WCAG 2.2 AA contrast for text and UI components in **both** the dark and the light
  theme.
- Respect `prefers-reduced-motion`.
- Layouts work from a width of 360 px, with no horizontal scroll.
- Lint runs `eslint-plugin-jsx-a11y` in strict mode, and the e2e suite runs axe scans.

## SPDX headers

Every source file starts with the SPDX license identifier and the copyright line, exactly as
below.

TypeScript and JavaScript (`.ts`, `.tsx`, `.js`, `.mjs`, …):

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
```

CSS:

```css
/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Copyright (C) 2026 Mortlake */
```

HTML:

```html
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Mortlake -->
```

The header may follow a `#!` shebang line or `<!doctype html>`. JSON, Markdown and YAML files
are exempt. `npm run check:spdx` enforces the rule and is part of `npm run check`.

## Dependencies and licenses

- Prefer no dependency over a large one.
- Allowed licenses: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, and OFL-1.1 for fonts.
  MPL-2.0 is allowed for dev-only tools.
- List every new dependency in the pull request with its license, gzip size and the reason it
  is needed.
- `npm run check:licenses` checks every installed package against the allowlist. The build
  fails if a bundled package has a license outside the runtime allowlist, and it generates
  `THIRD-PARTY-NOTICES.txt`.
- No runtime network access: no CDNs, remote fonts, analytics or telemetry. Everything is
  bundled, and the single-file build must work from `file://`.

## Clean room

Write everything from the documents in this repository. Do not copy code or text from other
projects or from folders outside this repository. The only author is Mortlake. Do not add
other author names.

## Code style

- TypeScript `strict`. Do not use `any`; use `unknown` and narrow it.
- Use named exports only, and give exported functions explicit return types.
- Keep modules small. The engine uses pure functions and immutable data.
- Public engine APIs have TSDoc that states units, for example "annual rate as a decimal" or
  "amount in major units as a decimal string".
- Comments explain _why_, not _what_.
- UI: Preact function components and signals. Components hold no business logic; they call
  engine or app-state functions.
- Prettier and ESLint settle formatting and lint questions (`npm run format`,
  `npm run lint`).
- Line endings are LF everywhere; `.gitattributes` (`eol=lf`) enforces it on every checkout,
  including Windows.

## Before you open a pull request

- [ ] `npm run check` passes (lint, format check, typecheck, SPDX and license checks, tests
      with coverage thresholds, both builds, size budget).
- [ ] `npm run e2e` passes in Chromium and WebKit.
- [ ] New behavior is covered by tests. Engine changes pass the property tests and the golden
      vectors.
- [ ] User-facing text exists in all four locales, with no hard-coded strings.
- [ ] Accessibility is checked in the dark and light themes and at 360 px.
- [ ] Docs are updated if behavior or architecture changed.
- [ ] The pull request template is filled in, including new dependencies and SPEC questions.

## Code review

CodeRabbit reviews every pull request. Fix each comment, or reply with your reasoning. Never
resolve a thread silently. SPEC questions raised in a review are reported to the architect,
never decided in code.
