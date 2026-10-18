# T02 — Engine core: money, dates, day-count, schedules, fees, rate metrics

- **Milestone:** M1 · **Status:** blocked until R1 (reference vectors) lands
- **Depends on:** T01, R1 · **Blocks:** T03 and all later engine work
- **Branch:** `task/T02-engine-core`

## Goal

Implement `docs/SPEC-finance.md` §0–§6, §8, §9 (generic metrics and regional methods
a–f), §10 and §13 as a pure, fully tested TypeScript library in `src/engine`.
Not in this task: events (§7), RU ПСК (§9.3 g), analytics (§11), multi-part loans (§12).

## Modules (`src/engine/`)

| Module | Content (SPEC section) |
|---|---|
| `decimal.ts` | decimal.js configuration and helpers (§1.1) |
| `currency.ts` | minor units, rounding to minor units (§1.2–1.3) |
| `rounding.ts` | rounding modes, payment rounding policy (§1.3–1.5) |
| `date.ts` | `LocalDate`, ISO parse/format, addDays, addMonths, end-of-month rule, daysBetween, isLeapYear (§2.1) |
| `frequency.ts` | frequency table and schedule date generation (§2.2–2.3) |
| `term.ts` | term → N (§2.4) |
| `daycount.ts` | YF for 30/360 US, 30/360 ISDA, 30E/360, ACT/360, ACT/365F, ACT/ACT ISDA (§4) |
| `rates.ts` | periodic rate from nominal rate and compounding (§3) |
| `schedule/annuity.ts`, `equal-principal.ts`, `bullet.ts`, `balloon.ts` | §5 (periodic and day-count modes, payment basis, early close) |
| `fees.ts` | upfront (paid / financed), periodic, insurance, `inApr` defaults hook (§6) |
| `ledger.ts` | row and summary types, summary builder, invariant checker I1–I9 (§8) |
| `solvers.ts` | Brent root finder with bracket expansion; IRR; XIRR (§10) |
| `metrics/*.ts` | `nominal`, `effective`, `irrNominal`, `irrEffective`, `xirr`, `usRegZApr`, `ukAprc`, `euAprc`, `cnAnnualized`, `uaRealAnnual`, `international` (§9) |
| `validate.ts` | input validation → structured errors (§13) |
| `index.ts` | public API |

## Public API (sketch — refine names, keep semantics)

```ts
type Decimalish = string; // decimal string in major units, e.g. "100000.00"

interface LoanInput {
  currency: string;                                   // ISO 4217
  amount: Decimalish;
  annualRatePct: Decimalish;                          // "6.5" means 6.5 % p.a.
  repayment: 'annuity' | 'equal-principal' | 'bullet' | 'balloon';
  balloon?: { kind: 'amount' | 'percent'; value: Decimalish };
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  term: { payments: number } | { years: number; months: number } | { endDate: string };
  disbursementDate: string;                           // ISO yyyy-mm-dd
  accrual:
    | { mode: 'periodic'; compounding?: Frequency | 'continuous' }
    | { mode: 'daycount'; method: DayCountId; paymentBasis?: 'nominal' | 'exact' };
  rounding?: {
    interest?: RoundingMode; fees?: RoundingMode;
    payment?: PaymentRounding; principalRemainder?: 'last' | 'first';
  };
  fees?: FeeInput[];                                  // upfront | periodic | insurance
  rateMethods?: RateMethodId[];                       // default: all generic + regional a–f
}

function calculateLoan(input: LoanInput):
  | { ok: true; result: LoanResult; warnings: EngineWarning[] }
  | { ok: false; errors: EngineError[] };
```

`LoanResult` = `{ rows: LedgerRow[]; summary: LoanSummary; rates: Record<RateMethodId, RateMetric> }`
with all money as decimal strings at minor units (SPEC §8, §9.6).

## Tests

- **Unit tests** for every module, including: rate 0; negative rate; N = 1; amount 1e15;
  JPY (0 decimals) and KWD (3 decimals); leap years; end-of-month anchors
  (Jan 31 → Feb 29 → Mar 31 → Apr 30); each day-count method against published ISDA
  examples; every payment rounding policy; financed vs paid upfront fee; `pct-balance` fees.
- **Worked examples** E1–E4 from SPEC §5.6 as explicit tests.
- **Property tests (fast-check):** random valid inputs (amount 1 … 1e12, rate −5 … 60 %,
  N 1 … 600, every repayment type, frequency, accrual mode and rounding option) →
  invariants I1–I9 hold exactly; annuity instalments constant except the last;
  Σ principal = principal financed.
- **Golden vectors:** load every file in `tests/vectors/core/`; ledger rows and summaries
  must match exactly (string comparison of decimals); rates within 1e−6 percentage
  points before display rounding and equal after it.
- **Benchmark:** a 1 200-period annuity with all rate metrics completes in ≤ 50 ms in
  Node on CI (report the measured time).

## Acceptance criteria

- [ ] All tests pass; coverage ≥ 95 % lines and branches in `src/engine`.
- [ ] The engine imports nothing but decimal.js; no `number` money in the ledger; no
      `Date` arithmetic.
- [ ] TSDoc on the public API with units.
- [ ] Every SPEC ambiguity found is listed in the PR with a proposed resolution
      (nothing decided silently).

## Notes

- Start with the modules and unit tests right away; wire in `tests/vectors/core` as
  soon as R1 is delivered. The PR is not merged before all vectors pass.
- Expose the invariant checker so the UI can run it in development builds.

## Completion notes

_(to be filled by the implementer)_
