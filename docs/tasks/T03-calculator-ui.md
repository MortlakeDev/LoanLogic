# T03 — Calculator UI: design tokens, inputs, results summary, schedule table, explain

- **Milestone:** M2 · **Status:** ready (T02 is merged, PR #4)
- **Depends on:** T02 (engine), R2 (`docs/DESIGN.md`, `docs/GLOSSARY.md`) · **Blocks:** T04, T05, T07
- **Branch:** `task/T03-calculator-ui`

## Goal

The first working LoanLogic: a person enters a loan and sees the exact payment, the
headline cost-of-credit rate, the totals and the full schedule, live as they type, in
four languages, both themes, on desktop and on a 360 px phone — built to
`docs/DESIGN.md`. Charts come in T04, region profiles, presets and persistence in T05.

## Scope

### 1. Design system in code (DESIGN §3–§6, §10, §13)

- `tokens.css`: the colors and shadows of DESIGN §3.2, the type steps of §4.2, the radii,
  control sizes and layout widths of §5 and `--duration-slow` of §6 (also set to 0 by the
  reduced-motion rule in `themes.css`). Extend `tokens.test.ts`: button-primary fg/bg
  ≥ 4.5:1; chart series on `surface-1` ≥ 3:1; the new tokens exist in both themes.
- Browser baseline (DESIGN §12): set Vite `build.target` and `build.cssTarget` to
  `['chrome111', 'edge111', 'firefox116', 'safari16.4']`, add the same `browserslist` to
  `package.json` and `eslint-plugin-compat` (MIT) to the lint config. None of the APIs
  DESIGN §12 lists as not allowed may be used.
- Fonts: replace Inter with `@fontsource-variable/onest` and
  `@fontsource-variable/jetbrains-mono`, loading only the subsets of DESIGN §4.1; update
  `FONT_PACKAGES`; third-party notices list both. Report the size of
  `dist-single/LoanLogic.html` before and after.
- Wordmark and favicon from `docs/design/wordmark.svg` and `docs/design/favicon.svg`
  (the wordmark becomes a component: "Loan" in `currentColor`, "Logic" in
  `--color-accent`, accessible name "LoanLogic"). Keep the OFL attribution comment.
- Icons: a small inline-SVG icon module with the set of DESIGN §10.

### 2. App frame (DESIGN §7)

- Header: wordmark + "by Mortlake"; language select (pill style, endonyms); theme as an
  icon button that opens a small menu with a three-option radio group (System / Dark /
  Light) — `aria-expanded`, Esc closes, focus returns to the button. Build it with
  ordinary elements, not the HTML `popover` attribute (DESIGN §12). The region pill
  and Share arrive in T05/T15; do not show placeholders.
- Mobile header: wordmark, menu button opening a sheet with language and theme.
- Page glow (DESIGN §2), footer as today.

### 3. Inputs panel (DESIGN §8.2–§8.5)

State lives in `src/app/state` as signals; components hold no business logic.

- **Loan:** amount with a currency select (ISO codes of the engine's table, the common
  ones first: USD, EUR, GBP, CNY, UAH, JPY, CHF, CAD, AUD, PLN, then A–Z); interest rate
  (%), hint "Nominal, per year"; term in years + months with the hint "N payments".
- **Payment frequency:** solid segmented control, 3 × 2 (DESIGN §8.3).
- **Repayment:** four choice cards; Balloon reveals a residual input with an amount / %
  switch.
- **Disbursement date:** native date input (default: today, taken at the UI boundary),
  hint "First payment …".
- **Fees & insurance:** a list editor. "+ Fee" adds a row: name, kind (upfront /
  periodic / insurance), calculation (fixed / % of amount / % of balance; upfront: fixed
  / %), value, financing (upfront only: paid at closing / added to the loan) and
  "In {rateName}" (GLOSSARY §4). Each row shows its computed amount in the hint line.
- **Advanced** (disclosure with a status line): term defined by years and months /
  number of payments / end date; interest model (periodic with compounding, or day count
  with method and payment basis); rounding (interest, payment policy, fees, principal
  remainder for equal principal); end-of-month rule (shown only when the disbursement
  date is a month end); headline rate method (see §6).
- Number entry follows the user's formatting locale and is parsed into the engine's
  decimal strings by a new i18n helper `parseDecimalInput(text, locale, kind)`; fields
  reformat on blur only. Rules:
  - accept the locale's decimal and grouping separators (including NBSP and narrow
    NBSP), and "." as the decimal separator when it is not the locale's grouping
    separator (iOS shows the device region's decimal key);
  - grouping is valid only between groups of three digits;
  - rate and percent fields (`kind: 'percent'`) take no grouping and accept "." or ",";
  - accept U+2212 (−) as the minus sign;
  - anything else is a localized `INPUT_INVALID`, never a guess ("6.875" in de-DE is
    6.875 in a percent field; in an amount field it is invalid, not 6875).
  Unit tests cover en-US, de-DE, ru-RU, uk-UA and zh-CN.

### 4. Results (DESIGN §8.6–§8.10, §8.13)

- Live recalculation: every valid change recomputes through `calculateLoan` (one
  computed signal); no "Calculate" button. Measure the input-to-paint time for a
  1 200-period loan and report it in the PR: a Playwright test in Chromium on the CI
  runner (`ubuntu-latest`) times a change of the amount field until the next paint of
  the payment (`performance.now()` and `requestAnimationFrame`), median of 5 runs. The
  100 ms target is informational, not a CI gate; if the median exceeds it, propose
  moving the engine to a Web Worker in the PR rather than doing it.
- **Payment hero:** label by frequency, hero number split with `formatToParts` (new
  `formatMoneyParts` helper), meta line, formula strip built from the engine's `explain`
  values so that it reproduces the instalment (DESIGN §8.6, SPEC §9.6), "How it's
  calculated →".
- **Regional rate card:** the headline method's name, source badge, value with the
  method's precision, the "includes …" line built from the fees with `inApr`, the
  contract rate and the secondary rate of DESIGN §8.7.
- **KPI tiles:** total interest, total cost of credit, total of payments.
- **Cost structure** bar with legend, using the figures and the ratio rule of DESIGN
  §8.9.
- **Schedule table** (DESIGN §8.10): year groups with subtotals, first year expanded,
  "Show N more payments", collapsed years, totals row, reconciliation note driven by the
  engine's invariant checker. Mobile shows the list form (DESIGN §7.2) with a "Yearly
  summary" toggle.
- **Explain sheet** (DESIGN §8.12) for the instalment and every displayed rate.
- **States:** inline field errors from engine error codes (localized; every code of
  SPEC §13 has a message in all four languages, and the field path selects the input);
  invalid input blanks the results at once and shows "Fix the highlighted fields" after
  300 ms (DESIGN §8.13); engine warnings as a notice under the hero; "n/a" for failed
  rates.
- **Engine results to handle (SPEC v0.2.2):**
  - every formula id of SPEC §9.6, including `instalment.annuity-exact-basis`: the exact
    day-count payment basis has no single periodic rate, so its strip shows the rate per
    period, `r_k = j × YF_k`, with the day-count method instead of `i`;
  - negative amounts: with a negative rate a payment can be negative (§3.4), and with
    the exact payment basis a row's principal can be negative (§5.1). They are shown with
    a minus sign, and no component assumes an amount is positive;
  - `params` of an error or warning is a record whose values are all strings (§13):
    numbers are decimal strings (`paymentsCount: "242"`) and `methods` is a
    comma-separated list of method ids; parse each value before formatting it with the
    i18n helpers;
  - `TOO_MANY_DECIMALS` on a money field means an amount that is not a whole number of
    the currency's minor units ("100.100" USD is fine, "100.005" USD is not, SPEC §1.2);
    on a percentage field it means a value that is not a multiple of 10⁻¹⁰ (trailing
    zeros such as "6.50000000000" are fine);
  - `FEE_RANGE` on `fees` means the upfront fees paid at closing add up to at least the
    requested amount (financed fees do not count): it belongs to the fees section, not
    to one fee;
  - `NEG_AMORTIZATION` names the first period with a negative principal
    (`params.period`) and suggests a fix that fits the loan: the exact payment basis for
    a day-count annuity, the periodic interest model for a day-count balloon (the exact
    basis is `UNSUPPORTED` there), a finer payment rounding in the periodic model;
  - a failed rate (`IRR_NO_CONVERGENCE`) shows "n/a" with its localized reason (SPEC
    §10): no root in the solver range (a rate from −99 % to 10⁹ %), or a result computed
    from the root beyond ±10⁹ %.
- Mobile: summary card first, compact sticky bar when it scrolls away, scroll padding
  for the sticky bars (DESIGN §7.2). Desktop: the sticky inputs panel scrolls on its own
  (DESIGN §7.1).

### 5. i18n

All strings in en, zh-CN, ru, uk with the terms of `docs/GLOSSARY.md`; plural forms for
"N payments", "N more payments", "N more years".

### 6. Headline rate until T05

T05 introduces region profiles. Until then the headline method follows the currency:
USD → `usRegZApr`; GBP → `ukAprc`; EUR and the other EU currencies (PLN, CZK, HUF,
RON, SEK, DKK) → `euAprc`; CNY → `cnAnnualized`; UAH → `uaRealAnnual`; any other →
`international`. Advanced lets the user choose any method. Keep this mapping in one
module so T05 can replace it.

## Out of scope

Charts (T04); region profiles, presets, URL and local persistence (T05); events (T07);
comparison and other tabs (M4–M5); exports and Share (T14–T15).

## Tests

- Component tests for each input group (values reach the engine input exactly; e.g.
  "350 000,50" in ru-RU becomes `"350000.50"`), the theme popover, the fee editor, the
  schedule grouping (subtotals equal the sum of rows exactly).
- e2e (Chromium + WebKit):
  - The design scenario — 350 000.00 USD, 6.875 %, 30 years, 1 % origination fee paid at
    closing in APR, disbursed 2026-11-01 — shows `$2,299.25`, final `$2,300.28`, APR
    `6.974%`, total interest `$477,731.03`, and year 1 subtotals `3,641.84` /
    `23,949.16` (golden vector `us-mortgage-30y-origination-fee`).
  - The CN scenario in zh-CN (golden vector `cn-mortgage-30y-equal-instalments`) shows
    `¥4,270.16`, 年化利率（单利） `3.10%` and 年化利率（复利，IRR 法） `3.14%`.
  - Typing an invalid term shows the localized error and no stale numbers; fixing it
    restores results.
  - axe: no serious or critical violations, dark and light, 360 px and 1 280 px, all
    four languages; no horizontal scroll at 360 px.
- `npm run check` budgets: initial JS ≤ 150 KB gzip (report the number).

## Acceptance criteria

- [ ] The UI matches DESIGN.md in both themes at 1 280 px and 360 px (screenshots in the
      PR: desktop dark/light, 360 px dark/light, and one zh-CN 360 px).
- [ ] Every calculated figure on screen comes from the engine, and every number is
      formatted by the i18n helpers;
      the two e2e scenarios show the exact golden-vector figures.
- [ ] Live recalculation without a button; invalid input never shows stale results.
- [ ] Every engine error and warning code has a natural message in all four languages.
- [ ] Accessibility checklist of DESIGN §11 passes; keyboard-only use works end to end.
- [ ] Fonts switched with notices updated; single-file build still works offline.

## Notes

- Every calculated figure on screen (payments, totals, rates, schedule values) comes
  from the engine; inputs show what the user entered. Components never compute money
  or rates themselves.
- `docs/DESIGN.md` and `docs/GLOSSARY.md` are normative: report a gap or a
  contradiction in the PR instead of inventing a style or a term.
- Never edit the vector JSON or read `tools/reference` code; a figure that looks wrong
  is reported against the SPEC.

## Completion notes

**Status:** in review, [PR #8](https://github.com/MortlakeDev/LoanLogic/pull/8)
(branch `task/T03-calculator-ui`).

**Acceptance criteria (local evidence, 2026-10-20, Windows, Node 24.19):**

- Screenshots of the built app (design scenario disbursed 2026-11-01; the zh-CN one is the
  CN scenario) are in [`T03-screenshots/`](T03-screenshots/): desktop dark and light at
  1 280 px, 360 px dark and light, zh-CN 360 px dark.
- Every figure comes from the engine result or `src/app/state/derived.ts` (exact BigInt
  sums for subtotals, totals, shares and the ratio) and is formatted by `display.ts` and
  the i18n helpers. The e2e scenarios pin the golden figures to their elements: hero
  `$2,299.25`, final `$2,300.28`, APR `6.974%`, total interest `$477,731.03`, year 1
  `3,641.84` / `23,949.16`; zh-CN `¥4,270.16`, 年化利率（单利） `3.10%`,
  年化利率（复利，IRR 法） `3.14%`.
- Live recalculation through one computed signal; a field that does not parse or an
  engine error blanks every figure at once, and "Fix the highlighted fields" with a list
  of linked errors appears after 300 ms without typing (and is announced).
- Every SPEC §13 error code and every warning has a message in en, zh-CN, ru and uk;
  parameters are parsed from their strings and formatted by Intl.
- `npm run check` passes: 2 678 unit tests, coverage 99.67 % statements, 98.96 %
  branches, 99.86 % functions. `npm run e2e` (Chromium + WebKit): 224 passed, 10 skipped
  (the known WebKit-on-Windows and forced-colors cases). axe: no serious or critical
  violation in both themes at 360 and 1 280 px in all four languages, plus Advanced open,
  the Explain sheet open and the error state; no horizontal scroll at 360 px with the fee
  editor and Advanced open.
- Initial JS 81.5 KiB gzip (budget raised from 60 to the brief's 150 KiB).
  `dist-single/LoanLogic.html`: 351 753 bytes (gzip 242 727) before, 538 651 bytes
  (gzip 253 297) after — most of the growth is the two font families in base64.
- Input-to-paint of a 1 200-period loan (Chromium, median of 5, informational): 62–86 ms
  on the development machine; the CI number is in the PR.

**Engine and i18n additions:**

- `calculateLoan` returns `fees: FeeAmount[]` (amount and total of every fee and
  insurance item, SPEC §8.1 allows per-item amounts), so fee hints and the "Includes …"
  line need no money math in the UI. `parseIsoDate` and `isLastDayOfMonth` are exported
  for the UI boundary.
- `parseDecimalInput(text, locale, kind)`, `formatMoneyParts`, `formatMonthYear`,
  `formatCurrencyName`; `formatNumber` takes `maximumSignificantDigits` and
  `roundingPriority`.

**Decisions and deviations (to confirm or correct):**

1. Rate failures show "n/a" with the reason as visible text, not a tooltip (DESIGN §8.13):
   a hover tooltip fails keyboard and touch users.
2. The hero figure is the instalment (principal + interest) for every repayment type, so
   the formula strip reproduces it, and "final payment" uses the same basis; when payments
   carry periodic fees or insurance, the meta line adds "first payment $… with periodic
   fees" (or "with insurance", or both). DESIGN §8.6 does not say which basis the hero
   uses with periodic fees.
3. The loan amount uses `--font-size-lg` (18 px) below 30rem: with the currency select
   beside it, `--font-size-amount` does not fit "1,000,000.00" at 360 px. DESIGN §4.2 has
   no phone step; the alternative is the currency select under the amount.
4. The currency select has an accessible name ("Currency") but no visible label: DESIGN
   §11 asks for one, the concept render shows a bare chip. Without a visual change the
   amount and currency could become a fieldset with "Loan amount" as its legend (the
   pattern of the term field).
5. The schedule card shows a heading instead of tabs (only implemented tabs are shown);
   Fees and Insurance columns, when present, sit between Interest and Balance.
6. The language pill has no globe icon (DESIGN §7.1 gives the globe to the region pill of
   T05); selects use the chevron-down icon; disclosures slide with `--duration-normal`.
7. The headline-rate select shows the source when two methods share a name ("APR · Reg Z
   · US", "APR · FCA · UK"). Until presets exist, `ukAprc` is called "APR" (the consumer
   credit name of GLOSSARY §6).
8. Each item of "Fix the highlighted fields" names its field ("Loan amount: …").
9. The mobile summary carries "How it's calculated" (the desktop hero with the formula
   strip is hidden on phones, DESIGN §7.2).
10. ru/uk "In {rateName}": GLOSSARY gives «Входит в расчёт ставки» / «Враховується у
    ставці» without the rate's name; the catalog keeps the placeholder in brackets. The
    ru/uk add-fee button reads «Добавить комиссию» / «Додати комісію» so its visible text
    is part of its name (WCAG 2.5.3).
11. Codes written the same in every language (XIRR, APR, APRC, IRR) are listed in the
    locale test instead of being translated.
12. Under `prefers-reduced-motion` transitions now last 0 s (T01 used 0.01 ms): a running
    transition of an inherited property kept freshly opened disclosure content hidden
    from Tab and from focus for a moment.

**SPEC and GLOSSARY questions:**

1. `instalment.equal-principal` and `instalment.bullet` cannot reproduce the hero figure:
   equal principal shows `q`, while the hero shows the first payment `q + I_1`; the
   bullet payload has `I1` but no `j`, `m` or `i`, so `I_1` cannot be derived. A
   first-payment payload (or `i` for the bullet) would let the strip reproduce the result
   as DESIGN §8.6 asks. With one payment, an interest-only loan's hero is principal +
   interest while its strip ends at `I_1`.
2. GLOSSARY §6 has no name for `irrNominal`; the UI uses "Nominal IRR (r × m)".

**Open items:** the CI value of the input-to-paint median; a native-speaker review of the
zh-CN, ru and uk strings (GLOSSARY status).
