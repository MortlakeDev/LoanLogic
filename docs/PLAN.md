# LoanLogic — Product & Engineering Plan

Status: v0.2 (2026-10-19) · Owner: Mortlake · License: AGPL-3.0-or-later

LoanLogic is a precise, private and good-looking loan & savings calculator for bank
professionals and for anyone in the US, UK, EU, China, Ukraine and beyond. It runs
entirely in the browser (no server, no tracking), works offline and is open source.

Normative financial rules live in [`SPEC-finance.md`](SPEC-finance.md), the design system
in [`DESIGN.md`](DESIGN.md) and the financial terms per language in
[`GLOSSARY.md`](GLOSSARY.md). Rules for the coding agent live in
[`../CLAUDE.md`](../CLAUDE.md). Task briefs live in [`tasks/`](tasks/).

---

## 1. Principles

1. **Exact to the cent.** Every schedule reconciles to the minor currency unit: each row,
   each column total, the final balance. Decimal arithmetic for money, never floats.
2. **Regionally correct.** The headline cost-of-credit figure follows the user's region:
   US APR (Regulation Z), UK/EU APRC, China 年化利率, Ukraine real annual rate, etc.
3. **Show the math.** Every number can explain itself: formula, inputs, substituted values.
4. **Live and fast.** Results update as you type; no "Calculate" button, no stale results.
5. **Private by design.** No network requests at runtime, no analytics, data stays on device.
6. **Accessible and international.** WCAG 2.2 AA, keyboard-first, en / zh-CN / ru / uk.
7. **No silent fallbacks.** If something cannot be computed or applied, say so clearly.

## 2. Users and key jobs

| User | Key jobs |
|---|---|
| Bank officer / loan advisor | Reproduce the bank's schedule to the cent; explain costs to a client; compare offers; produce a client-ready report (PDF/Excel); check affordability |
| Individual borrower | Understand the real cost (APR/APRC/年化利率); compare offers; plan prepayments; decide on refinancing |
| Analyst / small business | Multi-part loans, DSCR, ERP-friendly exports |
| Saver | Deposits with contributions, taxes, APY/AER, real (inflation-adjusted) return |

## 3. Feature catalogue

Milestone tags refer to §7. "Must" = required for v1.0.

### A. Loan calculator (core)

- **A1 Repayment types** — annuity (equal instalments, 等额本息), equal principal
  (等额本金), interest-only + bullet, balloon with residual (% or amount). *M1, Must*
- **A2 Term & frequency, separated** — term in years+months / number of payments / end
  date; payment frequency independent of term: weekly, bi-weekly, monthly, quarterly,
  semi-annual, annual (semi-monthly in M3). *M1, Must*
- **A3 Interest model** — nominal rate with compounding frequency (periodic default;
  e.g. semi-annual compounding for Canadian-style mortgages); day-count accrual:
  30/360 US, 30/360 ISDA, 30E/360, ACT/360, ACT/365F, ACT/ACT ISDA; payment basis
  "bank practice" or "exact amortization". *M1, Must*
- **A4 Rounding policy** — currency minor units (JPY 0, USD 2, KWD 3 …), rounding mode,
  payment rounding (to cent / up to cent / to whole units), last-payment adjustment. *M1, Must*
- **A5 Fees & insurance** — upfront fee (paid at closing or financed into the loan),
  periodic fees (fixed / % of original amount / % of outstanding balance), insurance,
  per-fee "included in APR" flag with regional defaults. *M1, Must*
- **A6 Dates** — disbursement date, first payment date, odd (irregular) first period,
  payment day / end-of-month rule. *M1 (regular) · M3 (odd first period), Must*
- **A7 Events** — prepayments (one-time, recurring, annual lump sum; reduce term or
  reduce payment; penalty / early repayment charge with free allowance), rate changes
  (fixed-then-variable, rate path; recalc payment or keep payment), payment holidays
  (interest-only / full / reduced; extend term or keep maturity; capitalized interest
  shown explicitly). *M3, Must*
