# T04 — Charts (theme-aware SVG)

- **Milestone:** M2 · **Status:** ready
- **Depends on:** T03 ✓, T03a ✓ · **Blocks:** T14 (the print report uses the same charts)
- **Branch:** `task/T04-charts`

## Goal

The chart card of DESIGN §8.11: clear, exact, accessible charts drawn as SVG with the
chart tokens, identical in quality on screen and in print.

## Scope

1. **Payments per loan year** (default view): stacked bars per loan year (payments
   (y − 1)·m + 1 … y·m, DESIGN §8.10) — principal (bottom), interest (top) and fees +
   insurance (a third segment only when non-zero); 2 px gaps between segments; y axis
   with nice ticks in compact notation; x labels every 5 years (every year when the loan
   has ≤ 10 years); annotation at the first loan year whose principal exceeds its
   interest, from the exact yearly sums ("Year 21 · principal overtakes interest" for
   `us-mortgage-30y-origination-fee`, 第 9 年 for `cn-mortgage-30y-equal-instalments`).
   Loans shorter than 2 years use one bar per payment and the label "Payment N".
2. **Balance over time:** the closing balance as a line (or step line) with the payoff
   date marked.
3. **Cumulative principal vs interest:** two lines; the crossing marked if it exists.
4. View switch: quiet segmented control in the card header; the legend names only the
   series of the current view.
