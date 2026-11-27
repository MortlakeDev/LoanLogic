# T04a — Chart follow-ups from the T04 review

- **Milestone:** M2 · **Status:** done (PR #18)
- **Depends on:** T04 ✓ · **Blocks:** —
- **Branch:** `task/T04a-chart-followups`

## Goal

Close the four code and test findings of the last review round of T04 (CodeRabbit on
`fc77e6d`, PR #14). The architect accepted them as minor so that T04 could land. Each is
small; together they make the pointer, keyboard focus and tooltip placement right in the
edge cases the review found.

## Scope

1. **Line markers let the pointer through (`charts.css`).** On a line view the marked
   point's markers (`.chart__marker`, radius `MARKER_R` = 4 px) are painted over the
   previous point's hit column. When points are closer than a marker's diameter (for
   example 100 loan years at 360 px), moving the pointer left across a marker keeps the
   old point and its tooltip. Add `.chart__marker` to the rule that makes the lines, the
   annotation and the focus ring pointer-transparent (and to its comment), so only the
   hit columns (`.chart__hit`) decide which point owns the pointer. The markers stay
   visible.
2. **No stale keyboard focus after a recalculation (`ChartFigure.tsx`).** The effect
   keyed by `last` clears `hovered` when the buckets shrink, but not `focused`. A bar
   removed while it has focus does not reliably get a `blur`, so `focused` can keep its
   index, and when the buckets grow again the focus ring and the tooltip come back
   without DOM focus. Clear `focused` in the same effect with the same out-of-range
   check; a focus that stays in range is kept. Update the comment above the effect.
3. **Tooltip at the chart's top edge (`placeTooltip`, `layout.ts`).** When the tooltip
   comes over its mark, it goes to the usual top (`TOOLTIP_TOP`), below the mark or to
   the chart's bottom, whichever covers the least of the mark. Sometimes none of them
   clears the mark while the chart's top edge would: in a 200 px chart, a 100 px tooltip
   over a focus box at y = 100–116 goes to y = 4 and covers 4 px of the box; at y = 0
   it covers none. Add 0 as the last candidate, so the usual positions stay preferred
   when they clear the mark (a tie keeps the earlier candidate), and update the doc
   comment.
4. **Label-spacing test at the laid-out size (`ChartCard.test.tsx`).** The
   `long-term-1200-payments` test checks the x labels' bounds and spacing with
   `estimateTextWidth(…, LABEL_PX)`, 12 px, while the chart lays the labels out at their
   rendered size (`useLabelPx`: the computed font size of a tick, 16 px in jsdom), so
   two labels that overlap at 16 px can pass at 12 px. Estimate the labels at the size
   the chart uses, read the way `useLabelPx` reads it (share a small helper rather than
   copy it), with `LABEL_PX` when there is none.

## Tests

- **e2e (Chromium and WebKit):** at 360 px, on a line view of a loan whose points are
  closer than a marker's diameter, hover a point, then move the pointer onto the part of
  its marker that lies over the previous column: the previous point gets the tooltip.
  The computed `pointer-events` of `.chart__marker` is `none`, as the keyboard test
  already checks for the focus ring.
- **Component:** reproduce the stale index (the focused bar removed by a recalculation
  with fewer buckets, with no `blur`, then the buckets grow again): with nothing
  hovered, no `.chart__focus` and no tooltip. A focused bar that stays in range keeps
  its ring through the same recalculation.
- **Unit (`layout.test.ts`):** the 200 px case above gives top 0; the existing placement
  cases keep their positions.
- **Control runs:** each new or changed test fails without its fix; say so in the pull
  request, as in the T04 review follow-up.

## Acceptance criteria

- [x] Moving the pointer across a line marker gives the tooltip to the point whose
      column is under the pointer.
- [x] After the buckets shrink and grow again, a stale focus brings back neither the
      focus ring nor the tooltip (hovering a mark still shows its tooltip); a focus that
      stays in range keeps its ring.
- [x] When the usual positions cover the mark, the tooltip goes to the chart's top edge
      if that covers less of it.
- [x] The label-spacing test estimates the labels at the size the chart lays them out
      with.
- [x] `npm run check` and `npm run e2e` pass; no golden vector changes; initial JS stays
      within budget.

## Notes

- The two other findings of that round were corrections to the T04 completion notes;
  the architect made them in `T04-charts.md`.
- No SPEC, DESIGN or GLOSSARY change and no new strings.
- T05 touches other files; if it lands first, merge `main` into this branch before the
  pull request.
- Keep the change small; anything larger found on the way goes into the PR as a
  proposal.

## Completion notes

**Status:** done, merged in [PR #18](https://github.com/MortlakeDev/LoanLogic/pull/18)
on 2026-11-27 UTC (branch `task/T04a-chart-followups`, from `main` at `806cacb`). The
architect accepted it without changes: CI green, no CodeRabbit findings.

**Acceptance criteria (local evidence, 2026-11-23, Windows, Node 24.19):**

- Line markers: `.chart__marker` joins the lines, the annotation and the focus ring in
  the `pointer-events: none` rule of `charts.css`. The e2e test (360 px, Chromium and
  WebKit) uses a 100-year loan in the balance view, where a marker (8 px across) is
  wider than a point's column (the test asserts this):
  - the pointer hovers year 51, then moves onto the part of its marker that lies over
    year 50's column, and year 50 gets the tooltip;
  - the marker of the newly marked point computes `pointer-events: none`.
- Stale focus: the effect keyed by `last` in `ChartFigure.tsx` now drops a focus past
  the last bucket, as it already did for a hover. Component tests:
  - bar 30 has the focus state without DOM focus (so no blur follows), then the term
    goes to 20 years and back to 30: no `.chart__focus` and no tooltip, and hovering
    bar 30 still shows its tooltip;
  - a focused bar 5 keeps its ring through the same recalculation.
- Tooltip at the top edge: `placeTooltip` tries 0 as its last candidate. Unit tests:
  - the brief's case (a 100 px box over a mark at 100–116 in a 200 px chart) gives
    top 0;
  - a mark that the usual top already clears keeps top 4 (a tie keeps the earlier
    candidate);
  - the existing placement cases are unchanged.
- Label spacing: `renderedLabelPx` (exported from `ChartFigure.tsx`) reads the computed
  font size of a rendered tick, `null` when there is none. `useLabelPx` and the
  `long-term-1200-payments` test both use it, the test with `LABEL_PX` when there is
  no tick.
- `npm run check` passes: 2 923 unit tests, coverage 99.47 % statements, 98.31 %
  branches. Initial JS is 91.92 KiB gzip (+0.03 KiB) of the 150 KiB budget.
- `npm run e2e`: 349 passed, 15 skipped (the WebKit cases the suite skips on purpose).
- `generate.py --check`: 106 vectors, unchanged.

**Control runs:** each fix was undone in a copy of its file, which was restored byte
for byte afterwards.

- Without `.chart__marker` in the rule, the e2e test fails in Chromium and WebKit: the
  tooltip stays on "Year 51".
- Without dropping the focus, the stale-focus test fails. Dropping the focus
  unconditionally fails the keep-in-range test.
- Without the 0 candidate, the top-edge test fails; the existing placement tests pass.
- With the labels laid out at 12 px whatever their rendered size, the new label tests
  fail at 360 and 1 280 px. The old `long-term-1200-payments` test from `main` passes
  in the same run, which shows it missed the case.

**Decisions:**

1. `renderedLabelPx` stays in `ChartFigure.tsx`, next to `useLabelPx`, its other user:
   no new module for one function.
2. The ru/uk crossing-label wrap test in `ChartCard.test.tsx` had the same 12 px
   estimate, in its width check and in its first-baseline check. It now uses the
   laid-out size too. This goes one test beyond item 4, in the same file and with the
   same helper.
3. The stale-focus test sets the focus state with `fireEvent.focus`, without DOM focus.
   The removed bar then gets no blur in any environment, which is the case the brief
   describes.
4. In the e2e test the computed-style check runs after the pointer move. A run without
   the fix then fails on the behaviour (the tooltip stays on year 51), not on the style.
5. `useLabelPx`'s doc comment said that `LABEL_PX` applies in jsdom. jsdom computes
   16 px, so the comment now says `LABEL_PX` applies until a tick is rendered.

No SPEC, DESIGN or GLOSSARY change, no new strings and no new dependencies.
