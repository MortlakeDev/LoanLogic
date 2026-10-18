# Tasks

Each task is one branch and one pull request. Briefs are written by the architect;
the implementer (Claude Code) follows `CLAUDE.md`. Status values: `ready`, `blocked`,
`in progress`, `in review`, `done`.

## How to start a task (prompt for Claude Code)

```
Read CLAUDE.md, docs/PLAN.md, docs/SPEC-finance.md and docs/tasks/<TASK FILE>.
Implement the task on branch task/<ID>-<short-name>, following every rule in CLAUDE.md.
Run npm run check and npm run e2e, open a pull request, and add "Completion notes"
to the task file. If anything in the brief or the SPEC is unclear, stop and ask.
```

## Index

| ID | Title | Milestone | Status | Depends on |
|---|---|---|---|---|
| [T01](T01-foundation.md) | Foundation: scaffold, tooling, CI, app shell, i18n, themes | M0 | ready | — |
| [T02](T02-engine-core.md) | Engine core: money, dates, day-count, schedules, fees, rate metrics | M1 | blocked (R1 vectors) | T01, R1 |
| T03 | Calculator UI: inputs, results summary, schedule table, explain | M2 | planned | T02, R2 |
| T04 | Charts (theme-aware SVG) | M2 | planned | T03 |
| T05 | Region profiles, presets, live recalculation, URL & local persistence | M2 | planned | T03 |
| T06 | Events engine: prepayments, rate changes, holidays, odd first period, semi-monthly | M3 | planned | T02, R3 |
| T07 | Events UI | M3 | planned | T06, T03 |
| T08 | Comparison: repayment types, offers, break-even, what-if, day-count | M4 | planned | T05, R4 |
| T09 | Refinance, payoff amount, goal seek | M4 | planned | T06, R4 |
| T10 | Invest vs prepay, borrow vs cash, real (inflation-adjusted) value | M4 | planned | T06, R4 |
| T11 | Affordability & risk: DTI, LTV, DSCR, max loan, stress test, housing costs, checks | M5 | planned | T05, R4 |
| T12 | Multi-part loans | M5 | planned | T06, R4 |
| T13 | Deposits & savings | M5 | planned | T02, R4 |
| T14 | Print / PDF report | M6 | planned | T08 |
| T15 | XLSX, DOCX, CSV, ERP CSV, JSON, share | M6 | planned | T14 |
| T16 | Scenarios & history | M7 | planned | T05 |
| T17 | Glossary, onboarding, help | M7 | planned | T05 |
| T18 | PWA, single-file polish, performance | M7 | planned | all features |
| T19 | Accessibility & visual QA, release v1.0 | M7 | planned | T18 |

Briefs for planned tasks are written one milestone ahead, so they reflect what was
learned in earlier tasks.
