# LoanLogic — Financial Methodology Specification

Status: v0.2.1 · Normative for the engine (`src/engine`). Keywords MUST / SHOULD / MAY are
used as in RFC 2119. If the code and this document disagree, this document wins. If this
document is ambiguous or looks wrong, the implementer stops and reports — financial
rules are never invented in code.

Sections marked **(M3)**, **(M4)**, **(M5)** are implemented in later milestones; they are
included now so the core design does not block them. The engine's input contract is in
§15; changes from v0.1 are listed in §17.

---

## 0. Principles

1. **Exact ledger.** Every monetary amount in a schedule is an exact multiple of the
   currency minor unit. A posted amount is the exact mathematical value rounded once
   (§1.6). Binary floating point MUST NOT be used for ledger amounts.
2. **Float analytics.** Rate solvers (IRR, XIRR, APR), NPV and other analytics MAY use
   IEEE-754 doubles on values converted from exact decimals. Results are displayed with
   method-specific precision (§9).
3. **Determinism.** Same input → same output, independent of locale, time zone, device
   and browser. The engine does not read `Intl` or any other environment data.
4. **Explainability.** Every headline figure carries an `explain` payload: formula id,
   the inputs used and the key substituted values (§9.6).
5. **No silent fallbacks.** If a requested option cannot be applied, the engine returns
   a structured error or warning. It never computes something else instead.
6. **Data-driven regions.** Regional rules are expressed as method ids and profile data.
   Generic algorithms never branch on a country.

## 1. Numbers and rounding

### 1.1 Decimal configuration

- Rational values are computed exactly (§1.6). Irrational intermediate values use
  decimal arithmetic (decimal.js) with at least 40 significant digits. Rounding happens
  only at the posting points in §1.4.

### 1.2 Currency minor units

- `minorUnits(currency)` comes from a table embedded in the engine: ISO 4217 List One
  (current currencies and funds) as published by the maintenance agency (SIX) on
  2026-09-17. The engine does not take minor units from `Intl`: CLDR fraction digits
  differ from ISO 4217 for several currencies, and the result must not depend on the
  browser.
- Codes whose minor unit is "N.A." (XAU, XAG, XPT, XPD, XDR, XSU, XUA, XBA–XBD, XTS, XXX)
  and unknown codes are rejected with `CURRENCY_INVALID`.
- Required test values: USD 2, GBP 2, EUR 2, CNY 2, UAH 2, JPY 0, KRW 0, KWD 3, CLF 4.
- Money inputs (amount, fixed fees, balloon amount) MUST be whole numbers of minor units:
  "100.100" USD is valid, "100.005" USD is `TOO_MANY_DECIMALS`.
- "Round to minor unit" = quantize to `10^-minorUnits`.
- The UI formats ledger amounts with the engine's minor units (explicit fraction digits),
  never with Intl's default digits for the currency.

### 1.3 Rounding modes

