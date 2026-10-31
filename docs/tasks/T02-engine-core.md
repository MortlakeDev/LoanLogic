# T02 — Engine core: money, dates, day-count, schedules, fees, rate metrics

- **Milestone:** M1 · **Status:** done (PR #4, merged 2026-10-20)
- **Depends on:** T01, R1 · **Blocks:** T03 and all later engine work
- **Branch:** `task/T02-engine-core`

## Goal

Implement `docs/SPEC-finance.md` **v0.2.2** §0–§6, §8, §9 (generic metrics, regional
methods a–f, result shape, explicit cash flows), §10, §13 and the input contract of §15
as a pure, fully tested TypeScript library in `src/engine`. It must reproduce every
golden vector in `tests/vectors/core` within the rules of §14.

Not in this task: events (§7), RU ПСК (§9.3 g), analytics (§11), multi-part loans (§12).

## Independence rule (important)

`tools/reference` is the architect's independent oracle. Implement the engine from the
SPEC only. **Do not read or port code from `tools/reference/**`** — the only exceptions
are the ISO 4217 data table in `tools/reference/loanlogic_ref/currency.py` (data, not
logic) and running its scripts. If a vector disagrees with the engine, re-read the SPEC;
if the SPEC is unclear or looks wrong, stop and report it (PR + this file). Never adjust
the engine to match a vector without understanding the rule.

## Modules (`src/engine/`)

| Module | Content (SPEC section) |
|---|---|
| `decimal.ts` | decimal.js configuration and helpers (§1.1) |
| `rational.ts` | exact rationals on BigInt (numerator/denominator), exact rounding to a quantum with each mode (§1.6) |
| `currency.ts` | embedded ISO 4217 minor units (§1.2), `CURRENCY_INVALID` |
| `rounding.ts` | rounding modes, payment rounding policy (§1.3–1.5) |
| `date.ts` | `LocalDate`, strict ISO parse/format, addDays, addMonths, end-of-month rule, daysBetween, isLeapYear (§2.1) |
| `frequency.ts` | frequency table and schedule dates from the anchor `D0` (§2.2–2.3) |
| `term.ts` | term → N with limits and error fields (§2.4) |
| `daycount.ts` | exact YF for the six methods (§4) |
| `rates.ts` | periodic rate: exact when rational (always for `j = 0`), ≥ 40 digits otherwise (§3, §1.6) |
| `schedule/annuity.ts`, `equal-principal.ts`, `bullet.ts`, `balloon.ts` | §5 (periodic and day-count modes, payment basis, early close, negative amortization) |
| `fees.ts` | upfront (paid / financed), periodic, insurance, `inApr` (§6) |
| `ledger.ts` | row and summary types, summary builder (§8.2), invariant checker I1–I9 (§8.3) |
| `solvers.ts` | sign-change rules, bracket expansion, grid enumeration of several roots, Brent refinement with the bracket-width stop, scaled evaluation (§10) |
| `metrics/*.ts` | `nominal`, `effective`, `irrNominal`, `irrEffective`, `xirr`, `usRegZApr` (incl. the single-payment rule), `ukAprc`, `euAprc` (whole periods and backward counting), `cnAnnualized`, `uaRealAnnual`, `international` (§9.2–§9.3) |
| `cashflows.ts` | `computeRateMetrics` for explicit cash flows (§9.7) |
| `validate.ts` | runtime validation in three phases → structured errors with exact field paths, warnings (§13) |
| `index.ts` | public API |

## Public API

```ts
type Rates = Partial<Record<RateMethodId, RateMetric | RateFailure>>;

function calculateLoan(input: unknown):        // validated as LoanInput (SPEC §15)
  | { ok: true; warnings: EngineWarning[]; summary: LoanSummary; rows: LedgerRow[];
      rates: Rates; explain: Explain }        // explain: the instalment (§9.6)
  | { ok: false; errors: EngineError[] };

function computeRateMetrics(input: unknown):   // validated as CashFlowInput (§9.7, §15)
  | { ok: true; rates: Rates }
  | { ok: false; errors: EngineError[] };
```

- The result is flat, exactly like the vectors' `expected`; field names of SPEC
  §8.1–§8.2; all money as decimal strings at minor units ("0.00", never "-0.00").
- `RateMetric` per §9.6: `value` (percent, number), `display` (string), `precision`,
  `warnings?` (plain codes), `explain`; `RateFailure = { ok: false; reason }`.
  `EngineWarning = { code, params }` (params of §13), `EngineError = { code, field, params? }`.
- Validate at runtime as if the input were untrusted, in the phases of §13: vectors
  contain malformed values (`"1,000.00"`, unknown ids, wrong types, nested paths such as
  `fees[1].id` and `rateMethods[1]`) that must produce exactly the listed errors.
- `explain` payloads (§0.4, §9.6) with the formula ids and keys of the §9.6 table
  (T03 renders them).

## Exactness (SPEC §1.6) — read before coding

- Periodic interest is `B × j ÷ m` evaluated exactly. Never compute `j/m` first:
  vector `rounding-interest-half-even-tie` (14.625) fails if you do.
- `A*` must be exact whenever `i` is rational (vector `rounding-single-payment-exact-tie`:
  1 508.125 → 1 508.13). Suggested: `rational.ts` with BigInt; decimal.js is not exact
  for `j/12`.
- Irrational cases (`c/m` not an integer, continuous compounding; never `j = 0`) may use
  decimal.js with ≥ 40 digits.

## Rates and solvers (SPEC §9–§10) — read before coding

- Stop the root finder on the bracket width (`1e−12 × max(1, |x|)`), never on `|f|`:
  v0.1's `|f|` rule misses the tolerance on `high-rate-short-weekly`.
- Count sign changes after summing same-time flows; enumerate roots on the grid of §10
  when there are several (vectors `cashflows-multiple-irr`, `cashflows-close-roots`,
  `cashflows-same-date-flows`); `IRR_MULTIPLE` only when two or more roots are found.
- Single-payment loans use the Reg Z term unit-period (`payday-biweekly-single-payment`:
  391.071 %, not 390.000 %); the APRC of irregular dates counts back from each date
  (`cashflows-irregular-aprc-backward-counting`).
- Months counted back from a date follow §2.1: clamp the day, start from the later date
  for every count, no end-of-month rule (`regz-single-payment-month-end-*`,
  `cashflows-aprc-month-end-clamp`).
- Values are compared within `max(1e−7, 1e−9 × |v|)` pp (§14); IEEE doubles suffice.

## SPEC v0.2.2 — answers to the PR questions

The SPEC questions of the PR are answered in v0.2.2 (§17 lists the changes). What the
engine has to change:

1. **Single payment** (§9.3 a, §9.7): the rule applies when the rate cash flows summed
   per date leave exactly two dates — explicit flows and loans alike (a same-date fee,
   zero interim flows, an early close at the first payment). The unit-period rate —
   `i = P / A_f − 1` under a year, the yearly `i` solved otherwise — must lie in
   `[−0.99, 1e7]`, else `IRR_NO_CONVERGENCE`.
2. **Range of results** (§10): a metric computed from a solved rate (`x × m`,
   `(1 + x)^m − 1`, the single-payment APR) whose value lies outside ±10⁹ % fails with
   `IRR_NO_CONVERGENCE`.
3. **Validation** (§13): percentages (`annualRatePct`, percentage fees, a percentage
   balloon) that are not multiples of 10^−10 → `TOO_MANY_DECIMALS`; a fixed fee above
   1e15 or a percentage fee above 100 → `FEE_RANGE`, with the fee's `calc` as given (as
   the minor-units check already does); upfront fees paid at closing of at least
   `amount` → `FEE_RANGE` on `fees` (phase 2).
