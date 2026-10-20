# Tasks

Each task is one branch and one pull request. Briefs are written by the architect;
the implementer (Claude Code) follows `CLAUDE.md`. Status values: `ready`, `blocked`,
`in progress`, `in review`, `done`.

## How to start a task (prompt for Claude Code)

```
Read CLAUDE.md, every document it lists as a source of truth, and docs/tasks/<TASK FILE>.
Implement the task on branch task/<ID>-<short-name>, following every rule in CLAUDE.md.
Run npm run check and npm run e2e, open a pull request, and add "Completion notes"
to the task file. If anything in the brief or the SPEC is unclear, stop and ask.
```

## Index

| ID | Title | Milestone | Status | Depends on |
|---|---|---|---|---|
| [T01](T01-foundation.md) | Foundation: scaffold, tooling, CI, app shell, i18n, themes | M0 | done (PR #1) | — |
| [T02](T02-engine-core.md) | Engine core: money, dates, day-count, schedules, fees, rate metrics | M1 | done (PR #4) | T01, R1 ✓ |
| [T03](T03-calculator-ui.md) | Calculator UI: design tokens, inputs, results summary, schedule table, explain | M2 | done (PR #8) | T02 ✓, R2 ✓ |
| [T03a](T03a-ui-followups.md) | UI follow-ups from the T03 review: explain payloads (SPEC v0.2.3), amount group label, theme menu, two live-site fixes | M2 | ready | T03 ✓ |
| [T04](T04-charts.md) | Charts (theme-aware SVG) | M2 | ready, starts after T03a | T03 ✓, T03a |
| [T05](T05-regions-persistence.md) | Region profiles, presets, URL & local persistence | M2 | ready, starts after T03a | T03 ✓, T03a |
| T06 | Events engine: prepayments, rate changes, holidays, odd first period, semi-monthly | M3 | planned | T02, R3 |
| T07 | Events UI | M3 | planned | T06, T03 |
| T08 | Comparison: repayment types, offers, break-even, what-if, day-count | M4 | planned | T05, R4 |
| T09 | Refinance, payoff amount, goal seek | M4 | planned | T06, R4 |
| T10 | Invest vs prepay, borrow vs cash, real (inflation-adjusted) value | M4 | planned | T06, R4 |
| T11 | Affordability & risk: DTI, LTV, DSCR, max loan, stress test, housing costs, checks | M5 | planned | T05, R4 |
| T12 | Multi-part loans | M5 | planned | T06, R4 |
| T13 | Deposits & savings | M5 | planned | T02, R4 |
| T14 | Print / PDF report | M6 | planned | T04, T08 |
| T15 | XLSX, DOCX, CSV, ERP CSV, JSON, share | M6 | planned | T14 |
| T16 | Scenarios & history | M7 | planned | T05 |
| T17 | Glossary, onboarding, help | M7 | planned | T05 |
| T18 | PWA, single-file polish, performance, CSP, unsupported-browser notice (the build target is set in T03) | M7 | planned | all features |
| T19 | Accessibility & visual QA, release v1.0 | M7 | planned | T18 |

Briefs for planned tasks are written one milestone ahead, so they reflect what was
learned in earlier tasks.

## Architect deliverables

| ID | Deliverable | Status |
|---|---|---|
| R1 | Reference implementation `tools/reference` + core vectors `tests/vectors/core`; SPEC v0.2 (revised after three independent reviews; v0.2.1 and v0.2.2 answer the T02 questions) | delivered 2026-10-19, updated 2026-10-20 |
| R2 | `docs/DESIGN.md` (lime accent, Onest / JetBrains Mono, Unbounded wordmark), `docs/GLOSSARY.md` | delivered 2026-10-19 |
| R3 | Event vectors (prepayments, rate changes, holidays, odd first period) | before T06 |
| R4 | Analytics vectors (comparison, refinance, goal seek, affordability, deposits) | before T08–T13 |