- **A8 Results** — regular payment, first/last payment, totals (paid, interest, fees,
  cost of credit), payoff date, headline regional rate plus nominal and effective rates,
  interest and time saved by events. *M2, Must*
- **A9 Schedule table** — opening balance, interest, principal, extra principal, fees,
  payment, closing balance, cumulative totals; event markers; grouping by year with
  subtotals; virtualized for long schedules. *M2, Must*
- **A10 Charts** — payment composition over time, balance, cumulative principal vs
  interest, total-cost structure; event markers; theme-aware SVG. *M2, Must*
- **A11 Explain** — "How was this calculated?" for every headline number: formula with
  substituted values. *M2, Must*

### B. Comparison

- **B1 Repayment-type comparison** — same loan under every repayment type; nominal and
  present-value (NPV at a user discount rate) totals; always computed from the current
  scenario snapshot. *M4, Must*
- **B2 Offer comparison** — up to 5 offers side by side (rate, fees, term, type):
  regional rate, total cost, NPV, payment, winner per criterion. *M4, Must*
- **B3 Break-even reinvestment rate** — between any two plans/offers: the alternative
  return at which they are equal in present value (IRR of the difference stream), with
  a plain-language verdict. *M4, Must*
- **B4 Day-count comparison** — the same loan under each convention. *M4, Should*
- **B5 What-if** — quick sliders for rate, term and extra payment. *M4, Should*

### C. Prepayment, payoff, refinancing

- **C1 Invest vs prepay** — extra money: prepay the loan or invest at an expected
  return; wealth comparison at maturity (optional tax on investment gains). *M4, Must*
- **C2 Borrow vs pay cash** — compare paying now vs borrowing and investing the cash;
  decision threshold = the loan's all-in effective cost. *M4, Should*
- **C3 Payoff amount at a date** — balance + accrued interest + penalty. *M4, Must*
- **C4 Refinance** — current loan from the scenario (balance at a date) or manual; new
  loan of any type; exit penalty, new fees paid or financed, cash-out; simple and NPV
  break-even; lifetime difference; "longer-term trap" and "shorter-term win" verdicts.
  *M4, Must*
- **C5 Goal seek** — solve for amount, rate, term or payment; "implied rate from the
  bank's payment". *M4, Must*

### D. Affordability & risk

- **D1 DTI** front-end / back-end with correct normalization of any payment frequency
  to monthly. *M5, Must*
- **D2 LTV / CLTV** and down payment. *M5, Must*
- **D3 DSCR** for business loans (annual NOI / annual debt service). *M5, Must*
- **D4 Max loan** by income and limits (DTI or income multiple). *M5, Must*
- **D5 Stress test** — payment and DTI at rate + Δ. *M5, Must*
- **D6 Housing costs** — property tax, home insurance, HOA, mortgage insurance (PMI with
  automatic removal by LTV). *M5, Should*
- **D7 Checks panel** — transparent pass / warn / fail checks with the threshold and its
  source; thresholds editable; no opaque "score". *M5, Must*

### E. Multi-part loans

- **E1** N parts (≤ 10), each with its own amount, rate, type, frequency, term, fees and
  disbursement date; consolidated ledger by date; blended all-in rate. Covers syndicated
  tranches, China 组合贷 (commercial + housing provident fund), US piggyback 80/10/10.
  *M5, Must*

### F. Deposits & savings

- **F1** Initial deposit, term, rate, compounding frequency independent of term,
  capitalization or payout, regular contributions, withdrawals, tax on interest, early
  termination rate; APY (US) / AER (UK) / effective yield; real return. *M5, Must*
- **F2** Deposit vs alternative return; capitalization vs payout comparison. *M5, Should*

### G. Inflation / real value

- **G1** Real (inflation- or deflation-adjusted) cost of a loan and real value of a
  deposit using exact annual price-level discounting. *M4, Must*

### H. Region profiles

