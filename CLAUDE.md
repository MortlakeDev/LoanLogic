# CLAUDE.md — rules for Claude Code in this repository

**Project:** LoanLogic — a precise loan & savings calculator, delivered as a static web
app. **Author:** Mortlake. **License:** AGPL-3.0-or-later.

## Sources of truth (read before every task)

1. `docs/PLAN.md` — scope, architecture, milestones, Definition of Done.
2. `docs/SPEC-finance.md` — financial methodology. It is **normative**: if code and SPEC
   disagree, the SPEC wins. If the SPEC is ambiguous, incomplete or looks wrong, **stop
   and report** (in the PR description and the task file). Never invent financial rules.
3. `docs/DESIGN.md` — design system (once it exists).
4. `docs/tasks/Txx-*.md` — the current task brief and its acceptance criteria.

## Hard rules

1. **Attribution.** The only author is "Mortlake". Copyright line:
   `Copyright (C) 2026 Mortlake`. Never add other author names.
2. **SPDX header** at the top of every source file:
   `// SPDX-License-Identifier: AGPL-3.0-or-later` and `// Copyright (C) 2026 Mortlake`
   (use `/* */` in CSS and `<!-- -->` in HTML). JSON files are exempt.
3. **Clean room.** Write everything from the documents in this repository. Do not copy
   code or text from other projects or from folders outside this repository.
4. **Money is decimal.** Ledger amounts use decimal.js at currency minor units. Never use
   JS `number` for ledger money. Floats are allowed only in analytics (SPEC §0).
5. **Dates without time zones.** Use the engine's `LocalDate`. Never do date arithmetic
   with JS `Date`.
6. **Pure engine.** `src/engine/**` has no DOM, no UI imports, no global state, no I/O,
   and depends only on decimal.js. Same input → same output.
7. **i18n everywhere.** Every user-facing string goes through i18n keys, added to all four
   locales (`en`, `zh-CN`, `ru`, `uk`) in the same change. Translations must be natural,
   not word-for-word. Numbers, dates and currencies are formatted only through the i18n
   formatting helpers (Intl).
8. **No runtime network.** No CDNs, remote fonts, analytics or telemetry. Everything is
   bundled. Works offline and from `file://` (single-file build).
9. **Tests with every change.** Engine changes need unit tests, property tests where
   invariants apply, and must pass all golden vectors in `tests/vectors`. UI changes need
   component or e2e coverage of the new behavior.
10. **Accessibility.** Semantic HTML, a label for every input, full keyboard support,
    visible focus, WCAG 2.2 AA contrast in dark and light themes, `prefers-reduced-motion`.
11. **Dependencies.** Allowed licenses: MIT, ISC, BSD-2/3, Apache-2.0, OFL (fonts);
    MPL-2.0 for dev-only tools. List every new dependency with license and gzip size in
    the PR. Prefer no dependency over a large one.
12. **No silent fallbacks.** Errors and unsupported combinations surface as structured,
    localized messages; never compute something different from what was asked.

## Commands (available after T01)

| Command | Purpose |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build → `dist/` |
| `npm run build:single` | single self-contained file → `dist-single/LoanLogic.html` |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run coverage` | Vitest |
| `npm run e2e` | Playwright |
| `npm run check` | lint + typecheck + test + build (must pass before a PR) |

## Workflow

- One task = one branch `task/Txx-short-name` = one PR into `main`.
- Commits follow Conventional Commits: `feat(engine): …`, `fix(ui): …`, `test: …`,
  `docs: …`, `chore: …`.
- Before opening a PR: `npm run check` and `npm run e2e` pass; docs updated if behavior
  changed; PR template filled (summary, screenshots for UI, test evidence, new
  dependencies, SPEC questions).
- CodeRabbit comments: fix them or reply with reasoning. Do not resolve threads silently.
- When the task is finished, add a "Completion notes" section to the task file: status,
  PR number, deviations, open questions.
- Do not start the next task on your own; the owner assigns tasks.

## Code style

- TypeScript `strict`; no `any` (use `unknown` and narrowing); explicit return types on
  exported functions; named exports.
- Small focused modules; pure functions and immutable data in the engine.
- TSDoc on public engine APIs, including units ("annual rate as a decimal", "amount in
  major units as a decimal string").
- Comments explain *why*, not *what*.
- UI: Preact function components + signals; no business logic in components — they call
  the engine or app-state functions.

## Repository layout

See `docs/PLAN.md` §5.4. Keep it; propose changes in a PR description before
restructuring.