| Id | Meaning | decimal.js |
|---|---|---|
| `half-up` | nearest; ties away from zero (commercial rounding): 0.125 → 0.13, −0.125 → −0.13 | `ROUND_HALF_UP` |
| `half-even` | nearest; ties to even (banker's rounding): 0.125 → 0.12, 0.135 → 0.14 | `ROUND_HALF_EVEN` |
| `ceil` | towards +∞ | `ROUND_CEIL` |
| `floor` | towards −∞ | `ROUND_FLOOR` |

### 1.4 Posting points (the only places where rounding happens)

1. The regular instalment `A` (payment rounding policy, §1.5).
2. Each period's interest (interest rounding mode, default `half-up`).
3. Each fee or insurance amount computed from a percentage (fee rounding mode, default
   `half-up`). Fixed amounts are used as entered.
4. The equal-principal instalment `q` (always `half-up`).
5. A balloon residual given as a percentage (always `half-up`).
6. Capitalized or deferred interest amounts (same as interest) **(M3)**.

Every other ledger value is obtained by exact addition or subtraction of posted values.
Notation: `R_int`, `R_fee`, `R_pay` denote rounding with the interest, fee and payment
policies respectively; `R` alone means `half-up` to the minor unit.

### 1.5 Payment rounding policy

| Id | Rule |
|---|---|
| `minor-half-up` (default) | round `A*` to the minor unit, `half-up` |
| `minor-ceil` | round `A*` up to the minor unit |
| `unit-half-up` | round `A*` to whole currency units, `half-up` |
| `unit-ceil` | round `A*` up to whole currency units |

The policy applies to `A` (annuity, balloon); `q` is always rounded `half-up` to the minor
unit. The final payment always absorbs the remaining balance (§5).

### 1.6 Exact evaluation

Every posted value is `round(v)`, where `v` is the exact mathematical value this
document defines. Implementations MUST produce that result.

- **Rational values MUST be computed exactly.** A value is rational when it is built from
  the inputs with `+ − × ÷` and integer powers. This covers:
  - periodic interest with `c = m`: `v = B × j ÷ m` — the product is formed first and the
    periodic rate `j/m` is never rounded on its own. `B × round(j/m)` is wrong at ties:
    2 700.00 × 6.5 % ÷ 12 = 14.625 exactly (vector `rounding-interest-half-even-tie`);
  - periodic interest when `c/m` is a positive integer: `i = (1 + j/c)^(c/m) − 1`;
  - day-count interest: `v = B × j × YF`, with `YF` the exact fraction of §4;
  - the instalment `A*` (§5.2, §5.5) whenever `i` is rational, including `N = 1`
    (`A* = P(1 + i)`: 1 500.00 at 6.5 % gives 1 508.125 exactly), and `A*` of the exact
    day-count payment basis;
  - `q = P ÷ N`, percentage fees, the balloon residual.

  Exact rational arithmetic with BigInt numerators and denominators is a suitable
  technique; BigInt is a language built-in, not a dependency. decimal.js on its own is
  not exact for values such as `j/12`.
- **Irrational values** — periodic interest and `A*` when `j ≠ 0` and `c/m` is not an
  integer or compounding is continuous — MUST be computed with at least 40 significant
  digits. If such a value lies within 10^−15 minor units of a rounding boundary the
  result is implementation-defined; golden vectors never contain such inputs. With
  `j = 0`, `i = 0` exactly for every compounding (§3.2).

## 2. Time

### 2.1 Dates

- Dates are calendar dates without time or zone: `LocalDate { y, m, d }`, implemented
  with integer arithmetic (days-from-civil). JS `Date` MUST NOT be used for date
  arithmetic; it is used only at the UI boundary (e.g. "today").
- `addMonths(date, n)`: same day-of-month, clamped to the month length
  (Jan 31 + 1 month = Feb 28/29).
- **End-of-month rule.** Input `endOfMonth`, default `true`. It applies to month-based
  frequencies when the anchor date is the last day of its month: every schedule date is
  then the last day of its month (Jan 31 → Feb 29 → Mar 31 → Apr 30; Feb 28, 2026 →
  Mar 31 → Apr 30). With `endOfMonth = false` the anchor's day of month is kept and
  clamped (Feb 28 → Mar 28 → Apr 28). An anchor on the 31st reaches every month end
  either way.
- Dates are always computed from the anchor (`anchor + k·period`), never by repeated
  addition, so month-end drift cannot occur.
- **End-of-month schedule.** A schedule is end-of-month when its frequency is
  month-based and `D0` and every payment date are the last day of their month — by the
  rule above, or because the anchor is on the 31st. 30/360 US (§4) and the Regulation Z
  time measurement (§9.3 a) use this definition, which depends on the dates, not on the
  `endOfMonth` flag.
- **Counting months back.** `k` months back from a date `D` is `addMonths(D, −k)`: the
  same day of month, clamped to the length of the earlier month, without the
  end-of-month rule, and computed from `D` for every `k`, never by repeated one-month
  steps. 31 March 2026 − 1 month = 28 February; − 2 months = 31 January; 28 February −
  1 month = 28 January. The rate metrics measure time this way (§9.3 a, b).
- Supported dates are 0001-01-01 … 9999-12-31. A schedule whose last date would be later
  is rejected with `DATE_INVALID` on `disbursementDate` (§13).

### 2.2 Payment frequency

| Id | m (per year) | Period rule | Milestone |
|---|---|---|---|
| `weekly` | 52 | +7 days | M1 |
| `biweekly` | 26 | +14 days | M1 |
| `monthly` | 12 | +1 month | M1 |
| `quarterly` | 4 | +3 months | M1 |
| `semiannual` | 2 | +6 months | M1 |
| `annual` | 1 | +12 months | M1 |
| `semimonthly` | 24 | two fixed days per month (pattern: 1st & 15th, or 15th & end of month) | M3 |

### 2.3 Schedule dates

- Disbursement date `D0`. In M1 the first payment is one period after `D0` and
  `date_k = D0 + k periods`, k = 1..N, computed from the anchor `D0` with the
  end-of-month rule.
- (v0.1 defined `date_k = F + (k − 1)` periods. With a clamped first date — Jan 30 →
  Feb 28 — that would move every later payment to the 28th, so the anchor is `D0`.)
- Irregular first periods and an explicit payment day are added in M3 (§7.5); the
  anchor then becomes the first payment date with its payment day.

### 2.4 Term

The term is given in exactly one of three ways:

1. **Number of payments** `N` (integer, 1 ≤ N ≤ 1200, else `TERM_RANGE` on
   `term.payments`).
2. **Years + months** (integers, years 0–100 and months 0–11, else `TERM_RANGE` on the
   field): `N = roundHalfUp(totalMonths × m / 12)`. If `N < 1` → `TERM_TOO_SHORT`; if
   `N > 1200` → `TERM_RANGE` (field `term`). The resulting effective term is shown to
   the user (e.g. 7 months weekly → 30 payments).
3. **End date** `E`: `N` = number of schedule dates `date_k ≤ E`. If `N < 1` →
   `TERM_TOO_SHORT`; if `N > 1200` → `TERM_RANGE` (field `term`).

## 3. Interest rate model

### 3.1 Inputs

- Nominal annual rate `j`, entered in percent (`annualRatePct: "6.5"`); the engine uses
  the decimal fraction per annum.
- Accrual mode: `periodic` (default) or `daycount` with a method from §4.
- Compounding frequency `c` (periodic mode only): any payment frequency id or
  `continuous`; default `c = m`.

### 3.2 Periodic rate

- If `j = 0`: `i = 0` exactly, whatever the compounding.
- If `c = m`: `i = j / m`.
- If `c ≠ m`: `i = (1 + j/c)^(c/m) − 1`. It is rational when `c/m` is a positive integer
  (monthly compounding with quarterly payments) and irrational otherwise (Canadian-style
  fixed mortgage: `c = 2`, `m = 12`).
- `c = continuous`: `i = e^(j/m) − 1`.

### 3.3 Day-count mode

- Interest for period k: `I_k = R_int(B_{k−1} × j × YF(date_{k−1}, date_k))`, with
  `date_0 = D0`. Compounding frequency is not used in this mode.

### 3.4 Negative and zero rates

- `j = 0` is valid (no interest; annuity `A* = P/N`).
- `j < 0` is valid down to −20 % with warning `RATE_NEGATIVE`; negative interest is
  posted (rounded) and the loan still amortizes to zero. With a negative rate the
  scheduled payment of an equal-principal or bullet loan can be negative (the lender
  pays); this is allowed.
- `j > 100 %` is valid up to 1 000 % with warning `RATE_HIGH`.

## 4. Day-count conventions

Method ids: `30u-360`, `30-360-isda`, `30e-360`, `act-360`, `act-365f`, `act-act-isda`.
`YF(d1, d2)` for `d1 ≤ d2`, with `d1 = (Y1, M1, D1)`, `d2 = (Y2, M2, D2)`, is an exact
fraction:

- **30/360 US** (`30u-360`, SIA): apply in order, each step seeing the previous ones —
  (1) if the schedule is end-of-month (§2.1), D1 is the last day of February and D2 is
  the last day of February → D2 = 30;
  (2) if the schedule is end-of-month and D1 is the last day of February → D1 = 30;
  (3) if D2 = 31 and D1 ≥ 30 → D2 = 30;
  (4) if D1 = 31 → D1 = 30.
  `YF = (360(Y2−Y1) + 30(M2−M1) + (D2−D1)) / 360`. Disbursed on 2026-01-31, both
  `endOfMonth` settings give the same month-end dates and therefore the same interest
  (vector `daycount-30u360-day-31-anchor-eom-off`).
- **30/360 ISDA** (`30-360-isda`, bond basis, 2006 ISDA Definitions §4.16(f)): if
  D1 = 31 → D1 = 30; if D2 = 31 and D1 = 30 (after adjustment) → D2 = 30. Same YF formula.
- **30E/360** (`30e-360`, Eurobond basis, §4.16(g)): if D1 = 31 → 30; if D2 = 31 → 30.
- **ACT/360** (`act-360`): `days(d1, d2) / 360`.
- **ACT/365F** (`act-365f`): `days(d1, d2) / 365`.
- **ACT/ACT ISDA** (`act-act-isda`): split the interval at year boundaries;
  `YF = Σ days_in_year_y / (366 if leap(y) else 365)`. Example: 1 Nov 2003 → 1 May 2004 =
  61/365 + 121/366 = 0.497724380567.

`d1 > d2` is a programming error (throw). `d1 = d2` → 0.

## 5. Repayment types (schedule construction)

### 5.1 Notation and common per-period steps

- `amount` = requested loan amount; `P` = principal financed (= amount + financed
  upfront fees, §6.1); `N` = number of payments; `B_0 = P`.
- For each period k = 1..N:
  1. `I_k` = interest (periodic: `R_int(B_{k−1} × i)`; day-count: §3.3).
  2. `p_k` = principal per repayment type (below).
  3. `fees_k` = periodic fees and insurance (§6.2–6.3).
  4. `payment_k = I_k + p_k + fees_k` (+ extra principal and penalty in M3).
  5. `B_k = B_{k−1} − p_k`.
- **Early close:** if for some k < N the scheduled `p_k ≥ B_{k−1}`, then `p_k = B_{k−1}`,
  the schedule ends at k, the summary reports the actual number of payments and the
  result carries warning `EARLY_CLOSE` (e.g. an instalment rounded up to whole units on
  a long loan).
- **Negative amortization:** for annuity and balloon, if `p_k < 0` for some k < N (the
  instalment does not cover the interest — e.g. ACT/360 interest on a long high-rate
  loan with the nominal payment basis) → error `NEG_AMORTIZATION`.

### 5.2 Annuity (equal instalments, 等额本息)

- Exact instalment (principal + interest, fees excluded):
  `A* = P·i / (1 − (1 + i)^−N)` for `i ≠ 0`; `A* = P / N` for `i = 0`.
- `A = R_pay(A*)` (§1.5), computed exactly when `i` is rational (§1.6).
- k < N: `p_k = A − I_k`. k = N: `p_N = B_{N−1}` (the last instalment absorbs
  rounding drift; it is typically within a few minor units of `A`).
- **Day-count mode — payment basis:**
  - `nominal` (default, common bank practice): `A` is computed with the periodic rate
    `i = j/m`; interest is charged by actual days (§3.3); the last instalment adjusts.
  - `exact`: `A*` solves the variable-rate recurrence with `r_k = j × YF_k`:
    `A* = P × Π_{k=1..N}(1 + r_k) / Σ_{s=1..N} Π_{k=s+1..N}(1 + r_k)`; then `A = R_pay(A*)`.
- The payment basis applies to annuities only; it has no effect on equal-principal and
  bullet schedules (§5.5 for balloons).

### 5.3 Equal principal (等额本金)

- `q = R(P / N)` (`half-up`, always).
- `remainder = last` (default): `p_k = q` for k < N, `p_N = B_{N−1}`. Early close (§5.1)
  applies when `q` rounds up on a very small amount.
- `remainder = first`: `p_1 = P − (N − 1)·q`, `p_k = q` for k ≥ 2. If `p_1 < 0` (only when
  `P/N` is below about `N/2` minor units) → error `AMOUNT_TOO_SMALL_FOR_TERM`.

### 5.4 Interest-only + bullet (先息后本)

- `p_k = 0` for k < N; `p_N = P`.

### 5.5 Balloon (partial amortization with residual)

- Residual `Bal` given as an amount (whole minor units) or as a percentage of the
  principal financed: `Bal = R(P × pct / 100)`. `0 < Bal < P` is checked after rounding,
  else `BALLOON_RANGE` (`Bal = 0` is an annuity; `Bal = P` is a bullet).
- `A* = (P − Bal·(1 + i)^−N) · i / (1 − (1 + i)^−N)` for `i ≠ 0`;
  `A* = (P − Bal) / N` for `i = 0`. `A = R_pay(A*)`.
- k < N: `p_k = A − I_k`; k = N: `p_N = B_{N−1}`. The ledger reports the balloon part
  of the last payment separately: `balloon = p_N − (A − I_N)`. After an early close
  (§5.1) no balloon is paid and `balloon = 0`.
- Day-count mode supports the `nominal` payment basis only; `paymentBasis = exact` with
  a balloon → error `UNSUPPORTED`.
- The `balloon` input is ignored for the other repayment types.

### 5.6 Worked examples (half-up everywhere, periodic, monthly)

| # | Input | Expected |
|---|---|---|
| E1 | Annuity, 100 000.00 USD, 6.5%, N = 24 | `A* = 4454.6251433…`, `A = 4454.63`; I_1 = 541.67, p_1 = 3912.96; last payment 4454.51; total paid 106 911.00; total interest 6 911.00; Σp = 100 000.00 |
| E2 | Equal principal, 100 000.00, 10%, N = 7 | `q = 14285.71`; p_7 = 14285.74; total interest 3 333.34; Σp = 100 000.00 |
| E3 | Annuity, 100 000.00, 12%, N = 12, upfront fee 2% paid at closing | `A = 8884.88`, last 8884.85; US APR 15.854%; UK APRC 17.1% |
| E3b | Same without fee | US APR 12.000%; effective IRR 12.68% |
| E4 | Loan 100, fee 8 paid at closing, 12 monthly payments of 9 | CN 年化利率（单利）(IRR × 12) 30.69%; IRR method (compound) 35.39% |
| E5 | Annuity, 2 700.00, 6.5%, N = 6 | I_1 = 14.625 exactly: half-up 14.63, half-even 14.62 |
| E6 | Annuity, 1 500.00, 6.5%, N = 1 | `A* = 1508.125` exactly → `A = 1508.13` |
| E7 | Annuity, 350 000.00, 6.875%, 30 years, 1% fee paid at closing | `A = 2299.25`; last 2300.28; total interest 477 731.03; US APR 6.974% |

All examples are golden vectors in `tests/vectors/core` (§14).

## 6. Fees and insurance

### 6.1 Upfront fee

- `calc = fixed` (whole minor units) or `percent` of the requested amount:
  `U = R_fee(amount × pct / 100)`.
- `financing = paid` (default): paid by the borrower at `D0`; `P = amount`.
- `financing = financed`: added to the loan; `P = amount + U`; the borrower receives
  `amount`.

### 6.2 Periodic fees

- Charged every period k = 1..N_actual. Types:
  - `fixed`: the same amount every period (whole minor units);
  - `pct-original`: `R_fee(amount × p / 100)` per period, `amount` = requested amount;
  - `pct-balance`: `R_fee(B_{k−1} × p / 100)` per period.
- `p` is a percentage **per payment period** (a 1.5 % monthly commission is entered as
  1.5 with monthly payments).
- Fees never reduce principal; they are separate ledger columns.

### 6.3 Insurance

- Same types as periodic fees; separate ledger line so it can be shown and excluded
  independently.

### 6.4 APR inclusion

- Every fee and insurance item has `inApr: boolean`; the engine default is `true`.
  Region profiles (T05) supply defaults: US — finance charges included, optional
  insurance and optional products excluded; UK, EU, CN, UA, International — all
  mandatory costs included.

### 6.5 Other one-off fees **(M3)**

- A fee at a given period or recurring every n periods (e.g. annual service fee).

## 7. Events **(M3)**

### 7.1 Prepayments (extra principal)

- One-time (at payment k or on a date), recurring (every period from k1 to k2), annual
  lump sum (every year in month M).
- Applied after the scheduled payment of the same date (default). Mid-period dates
  split interest accrual: old balance until the prepayment date, new balance after.
- Strategy:
  - `reduce-term` (default): keep `A` (annuity) or `q` (equal principal); the loan
    ends earlier.
  - `reduce-payment`: recast — recompute `A` (or `q`) on the new balance over the
    remaining periods, keeping the maturity date.
- Penalty / early repayment charge: % of the prepaid amount or fixed; optional free
  allowance per contract year (% of balance at the start of that year, or % of the
  original amount); the penalty applies to the excess only. Penalties are a separate
  column and are not principal.

### 7.2 Rate changes

- List of `{ effectiveFrom: period | date, rate }` (covers fixed-then-variable and rate
  paths).
- `onRateChange = recalc-payment` (default): recast `A` over the remaining term at the
  new rate. `keep-payment`: keep `A`, the term changes; if `A ≤ interest` →
  error `NEG_AMORTIZATION` (or explicit capitalization if the user allows it).

### 7.3 Payment holidays

- `{ start, length, type }`, type: `interest-only` | `full` | `reduced` (pay x% of `A`).
- Unpaid interest is capitalized (added to the balance) and shown in its own column.
- `after = extend-term` (default; maturity moves by `length` periods) | `keep-term`
  (recast over the remaining periods).
- A holiday may cover the last period only with `extend-term`.

### 7.4 Order inside a period

1. Rate in effect for the period. 2. Interest accrued on the opening balance.
3. Holiday rules. 4. Scheduled payment allocation: fees → interest → principal.
5. Extra principal. 6. Penalty. 7. Recast for the next period if required.

### 7.5 Irregular first period and payment day

- `F ≠ D0 + 1 period` creates a long or short first period.
- `oddInterest = add-to-first-payment` (default): the regular `A` is computed on
  standard periods; first-period interest accrues over the real length (day-count:
  actual YF; periodic: `i × (whole periods + extra days / standard period days)`, with
  30 days per month-based period, 7 / 14 for weeks); the difference is added to the
  first payment.
- `oddInterest = prepaid` (US style): interest from `D0` to `F − 1 period` is paid at
  closing as a prepaid finance charge; the first period is then standard.

## 8. Ledger

### 8.1 Row

`index, date, days, annualRate, opening, interestAccrued, interestPaid,
interestCapitalized, principal, extraPrincipal, fees, insurance, penalty, payment,
closing, cumulativeInterest, cumulativePrincipal, events[]`.

- `days` = actual days from the previous schedule date (`D0` for the first row).
- `fees` = sum of the periodic fee items of the period; `insurance` = sum of the
  insurance items. Per-item amounts MAY be exposed in addition.
- `cumulativePrincipal` includes extra principal.
- In M1 `interestCapitalized`, `extraPrincipal` and `penalty` are zero and
  `interestPaid = interestAccrued`.

### 8.2 Summary

| Field | Definition |
|---|---|
| `amount` | requested amount |
| `principalFinanced` | `P` = amount + financed upfront fees |
| `netProceeds` | amount − upfront fees paid at closing |
| `upfrontFeesPaid`, `upfrontFeesFinanced` | totals of upfront fees by financing |
| `amountFinancedForRates` | the inflow at `D0` used by rate metrics (§9.1) |
| `regularInstalment` | `A` for annuity and balloon; `null` otherwise |
| `principalPerPeriod` | `q` for equal principal; `null` otherwise |
| `firstPayment`, `lastPayment`, `maxPayment` | `payment_1`, `payment_N`, max `payment_k` (fees included) |
| `paymentsCount` | actual number of payments (after early close) |
| `firstPaymentDate`, `payoffDate` | dates of the first and last payment |
| `totalPayments` | `Σ payment_k` |
| `totalPaid` | `totalPayments` + upfront fees paid at closing |
| `totalInterest` | `Σ interestAccrued_k` |
| `totalPrincipal` | `Σ (principal_k + extraPrincipal_k)` (= `P` + capitalized interest) |
| `totalFees` | `Σ` periodic fees + all upfront fees (paid and financed) |
| `totalInsurance`, `totalPenalties` | sums of the columns |
| `costOfCredit` | `totalPaid − amount` (= interest + fees + insurance + penalties) |
| `balloon` | balloon type: `p_N − (A − I_N)`, `0` after an early close; `null` otherwise |

With events **(M3)** also `interestSaved` and `timeSaved` versus the same scenario
without voluntary events.

### 8.3 Invariants (MUST hold exactly; checked by property tests)

- **I1** `closing_k = opening_k + interestCapitalized_k − principal_k − extraPrincipal_k`.
- **I2** `payment_k = interestPaid_k + principal_k + extraPrincipal_k + Σfees_k + insurance_k + penalty_k`.
- **I3** `interestAccrued_k = interestPaid_k + interestCapitalized_k`.
- **I4** `opening_1 = principalFinanced`; `opening_{k+1} = closing_k`.
- **I5** final `closing = 0`.
- **I6** `Σ(principal + extraPrincipal) = principalFinanced + Σ interestCapitalized`.
- **I7** every amount is an exact multiple of the minor unit.
- **I8** annuity: `principal_k + interestPaid_k = A` for every regular period between
  events, except the final period.
- **I9** no balance is negative.

## 9. Cost-of-credit metrics

### 9.1 Cash flows used by rate metrics (borrower perspective)

- `t = D0`: inflow = `amount + Σ(financed upfront items with inApr = false) −
  Σ(upfront items paid at closing with inApr = true)` (prepaid interest included when
  `oddInterest = prepaid`, M3). This is Regulation Z's "amount financed": the principal
  less prepaid and financed finance charges. A financed item that is not a finance
  charge is credit the borrower receives.
- `t = date_k`: outflow = `interestPaid_k + principal_k + Σ(periodic fee and insurance
  items with inApr)`.
- Voluntary prepayments and penalties are excluded from disclosure rates (the contract
  is assumed to run to term). They are included in the "actual effective rate" (§9.5).

### 9.2 Generic metrics (always available)

| Id | Definition | Display |
|---|---|---|
| `nominal` | `j` as entered | as entered, at least 2 decimals ("6.875", "6.50") |
| `effective` | contract rate without fees: periodic `(1 + j/c)^c − 1`; continuous `e^j − 1`; day-count `(1 + j·k/m)^m − 1` with `k = 365/360` for `act-360` (a 365-day year of ACT/360 interest), else `k = 1` | 2 dp |
| `irrNominal` | periodic IRR `r` on uniform periods × `m` | 2 dp |
| `irrEffective` | `(1 + r)^m − 1` | 2 dp |
| `xirr` | `X` with `Σ CF_k (1 + X)^−τ_k = 0`, `τ_k = days(D0, t_k) / 365` (Excel XIRR convention, also in leap years) | 2 dp |

### 9.3 Regional disclosure methods

**(a) US — APR** (TILA, Regulation Z, Appendix J, actuarial method).
- Amount financed `A_f` = cash-flow inflow at `D0` (§9.1).
- Unit-period (App. J (b)(4)): the most frequent common period of the schedule (monthly
  → 12 per year, weekly → 52, bi-weekly → 26, semi-monthly → 24, quarterly → 4, …); ties
  → the shorter. For a single advance and a single payment the unit-period is the term,
  at most one year ((b)(4)(ii)).
- For each payment, count unit-periods from `D0` per (b)(5): monthly — full months
  measured back from the payment date, the remaining days ÷ 30 give the fraction `f_k`;
  months are all equal, payments due on the last day of the month are measured month
  end to month end, and payments due on the 29th or 30th use the last day of February
  ((b)(3)(iv)); multi-month unit-periods — 30 days per full month back plus remaining
  days, divided by 30 × months per unit; weekly / multi-week — days ÷ days per unit;
  yearly — full years back, remainder in months ÷ 12 or days ÷ 365.
- Solve for the unit-period rate `i`:
  `A_f = Σ_k P_k / ((1 + f_k·i)(1 + i)^{t_k})`; `APR = i × unit-periods per year`.
- Regular schedules with N ≥ 2 (M1) place every payment a whole number of unit-periods
  after `D0` — dates clamped or moved to month ends by §2.1 included, by (b)(3)(iv) —
  so `t_k = k`, `f_k = 0` and `APR = r × m`.
- **Single payment** (N = 1, or two explicit flows), (b)(5)(v)–(vii). With `P` the
  payment and `i = P / A_f − 1`:
  - term shorter than a year and a whole number `M` of months: `APR = i × 12 / M`
    ((b)(5)(vi) also allows 365 / days; LoanLogic uses 12 / M);
  - term shorter than a year otherwise: `APR = i × 365 / days`. Months are counted back
    from the payment date as in §2.1: 31 January → 28 February 2026 is 28 days, not a
    month, while 28 February → 31 March 2026 is one whole month (vectors
    `regz-single-payment-month-end-days` and `regz-single-payment-month-end-clamp`);
  - term of a year or more: the unit-period is a year; `t` = full years counted back
    from the payment date, `f` = the remaining months ÷ 12, or the remaining days ÷ 365
    when the remainder is not a whole number of months; solve
    `A_f (1 + f·i)(1 + i)^t = P` and `APR = i`.
  Example: 300.00 with a 45.00 finance charge added, repaid as 345.00 after 14 days:
  `APR = 15 % × 365/14 = 391.071 %`, not 15 % × 26 = 390.000 % (vector
  `payday-biweekly-single-payment`).
- Display 3 decimals (e.g. 6.825%). Note in the explanation: accuracy tolerance
  ±1/8 percentage point for regular transactions, ±1/4 for irregular (§1026.22). TRID
  forms (Loan Estimate, Closing Disclosure) disclose percentages unrounded, up to three
  decimal places, with a whole number truncated at the decimal point
  (§1026.37(o)(4)(ii)); a display option in that style is an open item (M4).

**(b) UK — APR / APRC** (FCA Handbook: CONC App 1.2 for consumer credit, where the
rate is called APR; MCOB 10A for regulated mortgage contracts, where it is called APRC;
method id `ukAprc` for both).
- `Σ C_k (1 + X)^−t_k = Σ D_l (1 + X)^−s_l`, times in years from the first drawdown.
- A year has 365 days (366 in a leap year), 52 weeks or 12 equal months; an equal month
  is 365/12 days (CONC App 1.2.6 R(3)).
- Regular schedules (M1): every payment is a whole number of periods after `D0`:
  `t_k = k × months per period / 12` or `k × weeks per period / 52`, so
  `APRC = (1 + r)^m − 1`. Dates clamped or moved to month ends by §2.1 count as whole
  months; this is taken from Reg Z (b)(3)(iv), the UK and EU texts being silent on it.
- Irregular dates (explicit cash flows without periods, §9.7): equal periods (months
  for month-based frequencies, counted back as in §2.1; weeks otherwise) and then days
  are counted backwards from each date towards the first drawdown; the days are divided by the number of days (365
  or 366) of the complete year counted back from the last of those days to the same day
  of the previous year (MCOB 10A.2.3 R(3); CCD2 Annex III (c)). From 2028-02-20, the
  date 2028-04-25 is 2 months + 5/365 and 2028-04-05 is 1 month + 14/366 (vector
  `cashflows-irregular-aprc-backward-counting`). From 2026-01-31, the date 2026-03-31
  is exactly 2 months and 2026-04-30 is 2 months + 28/365, because 30 April − 3 months
  = 30 January falls before the drawdown (vector `cashflows-aprc-month-end-clamp`).
  MCOB 10.3.5 also allows 365.25-day
  years; LoanLogic does not use that option.
- Displayed with one decimal place, half-up (CONC App 1.2.6 R(3)(f); MCOB 10A.2.3 R(4)).

**(c) EU — APRC** (Directive 2008/48/EC Annex I; from 20 November 2026 Directive (EU)
2023/2225 (CCD2) Annex III; national names: TAEG, effektiver Jahreszins, RRSO, …).
Same equation and time rules as (b); equal month = 365/12 days. The 2008 text defines
only the year, week and equal month; CCD2 Annex III (c) adds the backward counting of
equal periods and days with the complete-year divisor, as in the Mortgage Credit
Directive 2014/17/EU Annex I. LoanLogic applies that counting to irregular dates under
both texts; regular schedules give the same result either way. At least one decimal
place is required → displayed with 1 dp.

**(d) CN — 年化利率** (PBOC Announcement [2021] No. 3).
- All loan costs (interest and loan-related fees) relative to the principal actually
  outstanding. Annualization may be compound or simple: the compound method is the
  internal-rate-of-return (IRR) method, and a simple figure must be labelled 单利. The
  announcement's annex discounts payment i of n per year with `(1 + IRR)^(i/n)`, so the
  IRR method gives `(1 + r)^m − 1`.
- `cnAnnualized` = `r × m`, the simple annualization banks and lending apps display,
  always labelled 年化利率（单利）; `irrEffective` = `(1 + r)^m − 1` is shown next to it
  as 年化利率（复利，IRR 法）. E4: 30.69 % and 35.39 %.
- The annex examples are vectors (`cn-pboc-annex-*`): 100 000 repaid as 110 000 after
  2 years → 4.88 %; 1 000 000 over 240 monthly payments of 6 599.6 → 5.00 % (单利) and
  5.12 % (IRR); 100 000 with a 1 000 fee and 12 payments of 8 833.3 → 12.80 % (单利) and
  13.58 % (IRR).
- Display 2 decimals.
- **Open:** the NFRA/PBOC rules on disclosing the comprehensive financing cost of
  personal loans (个人贷款业务明示综合融资成本规定, in force since 2026-08-01) and the
  industry self-regulatory norm of September 2026 are reported to annualize each cost
  item separately and sum the results. LoanLogic has not verified the primary texts;
  the CN method is reviewed against them before the CN profile ships (T05).

**(e) UA — реальна річна процентна ставка** (Law of Ukraine "On Consumer Credit"
No. 1734-VIII; Rules for calculating the total cost of credit and the real annual
interest rate, NBU Board Resolution No. 49 of 08.06.2017 as amended, last checked
against No. 159 of 25.12.2025; non-bank lenders: NBU Board Resolution No. 16 of
11.02.2021).
- The rate that discounts all borrower payments (principal, interest, fees, related
  services) to the net amount received. Annex 3 of the Rules writes the formula with `t`
  the ordinal number of a period (month or day); footnote 2 to Annex 2 recommends
  Excel's XIRR (ЧИСТВНДОХ) with the net amount in the first row. LoanLogic follows the
  recommendation: `xirr` with days/365 from the disbursement date. Display 2 decimals.

**(f) International** — `xirr` labelled "Effective all-in rate". Display 2 decimals.

**(g) RU — ПСК** (Federal Law 353-FZ, art. 6) — optional method, **(M4)**:
`ПСК = i × ЧБП × 100`; base period = the most frequent payment interval; ЧБП = number
of base periods in a 365-day year; solve `Σ ДП_k / ((1 + e_k·i)(1 + i)^{q_k}) = 0`
(`q_k` whole base periods, `e_k` fraction of a base period). Display 3 decimals.
Before implementing, verify the measurement of `e_k` against the law text and
Bank of Russia guidance.

### 9.4 Display precision and rounding

- Rates are solved in double precision (§10), then rounded for display with the
  method's precision using half-up (ties away from zero). Generic metrics: 2 dp by
  default (user option 2–4).
- An engine value matches a golden vector when it lies within
  `max(1e−7, 1e−9 × |v|)` percentage points of the vector's value `v` (§14). Vectors
  keep every rate at least ten times that tolerance away from a display boundary, so a
  conforming engine always displays the same string. Outside the vectors a rate that
  close to a boundary may display either way; the regulatory tolerances are far wider.

### 9.5 Actual effective rate **(M3)**

- `xirr` of the actual cash flows including voluntary prepayments and penalties:
  "your real cost if you follow this plan".

### 9.6 Result shape

`rates` maps every requested method id to a metric or a failure:

```ts
interface RateMetric {
  value: number;               // percent, unrounded: 6.97421… for 6.974 %
  display: string;             // rounded per §9.4: "6.974"; zero is "0.000", never "-0.000"
  precision: number;           // decimals of `display`
  warnings?: WarningCode[];    // metric-level codes, e.g. ['IRR_MULTIPLE']
  explain: { formulaId: string; values: Record<string, string> }; // decimal strings
}
interface RateFailure { ok: false; reason: 'IRR_NO_CONVERGENCE' }
```

The loan result also carries the instalment's payload in a top-level `explain`
(formula ids `instalment.*`). Golden vectors store `value` as a decimal string with 12
decimals, list `warnings` only when there are any, and omit `explain`. Explain values are decimal strings — exact when
the value is a terminating decimal, otherwise with at least 12 significant digits — so a
formula shown from them reproduces the result (the UI shows `i` as `j ÷ m`, e.g.
`0.06875 ÷ 12`, never as a rounded quotient).

| `formulaId` | `values` |
|---|---|
| `instalment.annuity` | `P`, `N`, `j`, `m` (and `i` when `c ≠ m` or in day-count mode with the exact basis), `Astar`, `A` |
| `instalment.balloon` | as `instalment.annuity`, plus `Bal` |
| `instalment.equal-principal` | `P`, `N`, `q` |
| `instalment.bullet` | `P`, `N`, `I1` (interest of the first period) |
| `rate.nominal` | `j` |
| `rate.effective` | `j`, `c` (periodic), or `m` and `k` (day-count) |
| `rate.periodic-irr` | `r` (periodic IRR), `m` — for `irrNominal`, `irrEffective`, `cnAnnualized`, and `usRegZApr` with N ≥ 2 |
| `rate.regz-single-payment` | `Af`, `P`, `days`, `months`, `unitPeriodsPerYear`, `i` (and `t`, `f` for a term of a year or more) |
| `rate.annual-irr` | `X`, `timeBasis` (`periods`, `counted-back` or `days-365`) — APRC and the XIRR family |

### 9.7 Explicit cash flows

`computeRateMetrics(input: CashFlowInput)` (§15) computes rate metrics of a cash-flow
list without a schedule: golden vectors of kind `cashflows` use it, and later
milestones use it for offers and actual flows. Flows are in non-decreasing date order;
times are measured from the first flow.

- Always: `xirr`, `uaRealAnnual`, `international` (days / 365).
- With `frequency` and a `period` on every flow — each date must be the schedule date
  `D0 + period` periods, with or without the end-of-month rule: `irrNominal`,
  `irrEffective` and `cnAnnualized` from the periods; `usRegZApr` as for a loan (`r × m`,
  or the single-payment rule of §9.3 (a) for exactly two flows); `ukAprc` and `euAprc`
  from whole periods.
- With `frequency` and no periods: `ukAprc` and `euAprc` with backward counting
  (§9.3 b); the frequency chooses months or weeks as the equal period. The periodic
  metrics are not computed (irregular Reg Z unit-periods come later).
- Without `frequency`: the XIRR family only.
- `nominal` and `effective` need a contract rate and are never computed here.

## 10. Solvers

- **Equations.** Periodic rate `r`: `Σ CF_k (1 + r)^−k = 0` over the period indices.
  Annual rate `X` (APRC, XIRR): `Σ CF_k (1 + X)^−t_k = 0` with `t_k` in years. Both are
  searched in `[−0.99, 1e7]`, i.e. −99 % to 10⁹ %, which covers every valid input of
  §3.4 (weekly 1 000 % nominal is an APRC of about 937 881 %).
- **Sign changes.** Flows at the same time are summed first; the signs of the sums are
  then counted in time order, skipping zeros.
  - None: there is no root; the metric fails.
  - One: the root is unique. Bracket `[−0.99, 1]`; while `f` has the same sign at both
    ends, double the upper end, at most up to 1e7.
  - More than one: enumerate. Evaluate `f` on the grid `x = −0.99 + k/2000` while
    `x < 1`, then `x = 1.05^k` while `x < 1e7`, then `x = 1e7`. Refine a root in every
    grid cell whose ends have opposite signs; a grid point where `f = 0` exactly is a
    root. Choose the smallest non-negative root, else the negative root closest to zero
    (MCOB 10.3.1B R(2): "the positive rate nearest to zero"), and add the warning
    `IRR_MULTIPLE` when more than one root was found. Two roots inside one grid cell can
    be missed; this is accepted.
- **Refinement.** A bracketing method — Brent's method is recommended; Newton steps
  only as an accelerator that falls back to bisection — stopping when the bracket is no
  wider than `1e−12 × max(1, |x|)`. A test on `|f|` MUST NOT be used to stop: it does
  not bound the error of the rate.
- **Overflow.** For `x < 0` evaluate `f(x) × (1 + x)^{t_max}` instead of `f(x)`: same
  sign, and `(1 + x)^−t` cannot overflow with 1 200 periods.
- In IEEE double precision this procedure meets the tolerance of §9.4 on every golden
  vector with a margin of more than 300× (checked with an independent Brent
  implementation).
- Failure → `{ ok: false, reason: 'IRR_NO_CONVERGENCE' }`. The UI shows "n/a" with the
  reason. No other number is substituted.

## 11. Analytics

### 11.1 NPV
`NPV(d) = Σ CF_k / (1 + d)^τ_k`, `d` annual effective, `τ_k = days(D0, t_k) / 365`
(uniform schedules MAY use `k/m`; the choice is reported).

### 11.2 Real (inflation-adjusted) value **(M4)**
- Price level `(1 + π)^τ`, `τ = days(D0, t) / 365`, `π > −100%` (deflation allowed).
- Real cost of a loan = `upfront paid at D0 + Σ payment_k / (1 + π)^τ_k`.
- Deposits: real value of receipts. Annual `π` MUST NOT be compounded as `π/m`.

### 11.3 Repayment-type comparison **(M4)**
Same scenario snapshot under each type: totals, NPV at the user discount rate,
first / maximum payment, total interest.

### 11.4 Offer comparison **(M4)**
Up to 5 offers: regional rate, total cost, NPV(d), monthly-equivalent payment
(`payment × m / 12`), maximum payment; winner per metric.

### 11.5 Break-even reinvestment rate **(M4)**
For plans A and B with the same amount: `Δ = CF_B − CF_A` on the union of dates.
If Δ has no sign change → one plan is cheaper at every discount rate ("dominates").
Otherwise `X*` = XIRR(Δ); verdict: "if your alternative return is below X*, plan … is
cheaper in present-value terms", direction taken from `NPV(Δ, 0)` and its slope.

### 11.6 Borrow vs pay cash **(M4)**
Inputs: price, cash available, loan scenario, expected return `R` (after tax).
Decision threshold: the loan's all-in `xirr`. Show terminal wealth of both paths at
the loan's maturity.

### 11.7 Invest vs prepay **(M4)**
Extra amount `X` (per period or lump sum). Path 1: prepay (`reduce-term`), then invest
the freed payments until the original maturity at `R`. Path 2: invest `X` at `R`.
Compare wealth at the original maturity; optional tax rate on investment gains.

### 11.8 Refinance **(M4)**
Inputs: current loan (balance at a date from the scenario, or manual balance, rate,
remaining term and type), new loan (any type and term), exit penalty (% / fixed), new
fees (paid or financed), cash-out. Outputs: new payment; monthly difference; simple
break-even months = costs / monthly saving (when saving > 0); first month where the
cumulative discounted saving ≥ costs; NPV of the difference over the longer horizon;
lifetime interest difference. Verdicts: `worth`, `long-payback`, `longer-term-trap`
(lower payment, NPV < 0), `shorter-term-win` (higher payment, NPV > 0), `no-change`
(identical cash flows), `not-worth`.

### 11.9 Payoff amount at a date **(M4)**
Closing balance after the last payment before the date + interest accrued to the date
(day-count: `B × j × YF`; periodic: `B × i × elapsed days / days in the current period`)
+ penalty + unpaid fees.

### 11.10 Goal seek **(M4)**
- Payment → amount: `P = A·(1 − (1 + i)^−N) / i`.
- Payment → term: `N = ceil(−ln(1 − P·i/A) / ln(1 + i))` for `i > 0`
  (`N = ceil(P / A)` for `i = 0`); if `A ≤ P·i` → error `NEVER_AMORTIZES`. The last
  payment is smaller than `A`.
- Payment → rate: solve `A = P·i / (1 − (1 + i)^−N)` for `i` (Brent), `j = i·m`; also
  report the regional rate with fees.
- The solved value is then run through the full schedule builder; the exact ledger is
  the result.

### 11.11 Affordability **(M5)**
- Monthly equivalent of any periodic amount: `x × m / 12`.
- Housing payment = P&I + property tax / 12 + home insurance / 12 + HOA + mortgage
  insurance (annual % of the original loan / 12 while LTV > the removal threshold;
  US defaults: removal on request at 80% and automatically at 78% of original value).
- DTI front-end = housing / gross monthly income; back-end = (housing + other monthly
  debts) / gross monthly income.
- Max loan: `A_max = income × DTI_max − other debts − non-P&I housing costs`;
  `P_max` from §11.10.
- LTV = loan / property value; CLTV = Σ liens / value.
- DSCR = annual NOI / annual debt service (all payments normalized to 12 months).
- Stress test: payment and DTI at `j + Δ` (default +3 pp).
- Profile defaults (editable guidelines, not law unless stated): US DTI 28/36
  (43 legacy QM), LTV 80% for mortgage insurance; UK income multiple 4.5×; CN monthly
  payment ≤ 50% of income; DSCR ≥ 1.25 comfortable, < 1.00 insufficient.
- Results are checks: `pass | warn | fail` + explanation + threshold source.

### 11.12 Deposits & savings **(M5)**
- Inputs: initial deposit, term, nominal rate, compounding frequency (independent of
  the term), capitalization or payout, contributions (amount, frequency, start or end of
  period), planned withdrawals, tax on interest (%), early termination rate (optional).
- Accrual: per compounding period `j/c`, or daily ACT/365 (option). Each interest
  credit is rounded to the minor unit; tax withheld = `R(interest × tax rate)`.
- Outputs: final balance, interest gross / net, total contributions, AER (UK) =
  `(1 + j/c)^c − 1`, APY (US Regulation DD, Appendix A:
  `APY = 100 × ((1 + interest / principal)^(365 / days) − 1)` for a single deposit),
  effective yield via `xirr` for contributions, real value (§11.2).

## 12. Multi-part loans **(M5)**

- K ≤ 10 parts; each is a full loan scenario with its own disbursement date.
- Consolidated ledger on the union of all dates; per-part ledgers are kept.
- Combined metrics: totals; blended all-in rate = `xirr` of combined flows; regional
  method when all parts share the frequency; principal-weighted average nominal rate as
  a reference.

## 13. Validation

- Structured errors `{ code, field, params? }`, localized by the UI. `field` is the path
  of the offending input — `amount`, `term.payments`, `accrual.mode`, `fees[2].value`,
  `balloon.kind`, `rateMethods[1]`, `flows[3].date` — or `null` when no single input is
  at fault. Raw exception text never reaches the user.
- **Phase 1 — fields.** Every field is checked on its own and all failures are reported
  together, at most one per field: the first that applies of type (missing or wrong
  type, unknown id, malformed string), range, whole minor units. Minor units are
  checked only when the currency is valid; a fee's `calc` only when its `kind` is
  valid; a fee item reports every failing property. A JSON number with an integral value
  (`12.0`) is an integer; booleans are not numbers.
- **Phase 2 — combinations**, only when phase 1 found nothing, reported together:
  `TERM_TOO_SHORT` and `TERM_RANGE` on `term` (N from years and months or an end date);
  `DATE_INVALID` on `disbursementDate` when the schedule would end after 9999-12-31;
  `UNSUPPORTED`; `BALLOON_RANGE`; `AMOUNT_TOO_SMALL_FOR_TERM`. The date and the
  amount checks need a valid N.
- **Phase 3 — schedule:** `NEG_AMORTIZATION`, reported alone.
- Properties the input contract (§15) does not use for the chosen options are ignored
  (e.g. `balloon` on an annuity, `financing` on a periodic fee).

| Code | Field | Condition |
|---|---|---|
| `INPUT_INVALID` | the field | missing required value, wrong type, unknown id, malformed decimal string, duplicate or empty fee id; cash flows: see below |
| `CURRENCY_INVALID` | `currency` | a string that is not in the ISO 4217 table (§1.2) |
| `AMOUNT_RANGE` | `amount`, `flows[i].amount` | `amount ≤ 0` or `> 1e15`; a flow amount whose absolute value exceeds 1e15 |
| `TOO_MANY_DECIMALS` | `amount`, `fees[i].value` (fixed), `balloon.value` (amount) | money not a whole number of minor units |
| `RATE_RANGE` | `annualRatePct` | `< −20` or `> 1000` |
| `TERM_RANGE` | `term.payments`, `term.years`, `term.months`, `term` | outside the limits of §2.4 |
| `TERM_TOO_SHORT` | `term` | the term gives `N < 1` |
| `DATE_INVALID` | `disbursementDate`, `term.endDate`, `flows[i].date` | a string that is not an existing `YYYY-MM-DD` date (year ≥ 1); on `disbursementDate` also a schedule ending after 9999-12-31 |
| `BALLOON_RANGE` | `balloon.value` | `0 < Bal < P` fails after rounding |
| `FEE_RANGE` | `fees[i].value` | negative |
| `UNSUPPORTED` | `accrual.paymentBasis` | a balloon with the exact payment basis |
| `AMOUNT_TOO_SMALL_FOR_TERM` | `amount` | equal principal, remainder first, `p_1 < 0` (§5.3) |
| `NEG_AMORTIZATION` | `null` | §5.1 |
| `FIRST_PAYMENT_DATE`, `HOLIDAY_RANGE` | — | reserved for M3 |

Cash flows (§9.7, §15) are `INPUT_INVALID` on: `flows` with fewer than two items;
`flows[i]` that is not an object; `flows[i].date` earlier than the previous flow's date
(when that one is valid);
`flows[i].amount` that is not a decimal string; `flows[i].period` when some flows have
a period and others not, or the period is not a non-negative integer, or the first is
not 0, or it decreases; `frequency` when it is unknown, or missing while periods are
given. Phase 2: `flows[n−1].date` equal to the first date; `flows[i].period` whose date
is not the schedule date `D0 + period` periods.

Warnings (`{ code, params }`, never block the result): `RATE_NEGATIVE`, `RATE_HIGH`
(§3.4), `EARLY_CLOSE` (§5.1), `IRR_MULTIPLE` (§10; also on the affected metrics as a
plain code). `IRR_NO_CONVERGENCE` is the `reason` of a failed metric, not an input
error.

## 14. Test vectors

- Location: `tests/vectors/<area>/<id>.json` (`core/` for M1). Generated by
  `tools/reference/generate.py` from `tools/reference/cases.py` with the independent
  reference implementation; never edited by hand. `generate.py --check` verifies that
  the files are up to date.
- Shape:
  `{ schemaVersion: 1, id, description, source, kind: "loan" | "cashflows", input, expected }`.
  `input` is passed to the engine unchanged (§15).
- `expected` for `kind = "loan"`: `{ ok: true, warnings, summary, rates, rows }` or
  `{ ok: false, errors }`; for `kind = "cashflows"`: `{ ok: true, rates }` or
  `{ ok: false, errors }`.
- Comparison rules:
  - every field present in `expected` is compared; fields that are absent are not
    (M1 rows omit `interestCapitalized`, `extraPrincipal` and `penalty`, which must be
    zero);
  - decimal strings are compared exactly as strings; `null` matches `null` or absent;
  - `warnings` and `errors` are compared as sets of `{ code }` and `{ code, field }`;
  - rates: the vector's `value` (percent, a decimal string with 12 decimals) within
    `max(1e−7, 1e−9 × |value|)` percentage points of the engine's unrounded value;
    `display` and `precision` equal; metric `warnings` compared as sets (absent = none);
    a metric `{ ok: false, reason }` must fail with that reason. `explain` is not
    compared.
- External cross-checks included: SPEC examples E1–E7, the three examples of the PBOC
  announcement's annex, the Microsoft Excel XIRR documentation example, the ISDA ACT/ACT
  example (§4), the Regulation Z single-payment rule (§9.3 a) and the CCD2/MCOB
  backward counting (§9.3 b).

## 15. Engine input contract

The engine's `calculateLoan(input)` accepts exactly this shape (TypeScript notation);
field names are normative because the golden vectors use them.

```ts
/** Plain decimal string: optional "-", digits without leading zeros, optional ".digits".
 *  No "+", no exponent, no grouping: "6.5", "-0.5", "100000.00". */
type DecimalString = string;
type FrequencyId = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
type DayCountId = '30u-360' | '30-360-isda' | '30e-360' | 'act-360' | 'act-365f' | 'act-act-isda';
type RoundingMode = 'half-up' | 'half-even' | 'ceil' | 'floor';
type PaymentRounding = 'minor-half-up' | 'minor-ceil' | 'unit-half-up' | 'unit-ceil';
type RateMethodId =
  | 'nominal' | 'effective' | 'irrNominal' | 'irrEffective' | 'xirr'
  | 'usRegZApr' | 'ukAprc' | 'euAprc' | 'cnAnnualized' | 'uaRealAnnual' | 'international';

interface LoanInput {
  currency: string;                    // ISO 4217 code (§1.2)
  amount: DecimalString;               // requested amount, major units
  annualRatePct: DecimalString;        // nominal annual rate in percent: "6.5" = 6.5 %
  repayment: 'annuity' | 'equal-principal' | 'bullet' | 'balloon';
  balloon?: { kind: 'amount' | 'percent'; value: DecimalString }; // required for balloon
  frequency: FrequencyId;
  term: { payments: number } | { years: number; months?: number } | { endDate: string };
  disbursementDate: string;            // YYYY-MM-DD
  endOfMonth?: boolean;                // default true (§2.1)
  accrual?:                            // default { mode: 'periodic' }
    | { mode: 'periodic'; compounding?: FrequencyId | 'continuous' } // default = frequency
    | { mode: 'daycount'; method: DayCountId; paymentBasis?: 'nominal' | 'exact' };
  rounding?: {
    interest?: RoundingMode;           // default 'half-up'
    fees?: RoundingMode;               // default 'half-up'
    payment?: PaymentRounding;         // default 'minor-half-up'
    principalRemainder?: 'last' | 'first'; // default 'last'
  };
  fees?: FeeInput[];
  rateMethods?: RateMethodId[];        // default: all
}

type FeeInput =
  | { id: string; kind: 'upfront'; calc: 'fixed' | 'percent'; value: DecimalString;
      financing?: 'paid' | 'financed'; inApr?: boolean }
  | { id: string; kind: 'periodic' | 'insurance'; calc: 'fixed' | 'pct-original' | 'pct-balance';
      value: DecimalString; inApr?: boolean };

/** Rate metrics of explicit cash flows (§9.7). Borrower view: + received, − paid.
 *  At least two flows in non-decreasing date order; `period` on every flow or on none. */
interface CashFlowInput {
  frequency?: FrequencyId;            // required when periods are given
  flows: { date: string; amount: DecimalString; period?: number }[];
}
```

## 16. References

- CFPB — Regulation Z, Appendix J (APR computations); §1026.22 (accuracy tolerances);
  §1026.37(o)(4) (rounding on the Loan Estimate).
  <https://www.consumerfinance.gov/rules-policy/regulations/1026/J/>
- CFPB — Regulation DD, Appendix A (APY).
  <https://www.consumerfinance.gov/rules-policy/regulations/1030/A/>
- FCA Handbook — CONC App 1.2 (APR for consumer credit not secured on land);
  MCOB 10A.2 (APRC for regulated mortgage contracts); MCOB 10.3 (APR, multiple
  solutions in 10.3.1B).
  <https://www.handbook.fca.org.uk/handbook/CONC/App/1/2.html>,
  <https://www.handbook.fca.org.uk/handbook/MCOB/10A/2.html>,
  <https://www.handbook.fca.org.uk/handbook/MCOB/10/3.html>
- Directive 2008/48/EC, Annex I (APR equation and assumptions).
  <https://www.legislation.gov.uk/eudr/2008/48/annex/I>
- Directive 2014/17/EU, Annex I (APRC of mortgage credit).
- Directive (EU) 2023/2225, Annex III (APRC, applicable from 20 November 2026).
- PBOC Announcement [2021] No. 3 on disclosing annualized loan rates and its annex
  采用内部收益率法计算贷款年化利率示例 (examples 1–3).
- NFRA and PBOC, 个人贷款业务明示综合融资成本规定 (announced 2026-03-15, in force
  2026-08-01) — reported by Xinhua; primary text not yet checked (§9.3 d).
- Law of Ukraine "On Consumer Credit" (No. 1734-VIII); NBU Board Resolution No. 49
  of 08.06.2017 (as amended, latest checked No. 159 of 25.12.2025); NBU Board Resolution
  No. 16 of 11.02.2021 (non-bank lenders).
  <https://bank.gov.ua/admin_uploads/law/08062017_49.pdf>,
  <https://bank.gov.ua/admin_uploads/law/11022021_16.pdf>
- Federal Law of the Russian Federation No. 353-FZ, art. 6.
- ISDA 2006 Definitions, §4.16 (day count fractions); ISDA, "EMU and market
  conventions: recent developments" (Actual/Actual example).
- ISO 4217 List One, published 2026-09-17 by SIX (ISO 4217 maintenance agency).
- Microsoft Support — XIRR function (example).

## 17. Change history

**v0.2.1 (2026-10-19)** — clarification asked during T02; no existing vector changes:

- §2.1: counting months back clamps the day to the earlier month's length, from the
  later date for every count, without the end-of-month rule; §9.3 (a) and (b) use it.
  Three vectors pin it.

**v0.2 (2026-10-19)** — resolved while building the reference implementation (R1) and
after three independent reviews of it:

- §1.6 new: exact evaluation of rational posted values (interest `B × j ÷ m`, `A*`,
  `q`, fees); tie behavior pinned by vectors; 40 significant digits and a 10^−15
  minor-unit guard for irrational values; `j = 0` is exact.
- §1.2: minor units from an embedded ISO 4217 table instead of `Intl`; N.A. codes
  rejected; money inputs must be whole minor units.
- §1.4/§1.5: `q` and percentage balloons always `half-up`; the payment policy applies
  to `A` only.
- §2.1/§2.3: schedule anchored on `D0` (`date_k = D0 + k periods`); `endOfMonth`
  input with default `true`; end-of-month schedules defined by their dates; dates up to
  9999-12-31.
- §2.4: limits for years and months; error fields.
- §3.2: rational `i` when `c/m` is an integer; continuous compounding supported.
- §3.4: negative payments allowed with negative rates; `RATE_NEGATIVE` / `RATE_HIGH`.
- §4: method ids; 30/360 US end-of-month condition taken from the dates.
- §5.1: `EARLY_CLOSE` warning; `NEG_AMORTIZATION` for annuity and balloon.
- §5.3: `AMOUNT_TOO_SMALL_FOR_TERM` for remainder-first.
- §5.5: balloon percentage of `P`, checked after rounding; exact basis `UNSUPPORTED`;
  no balloon after an early close.
- §6: percentage fees per payment period on the requested amount; `inApr` default.
- §8.1/§8.2: row and summary fields defined precisely.
- §9.1: financed items excluded from the APR raise the amount financed.
- §9.2: `effective` per accrual mode, with the 365/360 factor for ACT/360.
- §9.3: Reg Z single-payment rule; UK APR (CONC App 1.2) and APRC (MCOB 10A) named;
  backward counting with the complete-year divisor for irregular dates (CCD2, MCOB 10A;
  v0.1's "366 if the remainder falls in a leap year" and the claim that CCD2 left the
  time rules unchanged were wrong); CN simple annualization labelled 单利 with the IRR
  method beside it, the PBOC annex examples as vectors, the 2026 CN rules as an open
  item; UA sources updated and XIRR recorded as LoanLogic's choice.
- §9.4/§14: tolerance `max(1e−7 pp, 1e−9 relative)` and a display guard of ten
  tolerances (v0.1 had a guard smaller than the tolerance).
- §9.6: one result shape (`display`, string warnings, explain keys); §9.7 new: rules for
  explicit cash flows.
- §10: roots enumerated on a defined grid; smallest non-negative root; bracket-width
  stopping rule (v0.1's `|f|` test could miss the tolerance); range up to 1e7.
- §13: validation phases, precedence and exact field paths; cash-flow errors.
- §14/§15: vector format, comparison rules and the normative input contract.
