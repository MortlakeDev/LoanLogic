# T03a — UI follow-ups from the T03 review

- **Milestone:** M2 · **Status:** ready
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
   - Equal principal: `q = P ÷ N`, then `first payment = p₁ + I₁`.
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
  - in ru and uk at 360 and 1280 px, no word in the repayment cards is split across
    lines without a hyphen (compare the line boxes of each word with `Range`);
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

_(to be filled by the implementer)_
