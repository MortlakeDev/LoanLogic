# T04 — Charts (theme-aware SVG)

- **Milestone:** M2 · **Status:** brief ready; starts after T03 is merged
- **Depends on:** T03 · **Blocks:** T14 (the print report uses the same charts)
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

## Completion notes

_(to be filled by the implementer)_