- **H1** Profiles: US, UK, EU, CN, UA, International. A profile sets currency, number &
  date format, headline rate method and precision, default frequency and accrual,
  affordability thresholds, product presets and glossary emphasis. Everything stays
  user-overridable. RU ПСК is available as an optional rate method. *M2, Must*

### I. Productivity

- **I1 Scenarios** — save / load / duplicate / delete (persisted locally); export &
  import JSON; shareable link (scenario encoded in the URL, no server). *M7, Must*
- **I2 History** — log of calculations with parameter diffs; restore; export. *M7, Should*
- **I3 Presets** per region (mortgage, auto, personal, student, business, deposit) with
  clearly labelled example rates. *M2, Must*
- **I4 Glossary** in four languages with contextual tooltips. *M7, Must*

### J. Reports & exports

- **J1 Print / PDF report** — dedicated print layout with summary, charts and schedule;
  works for every language including Chinese. *M6, Must*
- **J2 Excel (XLSX)** — summary, schedule (with formula totals and a check column),
  analysis; localized labels and number formats. *M6, Must*
- **J3 Word (DOCX)** — localized client report. *M6, Should*
- **J4 CSV** (localized, UTF-8 BOM), **flat CSV for ERP** (snake_case, ISO dates,
  plain numbers, no totals), **JSON** scenario file. *M6, Must*
- **J5 Share** — copy link; native share sheet on mobile (Web Share API). *M6, Should*

### K. Experience & platform

- **K1** System (default: follows the OS), dark and light themes; dark when the system
  states no preference; black/graphite/gray palette with one accent; charts follow the
  theme; adjustable density and font scale. *M2, Must*
- **K2** Responsive, mobile-first; sticky summary on small screens. *M2, Must*
- **K3** Live recalculation with inline, localized validation. *M2, Must*
- **K4** Accessibility WCAG 2.2 AA in both themes. *All milestones, Must*
- **K5** Languages: English, 简体中文, Русский, Українська; locale-aware numbers,
  dates and currencies; optional 万/亿 display for zh-CN. *M0–M2, Must*
- **K6** PWA (installable, offline) and a single self-contained `LoanLogic.html` for
  offline use and sharing in restricted networks. *M7, Must*
- **K7** About & legal: author Mortlake, license, source code link, disclaimer. *M0, Must*

### Out of scope for v1

Email sending; accounts or any server; live market rates (SOFR, LPR, SONIA) — entered
manually; tax-law calculators (stamp duty etc.); revolving credit (credit cards);
leasing; custom color themes (a theme editor); currencies outside ISO 4217 (custom
symbols); a composite "credit score" (D7 shows transparent checks instead). Any of these
may be reconsidered after v1.

## 4. Region profiles (defaults)

Preset rates are illustrative examples, labelled as such, and always editable.

| Profile | Currency | Format locale | Headline rate (method) | Display | Default schedule | Affordability defaults |
|---|---|---|---|---|---|---|
| US | USD | en-US | APR — Reg Z Appendix J actuarial | 3 dp | monthly, periodic | DTI 28/36 (43 legacy QM); LTV 80% (PMI above) |
| UK | GBP | en-GB | APR — CONC App 1.2 (consumer credit); APRC — MCOB 10A (mortgages) | 1 dp | monthly, periodic | income multiple 4.5×; LTV bands 60/75/85/90/95 |
| EU | EUR | user-selectable (de-DE, fr-FR, …) | APRC — Directive 2008/48/EC Annex I; Directive (EU) 2023/2225 Annex III from 2026-11-20 | 1 dp | monthly, periodic | configurable |
| CN | CNY | zh-CN | 年化利率（单利）— IRR × 12, with the IRR method (复利) beside it | 2 dp | monthly, 等额本息 / 等额本金 | payment ≤ 50% of income |
| UA | UAH | uk-UA | Реальна річна процентна ставка — XIRR | 2 dp | monthly, periodic | configurable |
| International | any | any | Effective all-in rate — XIRR | 2 dp | monthly, periodic | configurable |

Details and sources: SPEC-finance §9 and §11.11.