4. **Exact payment basis** (§5.1): no `NEG_AMORTIZATION`; such rows have a negative
   principal. Its explanation uses `instalment.annuity-exact-basis` (§9.6).
5. Confirmed as implemented, no change: `params` as strings (§13), the cash-flow period
   rule (`flows[0]` decides), the scaling of §10, early close at k = 1 for equal principal
   with `q = 0`, and the other interpretations listed in the PR.

14 new vectors cover these rules (`tests/vectors/core/README.md` lists them all). Eight
fail on the engine of PR #4 before these changes: `cashflows-regz-single-payment-same-date-fee`,
`regz-single-payment-zero-interim-payments`, `cashflows-single-payment-out-of-range`,
`cashflows-nominal-rate-out-of-range`, `cashflows-annualized-rate-out-of-range`,
`error-fee-and-rate-bounds`, `error-upfront-fees-exceed-amount` and
`daycount-exact-basis-negative-principal`.

## Tests

- **Golden vectors:** a harness (e.g. `src/engine/vectors.test.ts`) loads every
  `tests/vectors/core/*.json`, runs `calculateLoan` (`kind: "loan"`) or
  `computeRateMetrics` (`kind: "cashflows"`) and compares per SPEC §14 — one test per
  vector, named by its id. All of them must pass.
