# T04a — Chart follow-ups from the T04 review

- **Milestone:** M2 · **Status:** ready (can run in parallel with T05)
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
  with fewer buckets, with no `blur`, then the buckets grow again): no `.chart__focus`
  and no tooltip. A focused bar that stays in range keeps its ring through the same
  recalculation.
- **Unit (`layout.test.ts`):** the 200 px case above gives top 0; the existing placement
  cases keep their positions.
- **Control runs:** each new or changed test fails without its fix; say so in the pull
  request, as in the T04 review follow-up.

## Acceptance criteria

- [ ] Moving the pointer across a line marker gives the tooltip to the point whose
      column is under the pointer.
- [ ] After the buckets shrink and grow again, no focus ring or tooltip shows without
      keyboard focus in the chart; a focus that stays in range keeps its ring.
- [ ] When the usual positions cover the mark, the tooltip goes to the chart's top edge
      if that covers less of it.
- [ ] The label-spacing test estimates the labels at the size the chart lays them out
      with.
- [ ] `npm run check` and `npm run e2e` pass; no golden vector changes; initial JS stays
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

_(to be filled by the implementer)_