## 5. Architecture

### 5.1 Delivery

- **Static web app**, built to plain HTML/CSS/JS. Hosted on GitHub Pages.
- Two build outputs: `dist/` (multi-file site, PWA) and `dist-single/LoanLogic.html`
  (one self-contained file that works from `file://` without internet).

### 5.2 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Type safety for a large financial engine |
| Build | Vite | Fast, simple static output; single-file plugin |
| UI | Preact + @preact/signals | ~10 KB runtime, React-compatible knowledge, fine-grained reactivity for live recalculation |
| Money | decimal.js + BigInt rationals | Exact decimal arithmetic and rounding modes; exact rationals where a value must be exact at ties (SPEC §1.6) |
| Charts | Custom SVG components + d3-scale / d3-shape | Full design control, theme via CSS variables, crisp in print |
| Validation | valibot | Tiny schema validation for imports and URL state |
| Exports | ExcelJS, docx (lazy-loaded), print CSS for PDF | No CJK font embedding problems; small initial bundle |
| Tests | Vitest, fast-check, Playwright, axe-core | Unit, property-based, e2e, accessibility |
| Quality | ESLint, Prettier, GitHub Actions, CodeRabbit | Automated checks and reviews on every PR |

All dependencies must be AGPL-compatible (MIT, ISC, BSD, Apache-2.0; fonts OFL).

### 5.3 Layering

```
engine (pure TS, no DOM, deterministic; depends only on decimal.js)
   ↑
app state (scenario model, signals, persistence, URL state)
   ↑
UI components (inputs, results, table, charts, explain)
   ↑
exports (print, xlsx, docx, csv, json)
```

### 5.4 Repository layout

```
src/
  engine/        money, currency, date, frequency, daycount, rates, schedule/*, fees,
                 events/*, ledger, solvers, metrics/*, analytics/*, validate, index
  app/           state/, components/, panels/, charts/, layout/, main.tsx
  i18n/          locales/{en,zh-CN,ru,uk}.json, format.ts, index.ts
  export/        print/, xlsx.ts, docx.ts, csv.ts, json.ts
  styles/        tokens.css, themes.css, base.css
tests/
  vectors/       golden test vectors (JSON) — generated by tools/reference
  e2e/           Playwright specs
tools/
  reference/     independent reference implementation used to generate vectors
docs/            PLAN, SPEC-finance, DESIGN, GLOSSARY, design/ (reference renders, wordmark),
                 tasks/
```

### 5.5 Data model and persistence

- `Scenario` is a versioned, serializable object (profile, currency, formatting
  overrides, loan terms, fees, events, options). Schema migrations are explicit.
- `localStorage` (namespace `loanlogic:`) for settings, scenarios and history, with
  safe wrappers. Shareable links carry the scenario in the URL fragment
  (`#s=` + base64url of deflate-compressed JSON) — never sent to a server.

### 5.6 Budgets

- Initial JS ≤ 150 KB gzip (exports lazy-loaded); first render < 1 s on mid-range mobile.
- Engine recalculation ≤ 50 ms for a 1 200-period schedule; the UI reflects an input
  change within 100 ms.
- Lighthouse ≥ 95 for performance and accessibility.

### 5.7 Security, privacy, licensing

- No runtime network requests; strict Content-Security-Policy; imported JSON validated.
- AGPL-3.0-or-later; SPDX header in every source file; "Source code" link in the UI
  footer; third-party notices generated at build time.

### 5.8 Supported browsers

- Chrome and Edge 111+, Firefox 116+, Safari and iOS Safari 16.4+ (all released by
  August 2023). The baseline covers BigInt, `Intl.NumberFormat` v3 (`signDisplay:
  'negative'`, `roundingMode`), `color-mix()` and `:focus-visible`.
- T03 sets the build target and `eslint-plugin-compat` to this baseline (DESIGN §12);
  T18 adds a short "unsupported browser" notice.

## 6. Design direction

