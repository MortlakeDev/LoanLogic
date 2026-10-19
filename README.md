# LoanLogic

A precise, private loan & savings calculator that runs entirely in your browser.

LoanLogic is for bank professionals and for anyone borrowing or saving in the US, the UK, the
EU, China, Ukraine and beyond. It aims to reproduce a lender's schedule to the cent, show the
real cost of credit the way your region defines it, and explain every number it shows. There is
no server and no tracking, it works offline, and it is open source.

> **Status: pre-alpha.** This is the foundation (milestone M0): the app shell, tooling,
> languages, themes and builds. **There are no calculations yet.** The financial engine
> arrives with task T02. See [`docs/PLAN.md`](docs/PLAN.md) §7 for the milestones.

## Principles

- **Exact to the cent.** Money is computed with decimal arithmetic, never binary floats. Every
  schedule row, every column total and the final balance reconcile to the currency's minor
  unit.
- **Regionally correct.** The headline cost-of-credit figure follows your region: APR (US,
  Regulation Z), APRC (UK and EU), 年化利率 (China), the real annual interest rate (Ukraine),
  or an effective all-in rate elsewhere.
- **Show the math.** Every headline number can explain itself: the formula, the inputs and
  the substituted values.
- **Live.** Results update as you type. There is no "Calculate" button and no stale result.
- **Private by design.** Nothing you enter leaves your device.
- **Accessible and international.** WCAG 2.2 AA, keyboard first, four languages.
- **No silent fallbacks.** If something cannot be computed or applied, LoanLogic says so
  instead of computing something else.

## Planned features

Nothing below is implemented yet. The full catalogue, with priorities and milestones, is in
[`docs/PLAN.md`](docs/PLAN.md) §3.

- **Loan calculator.** Annuity, equal principal, interest-only with a bullet, and balloon
  loans. Term and payment frequency are set independently. Compounding, day-count conventions
  and rounding policy are configurable. Fees and insurance carry a per-fee APR flag.
  Prepayments, rate changes and payment holidays are supported. Every loan gets a full
  schedule, charts and a "How was this calculated?" view.
- **Comparison.** The same loan under every repayment type, up to five offers side by side,
  the break-even reinvestment rate, a day-count comparison and what-if sliders.
- **Prepayment, payoff and refinancing.** Invest vs prepay, borrow vs pay cash, the payoff
  amount at a date, refinancing with break-even, and goal seek (solve for amount, rate, term
  or payment).
- **Affordability and risk.** DTI, LTV/CLTV, DSCR, maximum loan, stress test and housing
  costs. Checks are transparent pass/warn/fail with editable thresholds.
- **Multi-part loans.** Up to ten parts with one consolidated ledger, for example China
  组合贷 or a US 80/10/10 piggyback.
- **Deposits and savings.** Contributions, withdrawals, tax on interest, APY/AER and the real
  return.
- **Inflation.** The real cost of a loan and the real value of a deposit.
- **Region profiles.** US, UK, EU, CN, UA and International defaults. You can override every
  value.
- **Productivity.** Saved scenarios, history, presets, a glossary, and shareable links that
  carry the scenario in the URL fragment, which is never sent to a server.
- **Reports and exports.** Print/PDF, XLSX, DOCX, CSV, a flat CSV for ERP import, and JSON.
- **Experience.** Dark, light and system themes, a responsive layout, an installable PWA, and
  a single self-contained HTML file.

Out of scope for v1: accounts or any server, live market rates, tax-law calculators,
revolving credit and leasing.

## Privacy

- **No server.** LoanLogic is a static web app. All calculation happens on your device.
- **No tracking.** There are no analytics, no telemetry and no third-party scripts.
- **No runtime network requests.** Everything is bundled, including the Inter font. Nothing is
  loaded from a CDN.
- **Your data stays on your device.** Settings such as language and theme are kept in your
  browser's `localStorage` under the `loanlogic:` namespace.
- **Offline single file.** `npm run build:single` produces `dist-single/LoanLogic.html`. It
  opens straight from disk (`file://`) without an internet connection, which helps in
  restricted networks.

## Languages

English, 简体中文, Русский and Українська. On first visit LoanLogic picks the first supported
language from your browser settings and falls back to English. You can switch at any time
without a reload, and your choice is remembered. Numbers, dates and currencies are formatted
for the locale, using en-US, zh-CN, ru-RU and uk-UA by default. Region profiles will override
these defaults in a later task.

## Development

Requirements:

