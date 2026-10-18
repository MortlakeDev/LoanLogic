# LoanLogic — Financial Methodology Specification

Status: v0.1 · Normative for the engine (`src/engine`). Keywords MUST / SHOULD / MAY are
used as in RFC 2119. If the code and this document disagree, this document wins. If this
document is ambiguous or looks wrong, the implementer stops and reports — financial
rules are never invented in code.

Sections marked **(M3)**, **(M4)**, **(M5)** are implemented in later milestones; they are
included now so the core design does not block them.

---

## 0. Principles

1. **Exact ledger.** Every monetary amount in a schedule is an exact multiple of the
   currency minor unit, computed with decimal arithmetic (decimal.js). Binary floating
   point MUST NOT be used for ledger amounts.
2. **Float analytics.** Rate solvers (IRR, XIRR, APR), NPV and other analytics MAY use
   IEEE-754 doubles on values converted from exact decimals. Results are displayed with
   method-specific precision (§9).
3. **Determinism.** Same input → same output, independent of locale, time zone and
   device.
4. **Explainability.** Every headline figure carries an `explain` payload: formula id,
   the inputs used and the key substituted values (§9.6).
5. **No silent fallbacks.** If a requested option cannot be applied, the engine returns
   a structured error or warning. It never computes something else instead.
6. **Data-driven regions.** Regional rules are expressed as method ids and profile data.
   Generic algorithms never branch on a country.

## 1. Numbers and rounding

### 1.1 Decimal configuration

- decimal.js with precision 40 significant digits. Intermediate results keep full
  precision; rounding happens only at the posting points in §1.4.

### 1.2 Currency minor units

- `minorUnits(currency)` = ISO 4217 fraction digits, taken from
  `Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits`,
  with an override table if Intl disagrees with ISO 4217.
- Required test values: USD 2, GBP 2, EUR 2, CNY 2, UAH 2, JPY 0, KRW 0, KWD 3.
- "Round to minor unit" = quantize to `10^-minorUnits`.

### 1.3 Rounding modes