The design system is [`DESIGN.md`](DESIGN.md) ("Graphite Ledger", approved 2026-10-19):
black/graphite/gray surfaces with one lime accent for interest, cost, selection, focus and
links; Onest for the interface, JetBrains Mono for every amount and rate, the wordmark
drawn from Unbounded; dark-first with light and system themes; numbers right-aligned
and tabular; desktop two columns (sticky inputs, results), mobile stacked with a sticky
summary.

## 7. Milestones

| Milestone | Content | Tasks |
|---|---|---|
| **M0 Foundation** | Scaffold, tooling, CI, app shell, i18n, themes, deploy | T01 |
| **M1 Engine core** | Money, dates, day-count, 4 repayment types, fees, rate metrics incl. regional methods, solvers, invariants | T02 |
| **M2 Calculator UI** | Inputs, results, schedule table, charts, explain, region profiles & presets, live recalculation | T03, T04, T05 |
| **M3 Events** | Prepayments, rate changes, payment holidays, odd first period, payment day — engine + UI | T06, T07 |
| **M4 Analysis** | Type comparison, offers, break-even, what-if, invest vs prepay, borrow vs cash, payoff, refinance, goal seek, real value, day-count comparison | T08, T09, T10 |
| **M5 Affordability, multi-part, deposits** | DTI/LTV/DSCR, max loan, stress, housing costs, checks; multi-part loans; deposits & savings | T11, T12, T13 |
| **M6 Reports & exports** | Print/PDF, XLSX, DOCX, CSV, ERP CSV, JSON, share | T14, T15 |
| **M7 Productivity & release** | Scenarios, history, glossary, onboarding, PWA, single-file polish, performance, accessibility & visual QA, v1.0 | T16–T19 |

Architect deliverables (Cowork) that gate tasks:

| ID | Deliverable | Needed before |
|---|---|---|
| R1 | Reference implementation (`tools/reference`) + core vectors — delivered 2026-10-19 | T02 |
| R2 | Design concept → `DESIGN.md` + `GLOSSARY.md` — delivered 2026-10-19 | T03 |
| R3 | Event vectors (prepayments, rate changes, holidays, odd period) | T06 |
| R4 | Analytics vectors (comparison, refinance, goal seek, affordability, deposits) | T08–T13 |

## 8. Workflow

- **Architect (Cowork):** writes and maintains PLAN / SPEC / DESIGN, task briefs and
  reference vectors; reviews and accepts each task (tests, screenshots, spot checks).
- **Implementer (Claude Code):** one task → one branch `task/Txx-name` → one PR; follows
  `CLAUDE.md`; runs all checks; never invents financial rules — ambiguities are reported.
- **Reviewer (CodeRabbit):** automated review on every PR; comments are fixed or answered.
- **Owner (Mortlake):** approves scope and design, merges PRs.

Task lifecycle: brief in `docs/tasks/` → implementation PR → CI green → CodeRabbit
addressed → architect acceptance → merge → task file marked done.

## 9. Definition of Done (every task)

- Acceptance criteria in the brief are met; `npm run check` and `npm run e2e` pass in CI.
- New behavior covered by tests; engine changes pass property tests and golden vectors.
- All user-facing text in all four locales; no hardcoded strings.
- Accessibility checks pass in dark and light themes; layout works from 360 px width.
- Docs updated when behavior or architecture changes; SPDX headers present.
- PR description: summary, screenshots (UI), test evidence, new dependencies with
  license and size.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Misreading a regional rule | Sources cited in SPEC; vectors from regulator examples; "verify" flags; disclaimer |
| Float rounding errors | Decimal ledger; exact rationals at ties (SPEC §1.6); exact invariants; property tests; independent reference with tie guards |
| Scope creep | Milestones with Must/Should; v1 scope frozen in this plan |
| Bundle bloat | Lazy-loaded exports; size budget check in CI |
| Translation quality (zh-CN) | Shared glossary (`GLOSSARY.md`); native-speaker review before v1.0 |
| Spec ambiguity during coding | Implementer stops and reports; architect resolves in SPEC |