5. Tooltip on hover and keyboard focus with the exact values (formatted by the i18n
   helpers from the engine's decimal strings: the tooltip never shows float sums).
6. "Show as table" toggle: an accessible table with the same aggregated values.

## Rules

- No chart library. d3-scale / d3-shape (ISC) are allowed only if they remove real
  complexity; report their gzip size in the PR. Scales, tick generation and the yearly
  aggregation are small pure functions with unit tests.
- Geometry may use floats; every number shown as text comes from exact decimal sums of
  the ledger (aggregate with decimal.js or the engine's helpers, not with `number`).
- Colors only through `--color-chart-*` tokens; works in dark, light, forced-colors
  (series stay distinguishable: in forced colors use the system colors plus a pattern or
  stroke style for interest) and print. Interest is always the top segment and the
  legend lists the series in stack order, so color is never the only cue.
- Each chart is a `<figure role="group" aria-roledescription="chart">` whose accessible
  name/description is the summary (e.g. "Interest falls from $23,949 in year 1 to $1,001
  in year 30 while principal rises …"). Bars are `role="img"` elements named like
  "Year 1: principal $3,641.84, interest $23,949.16", in a roving tabindex: one tab stop
  for the chart, arrow keys move between bars. Grid lines and axes are `aria-hidden`.
  The tooltip container is `aria-live="polite"`. (A focusable child inside `role="img"`
  would fail axe's `nested-interactive` rule.)
- Bars grow on first render with `--duration-slow` unless reduced motion is set; no
  animation on recalculation (the numbers change, the shape updates instantly).
- Responsive: the SVG fills the card; fewer ticks below 640 px; labels never overlap.

## Tests

- Unit: scales and ticks (including negative and zero values), yearly aggregation (the
  sum of the years equals the schedule totals exactly), crossover detection (none,
  first year, last year; US design vector year 21, CN vector year 9), label thinning.
- Component: each view renders the right number of bars/points for the golden vectors
  `us-mortgage-30y-origination-fee`, `bullet-monthly-interest-only`,
  `equal-principal-quarterly-fees`, `long-term-1200-payments` (no overflow, ≤ 100 bars).
- e2e: keyboard navigation through bars shows the tooltip; axe clean in both themes at
  360 and 1 280 px; forced colors (Chromium).

## Acceptance criteria

- [ ] Three views match DESIGN §8.11 in both themes (screenshots in the PR).
- [ ] Every number in charts and tooltips equals the schedule's exact values.
- [ ] Keyboard and screen-reader access; table alternative; reduced motion respected.
- [ ] Initial JS stays within budget (report the change in gzip size).

## Notes

- Yearly sums and every label come from exact decimal sums of the ledger; floats are
  for geometry only.
- If a chart needs data the engine does not expose, propose the addition in the PR
  rather than recomputing it in the UI.
- Housekeeping from the T03a review: restore the `\u00AD` escapes in
  `repayment.equalPrincipal` of `ru.json` and `uk.json`. Commit `baf86b7` wrote them as
  literal soft hyphens, which most editors do not show. The strings stay the same.

## Completion notes

**Status:** done, in review in [PR #14](https://github.com/MortlakeDev/LoanLogic/pull/14) (branch `task/T04-charts`). The branch also
carries the T03a housekeeping: `repayment.equalPrincipal` in `ru.json` and `uk.json` is
written with `\u00AD` escapes again, and a new `locales.test.ts` check fails on any
literal invisible character (soft hyphen, zero-width characters, BOM) in a locale file.

**Acceptance criteria (local evidence, 2026-11-01, Windows, Node 24.19):**

- Three views per DESIGN §8.11 in both themes:
  [`T04-screenshots/`](T04-screenshots/) has bars, balance and cumulative in dark and
  light at 1 280 px, the bars at 360 px and the table (2× pixel density, the design
  scenario disbursed 2026-11-01).
- Every number comes from the ledger's exact decimal strings:
  - yearly buckets reuse `scheduleYears` (BigInt sums; loan year y = payments
    (y − 1)·m + 1 … y·m);
  - a property test on random engine loans, plus all 69 calculating golden vectors,
    checks that the bucket sums equal `scheduleTotals` exactly and that principal +
    interest + fees = payments in every bucket;
  - the e2e test compares the tooltip and accessible name of all 30 bars with the
    schedule table's yearly subtotals;
  - the overtake year is 21 for `us-mortgage-30y-origination-fee` and 9 (第 9 年) for
    `cn-mortgage-30y-equal-instalments`;
  - axis labels format exact decimal tick strings (no float sums reach any text).
- Keyboard and screen readers:
  - the chart is a `figure` with `role="group"` and a localized `aria-roledescription`,
    named by the card title and described by a summary ("Interest goes from $23,949 in
    year 1 to $1,001 in year 30, principal from $3,642 to $26,591. Principal first
    exceeds interest in year 21.");
  - bars and points are `role="img"` ("Year 1: principal $3,641.84, interest
    $23,949.16") in a roving tabindex: one tab stop; arrows, Home and End move between
    them;
  - the tooltip shows on focus and on hover; it sits in an `aria-live="polite"`,
    `aria-atomic` region, can be hovered itself (SC 1.4.13) and Escape hides it;
  - "Show as table" (`aria-pressed`) swaps in a table with the same aggregated values;
  - axe finds no violations in any view or in the table, in dark and light at 360 and
    1 280 px;
  - in forced colors the chart uses system colors, interest bars keep a hatch, the
    interest line is dashed and the selected view shows in Highlight;
  - the bars grow in on their first render only, never on a recalculation, and not at
    all with reduced motion.
- Initial JS: 83.11 → 91.89 KiB gzip (+8.78 KiB), within the 150 KiB budget. No new
  dependencies (no chart library, no d3).
- `npm run check` passes: 2 922 unit tests, coverage 99.5 % statements, 98.35 %
  branches. `npm run e2e`: 347 passed, 15 skipped (the WebKit cases the suite skips on
  purpose: forced colors, the timing test, the known WebKit-on-Windows select and link
  cases). `generate.py --check`: 106 vectors, unchanged.

**Decisions:**

1. Code layout: `src/app/charts/` has `model.ts` (buckets, crossovers, stacks, value
   ranges), `scale.ts` (linear scale, nice ticks, x-label thinning, text width),
   `layout.ts` (geometry, tooltip placement, label wrapping), `labels.ts` (wording) and
   `view.ts` (signals). The components only render what these return. `formatMoneyCompact`
   (`src/i18n/format.ts`) and `moneyCompact` (`display.ts`) format the axis labels.
2. A loan with at least 2·m payments gets one bar per loan year; a shorter loan gets one
   bar per payment ("Payment N"), up to 103 bars for a weekly loan just under 2 years.
3. Stack order, bottom to top: principal, fees and insurance (only when non-zero),
   interest. Negative amounts stack downwards from zero. A non-zero segment thinner than
   1 px is drawn at 1 px, so a series named in the legend is always visible.
4. The annotation marks the first loan year whose principal exceeds its interest by
   exact comparison, year 1 included (an equal-principal loan gets "Year 1 · principal
   overtakes interest").
5. Balance view: one line with the payoff marked by a dot, a dashed line and "Paid off
   Nov 2056" (`summary.payoffDate`). Cumulative view: two lines; the crossing is marked
   only when interest led first (year 15 for the CN vector, none for the US one).
6. Line views draw one point per loan year (or payment) plus a starting point at x = 0
   (the opening balance, zero cumulatives). The starting point is drawn only: it is not
   focusable and not in the table.
7. The summary says "goes from … to …" rather than "falls" or "rises": the direction
   differs between repayment types.
8. View, table switch and "intro played" are module signals, so they survive invalid
   input (the card unmounts while there is no result). The intro plays once per
   session.
9. Only a real pointer move gives a bar the tooltip (boundary events also fire when
   content moves under a resting pointer); keyboard focus takes it over, Escape hides
   it, and on touch screens (`hover: none`) it lets taps through.
10. The geometry follows the rendered label size, so a larger browser font grows the
    margins and the SVG instead of squeezing the plot. Long annotation labels wrap; for
    Chinese they break between characters.
11. Shared change: in forced colors the selected segment of every segmented control now
    shows in Highlight (`components.css`). The variants' checked rules were more
    specific and won before, against DESIGN §8.3; this also affects the payment
    frequency control.
12. Print: only the tooltip is hidden; the print layout is T14.
13. e2e helpers `expectNoBlockingViolations` and `systemColor` moved into
    `tests/e2e/helpers.ts` for reuse by the chart spec.

**Open questions for the architect:**

1. Axis labels are compact currency with the symbol ("$30K", "¥5万", "30 тыс. ₽"), as
   the concept render's "$30k". DESIGN §8.11 lists "5万" and "30 тыс." without one.
   Which is intended?
2. The subtitle reads "Loan years 1–30 · 12 payments a year". The concept render adds
   the amount ("12 payments of $2,299.25 a year"), which holds only for level payments
   (not for equal principal, interest-only or a different final payment). Keep it
   without the amount?
3. The interest hatch (bars) and the dashed interest line appear only in forced colors;
   in normal mode the series are told apart by the stack order, legend and tooltip
   names, as the brief and DESIGN §8.11 say. The cost bar (§8.9) keeps its hatch in
   every mode. Should the chart match the cost bar?
4. The legend sits on its own row under the view switch and "Show as table"; the concept
   render, drawn before the switch existed, has it top right.
5. GLOSSARY: the uk view switch says «Залишок» (the full «Залишок заборгованості» does
   not fit a third of the switch at 360 px; the title, legend and tooltip keep the full
   term). Add the short form to GLOSSARY §2, or use the full term with soft hyphens?

No SPEC questions: the engine's rows and summary carry everything the charts need.
