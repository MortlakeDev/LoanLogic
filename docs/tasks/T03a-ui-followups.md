# T03a — UI follow-ups from the T03 review

- **Milestone:** M2 · **Status:** in review (PR #11)
- **Depends on:** T03 ✓ · **Blocks:** T04, T05 (they start after this small task)
- **Branch:** `task/T03a-ui-followups`

## Goal

Close the gaps that the review of T03 (PR #8) found: the formula strip must reproduce
the payment for every repayment type, the amount and its currency need a visible group
label, and the theme menu should behave like a standard menu. Two small defects seen on
the live site are fixed too.

## Scope

1. **Engine (SPEC v0.2.3 §9.6).**
   - `instalment.equal-principal` gains:
     - `p1` and `I1`, the principal and interest of the first row;
     - `first` = `p1 + I1`;
     - the rate behind `I1`: `j`, `m` (and `i` when `c ≠ m`) in periodic mode, or
       `j`, `dayCount` and `yf1` in day-count mode.
   - `instalment.bullet` gains `first` (`I1`, or `P + I1` when N = 1) and the same rate
     values.
   - The values are decimal strings like every explain value: exact when terminating,
     otherwise at least 12 significant digits.
2. **Formula strips and the Explain sheet (DESIGN §8.6, §8.12).** DESIGN §8.6 lists one
   branch per payload; the new parts are:
   - The interest of the first period: `I₁ = P × j ÷ m` when `c = m`, `I₁ = P × i`
     when `c ≠ m` (the payload then carries `i`), and `I₁ = P × j × YF₁` in day-count
     mode (`yf1`).
   - Equal principal: `q = R(P ÷ N)`, then `first payment = p₁ + I₁`.
   - Interest-only: `I₁`, plus `P` with a single payment.
   - The last number of every strip equals the hero, for every repayment type,
     compounding and accrual mode.
3. **Amount group (DESIGN §8.2, §11).** The amount and the currency select are one
   `fieldset` whose legend "Loan amount" is the visible label (it replaces the current
   label, no other visual change). The select keeps the accessible name "Currency".
4. **Theme menu (DESIGN §7.1).**
   - A click, Enter or Space applies the choice and closes the menu.
   - The arrow keys only move between the options.
   - Esc closes the menu, and focus returns to the theme button.
5. **Live-site fixes.**
   - Repayment cards (DESIGN §8.4): the ru title "Дифференцированный" and the uk title
     "Диференційований" break inside the word without a hyphen at 360, 390, 1024 and
     1280 px. Put soft hyphens (U+00AD) at their syllable breaks
     (Диф-фе-рен-ци-ро-ван-ный, Ди-фе-рен-ці-йо-ва-ний).
   - Currency select (DESIGN §8.2): 14 options read "CODE · CODE" in Playwright's Chromium
     (BOV, CHE, CHW, CLF, COU, MXV, SLE, USN, UYI, UYW, VED, XAD, XCG, ZWG), because
     `Intl.DisplayNames` returns the code when it has no name. Show the code alone then.
6. **DESIGN decisions confirmed by the architect** (no work beyond what T03 did, keep
   them as they are):
   - "n/a" with a visible reason (§8.13);
   - the hero as principal + interest, with fees named in the meta line (§8.6);
   - 18 px amount on phones (§8.2).

## Tests

- **Engine unit tests:** the new explain values for every repayment type × periodic
  (c = m, c ≠ m) and day-count mode, each payload with only its own fields. Equal
  principal: `p1`, `I1` and `first` equal the first row's principal, interest and their
  sum exactly. Interest-only: `I1` and `first` equal the first row's interest and its
  principal + interest exactly. The rate values are asserted exactly too: `j` and `m`
  in periodic mode, plus `i` when `c ≠ m` (and no `i` when `c = m`); `j`, `dayCount`
  and `yf1` in day-count mode.
- **Component tests:** the strip for equal principal (remainder last and first),
  interest-only (N = 1 and N > 1), annuity, balloon and the exact basis.
- **Unit test:** the currency option label is the code alone when the display name is
  missing or equals the code.
- **e2e:**
  - the strip's result equals the hero for equal principal and interest-only;
  - the theme menu keyboard and click behaviour;
  - in ru and uk at 360, 390, 1024 and 1280 px, no word in the repayment cards is split
    across lines without a hyphen (compare the line boxes of each word with `Range`);
  - axe stays clean.

## Acceptance criteria

- [ ] For every repayment type the formula strip reproduces the hero figure.
- [ ] Amount and currency form a labelled group; axe and the a11y checklist pass.
- [ ] Theme menu behaves as in DESIGN §7.1 with mouse and keyboard.
- [ ] No mid-word break without a hyphen in the repayment cards; no "CODE · CODE"
      currency options.
- [ ] `npm run check` and `npm run e2e` pass; no golden vector changes (the reference
      does not produce `explain`).

## Notes

- Strings for the new strip parts are needed in all four languages (GLOSSARY §6 now
  also names `irrNominal`).
- The GLOSSARY keeps "Дифференцированный" and "Диференційований" without soft hyphens; a
  test that compares locale strings with the GLOSSARY ignores U+00AD.
- Keep the change small; anything larger found on the way goes into the PR as a
  proposal.

## Completion notes

**Status:** in review, [PR #11](https://github.com/MortlakeDev/LoanLogic/pull/11)
(branch `task/T03a-ui-followups`). The branch includes PR #9 (SPEC v0.2.3, DESIGN, this
brief), which was not merged into `main` when the task started; once #9 is merged the
PR shows only T03a's changes.

**Acceptance criteria (local evidence, 2026-10-31, Windows, Node 24.19):**

- Every formula strip ends with the engine's own value (`A`, or `first` for equal
  principal and interest-only), and the hero shows that value, so they are equal for
  every repayment type, compounding and accrual mode: 18 component cases render the hero
  with its strip (annuity, balloon, exact basis, equal principal with the remainder last
  and first, interest-only with N = 1 and N > 1; periodic c = m, c ≠ m and day-count),
  and e2e checks equal principal and interest-only in Chromium and WebKit.
- The amount and the currency select are one `fieldset`; its legend "Loan amount" is
  the visible label and names the amount input (`aria-labelledby`); the select keeps
  "Currency". axe passes in all four languages, both themes, 360 and 1 280 px.
- The theme menu is a WAI-ARIA menu button with three `menuitemradio` items: a click,
  Enter or Space applies the choice and closes it, the arrow keys (and Home/End) only
  move focus, Esc returns focus to the button, Tab closes it and moves on.
- ru and uk repayment titles carry soft hyphens; an e2e check at 360, 390, 1 024 and
  1 280 px compares the line boxes of every word in the cards with a DOM `Range` and
  fails on a mid-word break without a hyphen (a control run without the soft hyphens
  shows the check sees the defect). Currency options show the code alone when
  `Intl.DisplayNames` has no name.
- `npm run check` passes: 2 754 unit tests, coverage 99.61 % statements, 98.95 %
  branches; initial JS 82.8 KiB gzip. `npm run e2e`: 268 passed, 10 skipped (the known
  WebKit-on-Windows and forced-colors cases). No golden vector changes.
- Screenshots: [`T03a-screenshots/`](T03a-screenshots/) (theme menu, an equal-principal
  strip, the ru cards at 360 px).

**Engine (SPEC v0.2.3 §9.6):** `instalment.equal-principal` carries `p1`, `I1` and
`first` from the first row as posted, and `instalment.bullet` carries `first`; both carry
the rate behind `I1` (`j`, `m`, and `i` only when `c ≠ m`; or `j`, `dayCount`, `yf1` in
day-count mode). A property test checks on random loans that every payload, annuity and
balloon included, has exactly its own fields.

**Decisions:**

1. The amount input is named by the legend (`aria-labelledby`); `NumberInput` gained an
   `ariaLabelledBy` prop for it.
2. The theme menu items are `div`s with menu roles (native buttons would turn Enter and
   Space into a second click; list elements may not carry menu roles under the strict
   jsx-a11y rules). The phone menu sheet keeps its radio group: it is a settings sheet,
   not this menu. A click now also moves focus to the checked item, as the menu pattern
   does.
3. The equal-principal and interest-only strips in day-count mode show `YF₁` but not the
   method name (the Explain sheet names it); DESIGN §8.6 does not ask for it in the strip
   (не уверен).
4. The new engine tests sit in `src/engine/schedule/build.test.ts`, next to
   `buildSchedule`.

**SPEC question:** in day-count mode `yf1` is rounded to 20 significant digits when the
fraction does not terminate (30/360 methods), so at an exact rounding tie the strip's
`P × j × YF₁` cannot reproduce the posted interest: USD 1 001.00 at 6 %, interest-only,
monthly, 30E/360 (also 30U/360), disbursed 2026-01-15 gives `yf1` 0.083333333333333333333,
`P × j × yf1` = 5.004999… → 5.00, while the engine posts 5.01 (exactly 5.005, half-up).
The strip shows the engine's 5.01, so the figures stay right; only a reader recomputing
by hand would differ. Options: carry `YF₁` exactly (for example as the day count and the
basis divisor), or accept that operands are display values (DESIGN §8.6 says so for
irrational ones).

**Open items (for the architect):**

1. The SPEC question above (`yf1` at a rounding tie).
2. Decision 3: should the day-count equal-principal and interest-only strips also name
   the day-count method next to `YF₁`? DESIGN §8.6 specifies `YF₁` but does not say.
3. DESIGN §8.6 says irrational operands are shown with 10 significant digits; the strips
   round every computed operand with more than 11 significant digits, which also covers
   non-terminating rational values such as `yf1` = 1/12 for a monthly 30/360 period (the
   payload cannot tell the two apart). The wording could say "non-terminating".