| Id | Meaning | decimal.js |
|---|---|---|
| `half-up` | nearest; ties away from zero (commercial rounding) | `ROUND_HALF_UP` |
| `half-even` | nearest; ties to even (banker's rounding) | `ROUND_HALF_EVEN` |
| `ceil` | towards +∞ | `ROUND_CEIL` |
| `floor` | towards −∞ | `ROUND_FLOOR` |

### 1.4 Posting points (the only places where rounding happens)

1. The regular instalment `A` (payment rounding policy, §1.5).
2. Each period's interest (interest rounding mode, default `half-up`).
3. Each fee or insurance amount (fee rounding mode, default `half-up`).
4. The equal-principal instalment `q` (default `half-up`).
5. Capitalized or deferred interest amounts (same as interest).

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

The final payment always absorbs the remaining balance (§5).

## 2. Time

### 2.1 Dates

- Dates are calendar dates without time or zone: `LocalDate { y, m, d }`, implemented
  with integer arithmetic (days-from-civil). JS `Date` MUST NOT be used for date
  arithmetic; it is used only at the UI boundary (e.g. "today").
- `addMonths(date, n)`: same day-of-month, clamped to the month length
  (Jan 31 + 1 month = Feb 28/29).
- **End-of-month rule:** if the anchor date is the last day of its month and
  `eom = true` (default true in that case), every monthly-based date is the last day of
  its month (Jan 31 → Feb 29 → Mar 31 → Apr 30).
- Dates are always computed from the anchor (`anchor + k·period`), never by repeated
  addition, so month-end drift cannot occur.

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

- Disbursement date `D0`. First payment date `F`, default `F = D0 + 1 period`.
- `date_k = F + (k − 1) periods`, k = 1..N, with the end-of-month rule (§2.1).
- In M1, `F` MUST equal `D0 + 1 period`; irregular first periods are added in M3 (§7.5).

### 2.4 Term

The term is given in exactly one of three ways:

1. **Number of payments** `N` (1 ≤ N ≤ 1200).
2. **Years + months**: `N = roundHalfUp(totalMonths × m / 12)`. If `N < 1` →
   error `TERM_TOO_SHORT`. The resulting effective term is shown to the user
   (e.g. 7 months weekly → 30 payments).
3. **End date** `E`: `N` = number of schedule dates `date_k ≤ E`. If `N < 1` →
   error `TERM_TOO_SHORT`.

## 3. Interest rate model

### 3.1 Inputs

- Nominal annual rate `j` (entered in percent; engine uses decimal per annum).
- Accrual mode: `periodic` (default) or `daycount` with a method from §4.
- Compounding frequency `c` (periodic mode only): default `c = m`.

### 3.2 Periodic rate

- If `c = m`: `i = j / m`.
- If `c ≠ m`: `i = (1 + j/c)^(c/m) − 1`. Example: Canadian-style fixed mortgage,
  `c = 2`, `m = 12`.
- `c = continuous` MAY be supported: `i = e^(j/m) − 1`.

### 3.3 Day-count mode

- Interest for period k: `I_k = R_int(B_{k−1} × j × YF(date_{k−1}, date_k))`, with
  `date_0 = D0`. Compounding frequency is not used in this mode.

### 3.4 Negative and zero rates

- `j = 0` is valid (no interest; annuity `A* = P/N`).
- `j < 0` is valid down to −20% with a warning; negative interest is posted (rounded)
  and the loan still amortizes to zero.

## 4. Day-count conventions

`YF(d1, d2)` for `d1 ≤ d2`, with `d1 = (Y1, M1, D1)`, `d2 = (Y2, M2, D2)`:

- **30/360 US** (`30U/360`, SIA): apply in order —
  (1) if the schedule is end-of-month anchored, D1 is the last day of February and D2
  is the last day of February → D2 = 30;
  (2) if the schedule is end-of-month anchored and D1 is the last day of February →
  D1 = 30;
  (3) if D2 = 31 and D1 ≥ 30 → D2 = 30;
  (4) if D1 = 31 → D1 = 30.
  `YF = (360(Y2−Y1) + 30(M2−M1) + (D2−D1)) / 360`.
- **30/360 ISDA** (bond basis, 2006 ISDA Definitions §4.16(f)): if D1 = 31 → D1 = 30;
  if D2 = 31 and D1 = 30 (after adjustment) → D2 = 30. Same YF formula.
- **30E/360** (Eurobond basis, §4.16(g)): if D1 = 31 → 30; if D2 = 31 → 30.
- **ACT/360**: `days(d1, d2) / 360`.
- **ACT/365F**: `days(d1, d2) / 365`.
- **ACT/ACT ISDA**: split the interval at year boundaries;
  `YF = Σ days_in_year_y / (366 if leap(y) else 365)`.

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
  the schedule ends at k, and the summary reports the actual number of payments.

### 5.2 Annuity (equal instalments, 等额本息)

- Exact instalment (principal + interest, fees excluded):
  `A* = P·i / (1 − (1 + i)^−N)` for `i ≠ 0`; `A* = P / N` for `i = 0`.
- `A = R_pay(A*)` (§1.5).
- k < N: `p_k = A − I_k`. k = N: `p_N = B_{N−1}` (the last instalment absorbs
  rounding drift; it is typically within a few minor units of `A`).
- **Day-count mode — payment basis:**
  - `nominal` (default, common bank practice): `A` is computed with the periodic rate
    `i = j/m`; interest is charged by actual days (§3.3); the last instalment adjusts.
  - `exact`: `A*` solves the variable-rate recurrence with `r_k = j × YF_k`:
    `A* = P × Π_{k=1..N}(1 + r_k) / Σ_{s=1..N} Π_{k=s+1..N}(1 + r_k)`; then `A = R_pay(A*)`.

### 5.3 Equal principal (等额本金)

- `q = R(P / N)` (`half-up`).
- `remainder = last` (default): `p_k = q` for k < N, `p_N = B_{N−1}`.
- `remainder = first`: `p_1 = P − (N − 1)·q`, `p_k = q` for k ≥ 2.

### 5.4 Interest-only + bullet (先息后本)

- `p_k = 0` for k < N; `p_N = P`.

### 5.5 Balloon (partial amortization with residual)

- Residual `Bal` given as an amount or as % of `P`; `0 < Bal < P`
  (`Bal = 0` → annuity; `Bal = P` → bullet).
- `A* = (P − Bal·(1 + i)^−N) · i / (1 − (1 + i)^−N)` for `i ≠ 0`;
  `A* = (P − Bal) / N` for `i = 0`. `A = R_pay(A*)`.
- k < N: `p_k = A − I_k`; k = N: `p_N = B_{N−1}`. The ledger reports the balloon part
  of the last payment separately: `balloon = p_N − (A − I_N)`.
- Day-count mode uses the `nominal` payment basis.

### 5.6 Worked examples (half-up everywhere, periodic, monthly)

| # | Input | Expected |
|---|---|---|
| E1 | Annuity, 100 000.00 USD, 6.5%, N = 24 | `A* = 4454.6251433…`, `A = 4454.63`; I_1 = 541.67, p_1 = 3912.96; last payment 4454.51; total paid 106 911.00; total interest 6 911.00; Σp = 100 000.00 |
| E2 | Equal principal, 100 000.00, 10%, N = 7 | `q = 14285.71`; p_7 = 14285.74; total interest 3 333.34; Σp = 100 000.00 |
| E3 | Annuity, 100 000.00, 12%, N = 12, upfront fee 2% paid at closing | `A = 8884.88`, last 8884.85; US APR 15.854%; UK APRC 17.1% |
| E3b | Same without fee | US APR 12.000%; effective IRR 12.68% |
| E4 | Loan 100, fee 8 paid at closing, 12 monthly payments of 9 | CN 年化利率 (IRR×12) 30.69%; compound 35.39% |

## 6. Fees and insurance

### 6.1 Upfront fee

- Amount `U`: fixed, or % of `amount`; posted with fee rounding.
- `financing = paid` (default): paid by the borrower at `D0`; `P = amount`.
- `financing = financed`: added to the loan; `P = amount + U`; the borrower receives
  `amount`.

### 6.2 Periodic fees

- Charged every period k = 1..N_actual. Types:
  - `fixed`: the same amount every period;
  - `pct-original`: `R_fee(amount × p)` per period;
  - `pct-balance`: `R_fee(B_{k−1} × p)` per period.
- Fees never reduce principal; they are separate ledger columns.

### 6.3 Insurance

- Same types as periodic fees; separate ledger line so it can be shown and excluded
  independently.

### 6.4 APR inclusion

- Every fee and insurance item has `inApr: boolean`. Defaults come from the region
  profile: US — finance charges included, optional insurance excluded; UK, EU, CN, UA,
  International — all mandatory costs included.

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
interestCapitalized, principal, extraPrincipal, fees{…}, insurance, penalty, payment,
closing, cumulativeInterest, cumulativePrincipal, events[]`.

### 8.2 Summary

`amount, principalFinanced, netProceeds, regularInstalment (A), firstPayment,
lastPayment, paymentsCount, payoffDate, totalPaid, totalInterest, totalFees,
totalInsurance, totalPenalties, costOfCredit, balloon, rates{…}` plus, with events,
`interestSaved` and `timeSaved` versus the same scenario without voluntary events.

- `totalPaid = Σ payment_k + upfront fee paid at closing`.
- `totalInterest = Σ interestAccrued_k`.
- `costOfCredit = totalPaid − amount` (= interest + fees + insurance + penalties).

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

- `t = D0`: inflow = `amount − Σ(upfront items paid at closing with inApr)` (prepaid
  interest included when `oddInterest = prepaid`).
- `t = date_k`: outflow = `interestPaid_k + principal_k + Σ(fees_k, insurance_k with inApr)`.
- Voluntary prepayments and penalties are excluded from disclosure rates (the contract
  is assumed to run to term). They are included in the "actual effective rate" (§9.5).

### 9.2 Generic metrics (always available)

| Id | Definition |
|---|---|
| `nominal` | `j` as entered |
| `effective` | contract rate without fees: `(1 + j/c)^c − 1` (periodic, `c = m` by default) |
| `irrNominal` | periodic IRR `r` on uniform periods × `m` |
| `irrEffective` | `(1 + r)^m − 1` |
| `xirr` | `X` with `Σ CF_k (1 + X)^−τ_k = 0`, `τ_k = days(D0, t_k) / 365` |

### 9.3 Regional disclosure methods

**(a) US — APR** (TILA, Regulation Z, Appendix J, actuarial method).
- Amount financed `A_f` = cash-flow inflow at `D0` (§9.1).
- Unit-period: the most frequent common period of the schedule (monthly → 12 per year,
  weekly → 52, bi-weekly → 26, semi-monthly → 24, quarterly → 4, …); ties → the shorter.
- For each payment, count unit-periods from `D0` per Appendix J (b)(5): monthly —
  whole months measured back from the payment date (29th–31st → use the last day of a
  shorter month), the remaining days ÷ 30 give the fraction `f_k`; multi-month
  unit-periods — 30 days per whole month back plus remaining days, divided by
  30 × months-per-unit; weekly / multi-week — days ÷ days-per-unit; yearly — whole years
  back, remainder in months ÷ 12 or days ÷ 365.
- Solve for the unit-period rate `i`:
  `A_f = Σ_k P_k / ((1 + f_k·i)(1 + i)^{t_k})`; `APR = i × unit-periods per year`.
- Display 3 decimals (e.g. 6.825%). Note in the explanation: accuracy tolerance
  ±1/8 percentage point for regular transactions, ±1/4 for irregular (§1026.22).

**(b) UK — APRC** (CONC App 1, MCOB 10.3).
- `Σ C_k (1 + X)^−t_k = Σ D_l (1 + X)^−s_l`, times in years from the first drawdown.
- A year is 365 days (366 in a leap year), 52 weeks or 12 equal months. Month-based
  intervals → months / 12; week-based → weeks / 52; otherwise whole months / 12 plus
  remaining days / 365 (366 if the remainder falls in a leap year).
- Display rounded to 1 decimal place, half-up (MCOB 10.3.4).
- For a regular monthly schedule this equals `(1 + r)^12 − 1`.

**(c) EU — APRC** (Directive 2008/48/EC Annex I; national names: TAEG,
effektiver Jahreszins, RRSO, …). Same equation and time rules as (b); equal month =
365/12 days; at least one decimal place → displayed with 1 dp (2 dp optional).
Check the replacement Directive (EU) 2023/2225 before release for any change.

**(d) CN — 年化利率** (PBOC Announcement [2021] No. 3).
- All loan costs (interest + loan-related fees) relative to the principal actually
  outstanding; IRR method.
- Headline: periodic IRR `r` × `m` (simple annualization, market practice; E4 gives
  30.69%). Also shown: compound `(1 + r)^m − 1`, labelled 复利.
- Display 2 decimals.

**(e) UA — реальна річна процентна ставка** (Law of Ukraine "On Consumer Credit";
NBU Board Resolution No. 49 of 08.06.2017).
- The rate that discounts all future borrower payments (principal, interest, fees,
  related services) to the net amount received; NBU recommends XIRR on actual dates →
  `xirr` with days/365. Display 2 decimals.

**(f) International** — `xirr` labelled "Effective all-in rate". Display 2 decimals.

**(g) RU — ПСК** (Federal Law 353-FZ, art. 6) — optional method, **(M4)**:
`ПСК = i × ЧБП × 100`; base period = the most frequent payment interval; ЧБП = number
of base periods in a 365-day year; solve `Σ ДП_k / ((1 + e_k·i)(1 + i)^{q_k}) = 0`
(`q_k` whole base periods, `e_k` fraction of a base period). Display 3 decimals.
Before implementing, verify the measurement of `e_k` against the law text and
Bank of Russia guidance.

### 9.4 Display precision and rounding

- Rates are solved in double precision, then rounded for display with the method's
  precision using half-up. Generic metrics: 2 dp by default (user option 2–4).

### 9.5 Actual effective rate **(M3)**

- `xirr` of the actual cash flows including voluntary prepayments and penalties:
  "your real cost if you follow this plan".

### 9.6 Result shape

Each metric returns
`{ id, value, displayValue, precision, method, inputs, warnings[], explain }` where
`explain = { formulaId, values: { name → decimal string } }`.

## 10. Solvers

- Root finding: bracketed Brent's method. Periodic IRR on `r ∈ (−0.99, 1]`, expanded
  up to 100 per period; XIRR / APRC on `X ∈ (−0.99, 10]`, expanded up to 1000.
- Stop when `|Δr| < 1e−12` or `|f(r)| < 1e−9 × Σ|CF|`; at most 200 iterations.
- Newton's method MAY be used as an accelerator but MUST fall back to Brent.
- More than one sign change in the cash flows → compute, but add warning
  `IRR_MULTIPLE` and choose the root closest to the contract rate.
- Failure → `{ ok: false, reason }`. The UI shows "n/a" with the reason. No other
  number is substituted.

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

- Structured errors `{ code, field, params }`, localized by the UI. Raw exception text
  never reaches the user.
- Limits: amount `(0, 1e15]`; rate `[−20%, 1000%]` (warning above 100% or below 0%);
  `N ∈ [1, 1200]`; fees and insurance ≥ 0; balloon `0 < Bal < P`.
- Initial codes: `AMOUNT_RANGE`, `RATE_RANGE`, `TERM_RANGE`, `TERM_TOO_SHORT`,
  `BALLOON_RANGE`, `FEE_RANGE`, `DATE_INVALID`, `FIRST_PAYMENT_DATE` (M1: must equal
  `D0 + 1 period`), `NEG_AMORTIZATION`, `NEVER_AMORTIZES`, `IRR_NO_CONVERGENCE`,
  `IRR_MULTIPLE` (warning), `HOLIDAY_RANGE` (M3).

## 14. Test vectors

- Location: `tests/vectors/<area>/<id>.json`, generated by the independent reference
  implementation in `tools/reference` and by external sources.
- Shape: `{ id, description, source, input, expected: { summary, rows[], rates{} } }`.
- Ledger values are compared exactly (decimal strings). Rates: |Δ| < 1e−6 percentage
  points before display rounding, equal after display rounding.
- External cross-checks to include: closed-form PMT; Excel-compatible XIRR examples;
  Regulation Z APR examples; the PBOC example (E4); E1–E3 above.

## 15. References

- CFPB — Regulation Z, Appendix J (APR computations); §1026.22 (accuracy tolerances).
  <https://www.consumerfinance.gov/rules-policy/regulations/1026/J/>
- CFPB — Regulation DD, Appendix A (APY).
  <https://www.consumerfinance.gov/rules-policy/regulations/1030/A/>
- FCA Handbook — MCOB 10.3 (APRC formula and rounding); CONC App 1.
  <https://www.handbook.fca.org.uk/handbook/MCOB/10/3.html>
- Directive 2008/48/EC, Annex I (APR equation and assumptions).
  <https://www.legislation.gov.uk/eudr/2008/48/annex/I>
- PBOC Announcement [2021] No. 3 on disclosing annualized loan rates.
- Law of Ukraine "On Consumer Credit" (No. 1734-VIII); NBU Board Resolution No. 49
  of 08.06.2017.
- Federal Law of the Russian Federation No. 353-FZ, art. 6.
- ISDA 2006 Definitions, §4.16 (day count fractions).