- **Unit tests** for every module, including: rate 0; negative rate; N = 1; amount 1e15;
  JPY (0 decimals), KWD (3) and CLF (4); every ISO 4217 code of §1.2's required list;
  leap years; end-of-month anchors (Jan 31 → Feb 29 → Mar 31 → Apr 30, Feb 28 with and
  without `endOfMonth`); each day-count method (include the ISDA ACT/ACT example of §4);
  every rounding mode at exact ties and for negative values; every payment rounding
  policy; financed vs paid upfront fee; `inApr` true/false; `pct-balance` fees; every
  error and warning code of §13 with its field path.
- **Property tests (fast-check):** random valid inputs (amount 1 … 1e12, rate −5 … 60 %,
  N 1 … 600, every repayment type, frequency, accrual mode, rounding option and fee type)
  → invariants I1–I9 hold exactly; annuity instalments constant except the last;
  Σ principal = principal financed; dates strictly increasing; same input → same output.
- **Benchmark:** a 1 200-period annuity with all rate metrics completes in ≤ 50 ms in
  Node on CI (report the measured time).

## Tooling changes in this task

- `scripts/lib/spdx.mjs`: require the hash-comment header (`# SPDX-…`, `# Copyright …`)
  in `.py` files, with tests (the reference already has it).
- CI (`ci.yml`, check job): set up Python 3.12 and run
  `python tools/reference/generate.py --check` and
  `python -m unittest discover -s tools/reference -p "test_*.py"`.
- Add `decimal.js` to `dependencies` (MIT); report its gzip size.

## Acceptance criteria

- [x] All core vectors pass; all tests pass; coverage ≥ 95 % lines and branches in
      `src/engine`.
- [x] The engine imports nothing but decimal.js; no `number` money in the ledger; no
      `Date` arithmetic; no `Intl`.
- [x] TSDoc on the public API with units.
- [x] Every SPEC ambiguity found is listed in the PR with a proposed resolution
      (nothing decided silently).
- [x] CI runs the reference checks; `.py` files are covered by the SPDX check.

## Notes

- Expose the invariant checker so the UI can run it in development builds.
- Vector JSON is generated: never edit it. If you believe a vector is wrong, say so in
  the PR with the SPEC section; the architect fixes the reference or the SPEC.

## Completion notes