- Node.js **22.22.2+ (22.x LTS) or 24.15+ (24.x LTS)**, or 26 and later (see `engines` in
  `package.json`; the toolchain, e.g. jsdom, needs these minimums). [`.nvmrc`](.nvmrc) selects
  the latest 24 LTS.
- npm, which comes with Node.js.

```sh
npm ci                                   # install exact versions from package-lock.json
npm run dev                              # start the dev server
npx playwright install chromium webkit   # once, before running the e2e tests
npm run check                            # what must pass before a pull request
npm run e2e
```

### Scripts

| Script                   | What it does                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server with hot reload.                                                                                                                |
| `npm run build`          | Production build of the multi-file site into `dist/`. The base path is `/LoanLogic/` (for GitHub Pages); override it with `BASE_PATH`.                    |
| `npm run build:single`   | Build one self-contained file, `dist-single/LoanLogic.html`, that works offline from `file://`.                                                           |
| `npm run preview`        | Serve the production build from `dist/` locally.                                                                                                          |
| `npm run lint`           | ESLint: type-aware TypeScript rules, jsx-a11y and engine purity rules. Any warning fails.                                                                 |
| `npm run format`         | Format the repository with Prettier.                                                                                                                      |
| `npm run format:check`   | Check formatting without changing files.                                                                                                                  |
| `npm run typecheck`      | `tsc --noEmit` for the app, the engine and the Node tooling projects.                                                                                     |
| `npm test`               | Run the unit and component tests once (Vitest).                                                                                                           |
| `npm run coverage`       | Run the tests with a V8 coverage report in `coverage/`.                                                                                                   |
| `npm run e2e`            | Run both builds, then the Playwright end-to-end and axe accessibility tests in Chromium and WebKit.                                                       |
| `npm run check:spdx`     | Check that every source file starts with the SPDX license and copyright header.                                                                           |
| `npm run check:licenses` | Check the license of every installed package against the allowlist.                                                                                       |
| `npm run check:size`     | Check that the initial JavaScript stays within the gzip budget (60 KiB at this stage). Run it after `build`.                                              |
| `npm run check`          | Everything a pull request needs: lint, format check, typecheck, SPDX and license checks, tests with coverage thresholds, both builds and the size budget. |

### Project layout

```text
src/
  engine/      financial engine: pure, deterministic TypeScript (placeholder until T02)
  app/         UI: state/, components/, panels/, layout/, storage.ts, main.tsx
  i18n/        locales/{en,zh-CN,ru,uk}.json, format.ts, index.ts
  export/      reports and exports (placeholder until T14–T15)
  styles/      design tokens, themes, base styles, bundled fonts
  config.ts    app name, author, source-code URL
tests/
  vectors/     golden test vectors (generated by tools/reference)
  e2e/         Playwright specs
tools/
  reference/   independent reference implementation used to generate the vectors
scripts/       repository checks (SPDX, licenses, bundle size) and Vite plugins
docs/          plan, financial specification, design system, glossary, task briefs
```

## Documentation

- [`docs/PLAN.md`](docs/PLAN.md): scope, architecture, milestones and Definition of Done.
- [`docs/SPEC-finance.md`](docs/SPEC-finance.md): the financial methodology. It is normative:
  where the code and the SPEC disagree, the SPEC wins.
- [`docs/DESIGN.md`](docs/DESIGN.md): the design system ("Graphite Ledger").
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md): financial terms in English, Chinese, Russian and
  Ukrainian.
- [`tools/reference/`](tools/reference/): the independent reference implementation that
  generates the golden test vectors in [`tests/vectors/`](tests/vectors/).
- [`docs/tasks/`](docs/tasks/): task briefs and their acceptance criteria.
- [`CLAUDE.md`](CLAUDE.md): the rules every change follows, whoever writes it.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before you open an issue or a pull request. Work is
organized as tasks assigned by the owner. Each task has one branch and one pull request.

## License

LoanLogic is free software, licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`).

Copyright (C) 2026 Mortlake. See [`LICENSE`](LICENSE) for the full text. If you run a modified
version for other people over a network, the AGPL requires you to offer them its source code.
The app's footer links to the source for this reason.

Notices for third-party code bundled into the app are generated at build time into
`THIRD-PARTY-NOTICES.txt` (in `dist/` and `dist-single/`). They are also embedded as an HTML
comment in the single-file build.

## Disclaimer

LoanLogic is for information only. It is not financial, legal or tax advice. Results may differ
from your lender's figures, so check important numbers with your lender. The software comes
without any warranty; see the license for details.