**Status:** done, merged in [PR #4](https://github.com/MortlakeDev/LoanLogic/pull/4) on
2026-10-20 after the architect's acceptance check (branch `task/T02-engine-core`). Implements SPEC v0.2.2: `main` (with #3 and the action pins of
#5) is merged in, and the v0.2.2 changes of the architect review are done.

**Acceptance criteria (local evidence, 2026-10-20, Windows, Node 24.19):**

- All 106 core vectors pass through the public API (`src/engine/vectors.test.ts`, one
  test per vector, SPEC §14 rules, plus I1–I9 on every loan).
- `npm run check` passes: 2 010 tests (1 387 in the engine). Coverage of `src/engine` is
  99.9 % statements, 99.9 % branches and 100 % functions; `vite.config.ts` enforces
  ≥ 95 %. `npm run e2e`: 148 passed, 8 skipped (the known WebKit-on-Windows cases).
- The engine imports only decimal.js; ledger money is `bigint` minor units and exact
  rationals; there is no JS `Date` and no `Intl` (ESLint bans both in `src/engine`).
- TSDoc with units on the public API and on every input field.
- CI sets up Python 3.12 and runs `generate.py --check` (106 vectors) and the reference
  self-tests; `scripts/lib/spdx.mjs` requires the `#` header in `.py` files. Every
  action is pinned to a commit SHA (#5).
- Benchmark: a 1 200-period annuity with all eleven rate metrics takes a median of
  about 15 ms in Node (budget 50 ms), via `npm run bench`.
- Every SPEC question of the PR is answered in v0.2.2.

**SPEC v0.2.2 changes in this round:**

1. **Single payment** (§9.3 a, §9.7): `metrics/us-regz.ts` sums the rate flows per date
   and drops zero sums. The rule applies when exactly two dates remain: a same-date fee,
   zero interim flows, or an early close at the first payment. The two sums must have
   opposite signs, and the unit-period rate must lie in `[−0.99, 1e7]`.
2. **Result range** (§10): `x × m`, `(1 + x)^m − 1` and the single-payment APR fail with
   `IRR_NO_CONVERGENCE` outside ±10⁹ % (`withinResultRange` in `metrics/display.ts`).
3. **Validation** (§13): percentages (the rate, percentage fees, a percentage balloon)
   that are not multiples of 10⁻¹⁰ give `TOO_MANY_DECIMALS`. A fixed fee above 1e15 and
   a percentage fee above 100 give `FEE_RANGE`, checked against the `calc` as given.
   Upfront fees paid at closing of at least the amount give `FEE_RANGE` on `fees`
   (phase 2).
4. **Exact payment basis** (§5.1, §9.6): no `NEG_AMORTIZATION`; such rows have a negative
   principal. The explanation is `instalment.annuity-exact-basis` with `P`, `N`, `j`,
   `dayCount`, `Astar`, `A`.
5. Tests follow the new rules, each with a case that fails under the old behaviour:
   - the 40-digit check now uses the smallest valid rate, 10⁻¹⁰ %;
   - the edge tests use the new fee maximums;
   - the IRR_MULTIPLE pass-through of `calculateLoan` is tested with a wrapped metrics
     module, because a valid loan now always has a positive inflow at `D0`.

**Deviations and decisions:**

- The performance budget runs as `npm run bench` (`vitest.bench.config.ts`) and as its
  own CI step, not inside `npm run coverage`. Under coverage instrumentation and dozens of
  parallel test files the timing was not meaningful (50.6 ms there against about 15 ms on
  its own).
- Module layout follows the brief. Additions: `money.ts` (DecimalString and minor units),
  `types.ts` (shared types), `metrics/solve.ts` and `metrics/display.ts` (shared metric
  helpers), and `validate-cashflows.ts` (cash-flow validation, re-exported by
  `validate.ts`).
- Irrational values use a decimal.js clone isolated from the global configuration
  (`defaults: true`). It works at 50 + 10 digits, plus one digit per leading zero of
  `j/m`, plus the digits of `P` in minor units, so every irrational value keeps at least
  40 relative digits (§1.6).
- The rate solvers scale every amount by one exact power of two before the conversion to
  doubles. Since v0.2.2 bounds the fees this is a safeguard; in the normal range results
  are bit-identical.
- An independent multi-agent review found six defects in the first round, all fixed with
  tests that fail without the fix. The architect's differential test against the
  reference (6 000 inputs) found no difference beyond the rules that v0.2.2 changed.
- Independence: nothing under `tools/reference` was read except the ISO 4217 data lines
  of `currency.py` (extracted as code/digit pairs); its scripts were run.
- Local note: on a cold Vitest cache, `npm run check` occasionally fails to start a worker
  for an app test file ("Timeout waiting for worker to respond"). A second run passes, and
  CI has not shown it.

**Open questions:** none. The 17 questions of the first round are answered in SPEC
v0.2.2 (§17), and points 10–17 confirm the engine's interpretations.
