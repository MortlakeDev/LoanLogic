# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Loan schedule and summary per SPEC §1–§9 and §13 (M1 scope: no events).

``calculate_loan(input)`` takes the vector/engine input object (SPEC §15) and returns
either ``{"ok": True, "warnings", "summary", "rows", "rates"}`` or
``{"ok": False, "errors"}``. Every ledger amount is an exact multiple of the currency's
minor unit, computed with exact rational arithmetic and rounded only at the posting points
of SPEC §1.4.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, localcontext
from fractions import Fraction
from typing import Any, Callable

from . import rates as rate_metrics
from .currency import minor_units
from .dates import (
    FREQUENCIES,
    Frequency,
    as_int,
    days_between,
    is_last_day_of_month,
    iso,
    parse_iso,
    schedule_date,
)
from .daycount import DAY_COUNT_METHODS, year_fraction
from .numbers import (
    HIGH_PRECISION,
    ROUNDING_MODES,
    format_fixed,
    is_decimal_string,
    parse_decimal,
    quantum,
    round_certified,
    to_decimal,
)

REPAYMENT_TYPES = ("annuity", "equal-principal", "bullet", "balloon")
PAYMENT_ROUNDING = ("minor-half-up", "minor-ceil", "unit-half-up", "unit-ceil")
COMPOUNDING = tuple(FREQUENCIES) + ("continuous",)
FEE_KINDS = ("upfront", "periodic", "insurance")
UPFRONT_CALC = ("fixed", "percent")
PERIODIC_CALC = ("fixed", "pct-original", "pct-balance")

MAX_AMOUNT = Fraction(10**15)
MIN_RATE_PCT = Fraction(-20)
MAX_RATE_PCT = Fraction(1000)
MAX_PAYMENTS = 1200
MAX_TERM_YEARS = 100

# Approximated (irrational) ledger values must lie at least this many minor units away
# from a rounding boundary (SPEC §1.6); otherwise the input is unfit for a golden vector.
TIE_GUARD = Fraction(1, 10**15)


class InputError(Exception):
    def __init__(self, errors: list[dict[str, Any]]):
        super().__init__(errors)
        self.errors = errors


def _error(code: str, field_path: str | None) -> dict[str, Any]:
    return {"code": code, "field": field_path}


# ---------------------------------------------------------------------------------------
# Validation and normalization (SPEC §13).


@dataclass
class FeeItem:
    id: str
    kind: str
    calc: str
    value: Fraction
    financing: str
    in_apr: bool


@dataclass
class Loan:
    currency: str
    digits: int
    amount: Fraction
    rate_pct_text: str
    rate: Fraction  # annual nominal rate as a fraction (6.5 % -> 13/200)
    repayment: str
    balloon_kind: str | None
    balloon_value: Fraction | None
    freq: Frequency
    payments: int
    disbursement: date
    end_of_month: bool
    accrual_mode: str
    compounding: str | None
    day_count: str | None
    payment_basis: str
    interest_rounding: str
    fee_rounding: str
    payment_rounding: str
    principal_remainder: str
    fees: list[FeeItem]
    methods: list[str]
    dates: list[date]  # D0, date_1, ..., date_N (SPEC §2.3)
    upfront: "Upfront"
    residual: Fraction  # balloon residual Bal (0 for the other repayment types)
    warnings: list[dict[str, Any]] = field(default_factory=list)

    @property
    def unit(self) -> Fraction:
        return quantum(self.digits)

    @property
    def eom_schedule(self) -> bool:
        """End-of-month schedule (SPEC §2.1): month-based, and D0 and every payment date are
        the last day of their month. Used by 30/360 US (§4) and Reg Z measuring (§9.3 a)."""
        return self.freq.month_based and all(is_last_day_of_month(day) for day in self.dates)


def _decimal_field(
    errors: list[dict[str, Any]], raw: dict[str, Any], key: str, path: str
) -> Fraction | None:
    value = raw.get(key)
    if not is_decimal_string(value):
        errors.append(_error("INPUT_INVALID", path))
        return None
    return parse_decimal(value)


def _fits_minor_units(value: Fraction, digits: int) -> bool:
    """True if ``value`` is a whole number of minor units ("100.100" USD is fine)."""
    return (value * 10**digits).denominator == 1


def _date_field(
    errors: list[dict[str, Any]], raw: dict[str, Any], key: str, path: str
) -> date | None:
    value = raw.get(key)
    if not isinstance(value, str):
        errors.append(_error("INPUT_INVALID", path))
        return None
    parsed = parse_iso(value)
    if parsed is None:
        errors.append(_error("DATE_INVALID", path))
    return parsed


@dataclass(frozen=True)
class Upfront:
    """Upfront fee totals (SPEC §6.1, §9.1)."""

    paid: Fraction  # paid at closing
    financed: Fraction  # added to the loan
    apr_paid: Fraction  # paid at closing, inApr = true
    apr_financed_excluded: Fraction  # financed, inApr = false


def _upfront(fees: list[FeeItem], amount: Fraction, unit: Fraction, mode: str) -> Upfront:
    paid = financed = apr_paid = excluded = Fraction(0)
    for fee in fees:
        if fee.kind != "upfront":
            continue
        charge = (
            fee.value
            if fee.calc == "fixed"
            else round_certified(amount * fee.value / 100, unit, mode, exact=True, guard=TIE_GUARD)
        )
        if fee.financing == "financed":
            financed += charge
            if not fee.in_apr:
                excluded += charge
        else:
            paid += charge
            if fee.in_apr:
                apr_paid += charge
    return Upfront(paid, financed, apr_paid, excluded)


def _count_payments_to(end: date, start: date, freq: Frequency, eom: bool) -> int:
    """Number of schedule dates on or before ``end`` (stops after MAX_PAYMENTS + 1)."""
    count = 0
    while count <= MAX_PAYMENTS:
        following = schedule_date(start, freq, count + 1, eom)
        if following is None or following > end:
            break
        count += 1
    return count


def validate(raw: dict[str, Any]) -> Loan:
    """SPEC §13: phase 1 checks every field on its own and reports all failures together
    (at most one error per field); phase 2 checks combinations of valid fields."""
    if not isinstance(raw, dict):
        raise InputError([_error("INPUT_INVALID", None)])
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # --- Phase 1: fields ---------------------------------------------------------------
    currency = raw.get("currency")
    digits: int | None = None
    if not isinstance(currency, str):
        errors.append(_error("INPUT_INVALID", "currency"))
    else:
        digits = minor_units(currency)
        if digits is None:
            errors.append(_error("CURRENCY_INVALID", "currency"))

    amount = _decimal_field(errors, raw, "amount", "amount")
    if amount is not None:
        if amount <= 0 or amount > MAX_AMOUNT:
            errors.append(_error("AMOUNT_RANGE", "amount"))
        elif digits is not None and not _fits_minor_units(amount, digits):
            errors.append(_error("TOO_MANY_DECIMALS", "amount"))

    rate_pct = _decimal_field(errors, raw, "annualRatePct", "annualRatePct")
    if rate_pct is not None:
        if rate_pct < MIN_RATE_PCT or rate_pct > MAX_RATE_PCT:
            errors.append(_error("RATE_RANGE", "annualRatePct"))
        elif rate_pct < 0:
            warnings.append({"code": "RATE_NEGATIVE"})
        elif rate_pct > 100:
            warnings.append({"code": "RATE_HIGH"})

    repayment = raw.get("repayment")
    if repayment not in REPAYMENT_TYPES:
        errors.append(_error("INPUT_INVALID", "repayment"))

    raw_frequency = raw.get("frequency")
    freq = FREQUENCIES.get(raw_frequency) if isinstance(raw_frequency, str) else None
    if freq is None:
        errors.append(_error("INPUT_INVALID", "frequency"))

    disbursement = _date_field(errors, raw, "disbursementDate", "disbursementDate")

    end_of_month = raw.get("endOfMonth", True)
    if not isinstance(end_of_month, bool):
        errors.append(_error("INPUT_INVALID", "endOfMonth"))
        end_of_month = True

    # Term (SPEC §2.4).
    term = raw.get("term")
    term_mode: str | None = None
    payments: int | None = None
    years = months = 0
    end: date | None = None
    modes = [
        key for key in ("payments", "years", "endDate") if isinstance(term, dict) and key in term
    ]
    if not isinstance(term, dict) or len(modes) != 1:
        errors.append(_error("INPUT_INVALID", "term"))
    elif modes[0] == "payments":
        n = as_int(term["payments"])
        if n is None:
            errors.append(_error("INPUT_INVALID", "term.payments"))
        elif n < 1 or n > MAX_PAYMENTS:
            errors.append(_error("TERM_RANGE", "term.payments"))
        else:
            term_mode, payments = "payments", n
    elif modes[0] == "years":
        ok = True
        values: dict[str, int] = {}
        for key, upper in (("years", MAX_TERM_YEARS), ("months", 11)):
            value = as_int(term.get(key, 0))
            if value is None:
                errors.append(_error("INPUT_INVALID", f"term.{key}"))
                ok = False
            elif value < 0 or value > upper:
                errors.append(_error("TERM_RANGE", f"term.{key}"))
                ok = False
            else:
                values[key] = value
        if ok:
            term_mode, years, months = "years", values["years"], values["months"]
    else:
        end = _date_field(errors, term, "endDate", "term.endDate")
        if end is not None:
            term_mode = "endDate"

    # Accrual (SPEC §3).
    accrual = raw.get("accrual", {"mode": "periodic"})
    accrual_mode, compounding, day_count, payment_basis = "periodic", None, None, "nominal"
    if not isinstance(accrual, dict):
        errors.append(_error("INPUT_INVALID", "accrual"))
    elif accrual.get("mode") not in ("periodic", "daycount"):
        errors.append(_error("INPUT_INVALID", "accrual.mode"))
    elif accrual["mode"] == "periodic":
        # Defaults to the payment frequency.
        compounding = accrual.get("compounding")
        if compounding is None:
            compounding = freq.id if freq is not None else None
        elif compounding not in COMPOUNDING:
            errors.append(_error("INPUT_INVALID", "accrual.compounding"))
    else:
        accrual_mode = "daycount"
        day_count = accrual.get("method")
        if day_count not in DAY_COUNT_METHODS:
            errors.append(_error("INPUT_INVALID", "accrual.method"))
        payment_basis = accrual.get("paymentBasis", "nominal")
        if payment_basis not in ("nominal", "exact"):
            errors.append(_error("INPUT_INVALID", "accrual.paymentBasis"))

    # Rounding (SPEC §1.3–1.5, §5.3).
    rounding = raw.get("rounding", {})
    if not isinstance(rounding, dict):
        errors.append(_error("INPUT_INVALID", "rounding"))
        rounding = {}
    interest_rounding = rounding.get("interest", "half-up")
    fee_rounding = rounding.get("fees", "half-up")
    payment_rounding = rounding.get("payment", "minor-half-up")
    principal_remainder = rounding.get("principalRemainder", "last")
    for key, value, allowed in (
        ("interest", interest_rounding, ROUNDING_MODES),
        ("fees", fee_rounding, ROUNDING_MODES),
        ("payment", payment_rounding, PAYMENT_ROUNDING),
        ("principalRemainder", principal_remainder, ("last", "first")),
    ):
        if value not in allowed:
            errors.append(_error("INPUT_INVALID", f"rounding.{key}"))

    # Fees (SPEC §6): every property of every item is checked.
    fees: list[FeeItem] = []
    raw_fees = raw.get("fees", [])
    if not isinstance(raw_fees, list):
        errors.append(_error("INPUT_INVALID", "fees"))
        raw_fees = []
    seen_ids: set[str] = set()
    for index, fee in enumerate(raw_fees):
        path = f"fees[{index}]"
        if not isinstance(fee, dict):
            errors.append(_error("INPUT_INVALID", path))
            continue
        before = len(errors)
        fee_id = fee.get("id")
        if not isinstance(fee_id, str) or fee_id == "" or fee_id in seen_ids:
            errors.append(_error("INPUT_INVALID", f"{path}.id"))
        if isinstance(fee_id, str):
            seen_ids.add(fee_id)
        kind = fee.get("kind")
        if kind not in FEE_KINDS:
            errors.append(_error("INPUT_INVALID", f"{path}.kind"))
            kind = None
        calc = fee.get("calc")
        if kind is not None and calc not in (UPFRONT_CALC if kind == "upfront" else PERIODIC_CALC):
            errors.append(_error("INPUT_INVALID", f"{path}.calc"))
            calc = None
        value = _decimal_field(errors, fee, "value", f"{path}.value")
        if value is not None:
            if value < 0:
                errors.append(_error("FEE_RANGE", f"{path}.value"))
            elif calc == "fixed" and digits is not None and not _fits_minor_units(value, digits):
                errors.append(_error("TOO_MANY_DECIMALS", f"{path}.value"))
        financing = fee.get("financing", "paid") if kind == "upfront" else "paid"
        if financing not in ("paid", "financed"):
            errors.append(_error("INPUT_INVALID", f"{path}.financing"))
        in_apr = fee.get("inApr", True)
        if not isinstance(in_apr, bool):
            errors.append(_error("INPUT_INVALID", f"{path}.inApr"))
        if len(errors) == before:
            assert kind is not None and calc is not None and value is not None
            fees.append(FeeItem(fee_id, kind, calc, value, financing, in_apr))

    # Balloon (SPEC §5.5); the range is checked against P in phase 2.
    balloon_kind: str | None = None
    balloon_value: Fraction | None = None
    if repayment == "balloon":
        balloon = raw.get("balloon")
        if not isinstance(balloon, dict):
            errors.append(_error("INPUT_INVALID", "balloon"))
        else:
            balloon_kind = balloon.get("kind")
            if balloon_kind not in ("amount", "percent"):
                errors.append(_error("INPUT_INVALID", "balloon.kind"))
                balloon_kind = None
            balloon_value = _decimal_field(errors, balloon, "value", "balloon.value")
            if (
                balloon_value is not None
                and balloon_kind == "amount"
                and digits is not None
                and not _fits_minor_units(balloon_value, digits)
            ):
                errors.append(_error("TOO_MANY_DECIMALS", "balloon.value"))

    methods = raw.get("rateMethods", list(rate_metrics.ALL_METHODS))
    if not isinstance(methods, list):
        errors.append(_error("INPUT_INVALID", "rateMethods"))
        methods = []
    else:
        for index, name in enumerate(methods):
            if name not in rate_metrics.ALL_METHODS:
                errors.append(_error("INPUT_INVALID", f"rateMethods[{index}]"))

    if errors:
        raise InputError(errors)

    # --- Phase 2: combinations of valid fields ------------------------------------------
    assert digits is not None and amount is not None and rate_pct is not None
    assert freq is not None and disbursement is not None and isinstance(currency, str)
    if term_mode == "years":
        exact = Fraction((12 * years + months) * freq.per_year, 12)
        n = int(exact + Fraction(1, 2))  # roundHalfUp for non-negative values
    elif term_mode == "endDate":
        assert end is not None
        n = _count_payments_to(end, disbursement, freq, end_of_month)
    else:
        assert payments is not None
        n = payments
    dates: list[date] = []
    if n < 1:
        errors.append(_error("TERM_TOO_SHORT", "term"))
    elif n > MAX_PAYMENTS:
        errors.append(_error("TERM_RANGE", "term"))
    else:
        for k in range(n + 1):
            day = schedule_date(disbursement, freq, k, end_of_month)
            if day is None:
                errors.append(_error("DATE_INVALID", "disbursementDate"))
                break
            dates.append(day)
    if repayment == "balloon" and accrual_mode == "daycount" and payment_basis == "exact":
        errors.append(_error("UNSUPPORTED", "accrual.paymentBasis"))
    unit = quantum(digits)
    upfront = _upfront(fees, amount, unit, fee_rounding)
    principal = amount + upfront.financed
    residual = Fraction(0)
    if repayment == "balloon":
        assert balloon_value is not None
        if balloon_kind == "amount":
            residual = balloon_value
        else:
            residual = round_certified(
                principal * balloon_value / 100, unit, "half-up", exact=True, guard=TIE_GUARD
            )
        if residual <= 0 or residual >= principal:
            errors.append(_error("BALLOON_RANGE", "balloon.value"))
    if repayment == "equal-principal" and principal_remainder == "first" and 1 <= n <= MAX_PAYMENTS:
        q = round_certified(principal / n, unit, "half-up", exact=True, guard=TIE_GUARD)
        if principal - (n - 1) * q < 0:
            errors.append(_error("AMOUNT_TOO_SMALL_FOR_TERM", "amount"))
    if errors:
        raise InputError(errors)

    return Loan(
        currency=currency,
        digits=digits,
        amount=amount,
        rate_pct_text=raw["annualRatePct"],
        rate=rate_pct / 100,
        repayment=repayment,
        balloon_kind=balloon_kind,
        balloon_value=balloon_value,
        freq=freq,
        payments=n,
        disbursement=disbursement,
        end_of_month=end_of_month,
        accrual_mode=accrual_mode,
        compounding=compounding,
        day_count=day_count,
        payment_basis=payment_basis,
        interest_rounding=interest_rounding,
        fee_rounding=fee_rounding,
        payment_rounding=payment_rounding,
        principal_remainder=principal_remainder,
        fees=fees,
        methods=[name for name in rate_metrics.ALL_METHODS if name in methods],
        dates=dates,
        upfront=upfront,
        residual=residual,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------------------
# Periodic rate (SPEC §3.2).


@dataclass(frozen=True)
class PeriodicRate:
    """The periodic rate i, exact when rational, else a high-precision approximation."""

    value: Fraction
    exact: bool


def periodic_rate(loan: Loan) -> PeriodicRate:
    m = loan.freq.per_year
    j = loan.rate
    if j == 0:
        return PeriodicRate(Fraction(0), True)  # i = 0 exactly for every compounding (§3.2)
    if loan.accrual_mode == "daycount":
        return PeriodicRate(j / m, True)  # nominal payment basis (SPEC §5.2)
    if loan.compounding == loan.freq.id:
        return PeriodicRate(j / m, True)
    if loan.compounding == "continuous":
        with localcontext() as ctx:
            ctx.prec = HIGH_PRECISION
            approx = (to_decimal(j) / m).exp() - 1
        return PeriodicRate(Fraction(approx), False)
    c = FREQUENCIES[loan.compounding].per_year
    if c % m == 0:  # c/m is a positive integer: (1 + j/c)^(c/m) - 1 is rational
        return PeriodicRate((1 + j / c) ** (c // m) - 1, True)
    with localcontext() as ctx:
        ctx.prec = HIGH_PRECISION
        base = 1 + to_decimal(j) / c
        approx = (base.ln() * Decimal(c) / Decimal(m)).exp() - 1
    return PeriodicRate(Fraction(approx), False)


def effective_annual(loan: Loan) -> Callable[[], Decimal]:
    """The contract's effective annual rate without fees (SPEC §9.2 `effective`)."""
    j = loan.rate
    m = loan.freq.per_year

    def compute() -> Decimal:
        if loan.accrual_mode == "daycount":
            # A 365-day year of ACT/360 interest is j × 365/360 (SPEC §9.2).
            k = Fraction(365, 360) if loan.day_count == "act-360" else Fraction(1)
            return to_decimal((1 + j * k / m) ** m - 1)
        if loan.compounding == loan.freq.id:
            return to_decimal((1 + j / m) ** m - 1)
        if loan.compounding == "continuous":
            return to_decimal(j).exp() - 1
        c = FREQUENCIES[loan.compounding].per_year
        return to_decimal((1 + j / c) ** c - 1)

    return compute


# ---------------------------------------------------------------------------------------
# Schedule construction (SPEC §5).


def _annuity_exact(principal: Fraction, i: Fraction, n: int, residual: Fraction) -> Fraction:
    if i == 0:
        return (principal - residual) / n
    growth = (1 + i) ** n
    return (principal * growth - residual) * i / (growth - 1)


def _annuity_approx(principal: Fraction, i: Fraction, n: int, residual: Fraction) -> Fraction:
    with localcontext() as ctx:
        ctx.prec = HIGH_PRECISION
        i_dec = to_decimal(i)
        growth = (1 + i_dec) ** n
        value = (to_decimal(principal) * growth - to_decimal(residual)) * i_dec / (growth - 1)
    return Fraction(value)


def _pay_round(value: Fraction, loan: Loan, exact: bool) -> Fraction:
    policy = loan.payment_rounding
    step = loan.unit if policy.startswith("minor") else Fraction(1)
    mode = "half-up" if policy.endswith("half-up") else "ceil"
    return round_certified(value, step, mode, exact=exact, guard=TIE_GUARD)


def calculate_loan(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        loan = validate(raw)
    except InputError as problem:
        return {"ok": False, "errors": problem.errors}
    try:
        return _calculate(loan)
    except InputError as problem:
        return {"ok": False, "errors": problem.errors}


def _calculate(loan: Loan) -> dict[str, Any]:
    unit = loan.unit
    n = loan.payments
    amount = loan.amount
    warnings = list(loan.warnings)

    def fee_round(value: Fraction) -> Fraction:
        return round_certified(value, unit, loan.fee_rounding, exact=True, guard=TIE_GUARD)

    # Upfront fees (SPEC §6.1) and the balloon residual (SPEC §5.5), checked in validate().
    upfront_paid = loan.upfront.paid
    upfront_financed = loan.upfront.financed
    principal = amount + upfront_financed
    residual = loan.residual
    dates = loan.dates

    # Interest per period before rounding: (value, exact?).
    rate = periodic_rate(loan)

    def raw_interest(k: int, balance: Fraction) -> tuple[Fraction, bool]:
        if loan.accrual_mode == "daycount":
            assert loan.day_count is not None
            fraction = year_fraction(
                loan.day_count, dates[k - 1], dates[k], eom_schedule=loan.eom_schedule
            )
            return balance * loan.rate * fraction, True
        return balance * rate.value, rate.exact

    # Regular instalment (SPEC §5.2, §5.5) or principal per period (SPEC §5.3).
    instalment: Fraction | None = None
    principal_per_period: Fraction | None = None
    if loan.repayment in ("annuity", "balloon"):
        if loan.accrual_mode == "daycount" and loan.payment_basis == "exact":
            growth_all = Fraction(1)
            tail_sum = Fraction(0)
            tail = Fraction(1)
            factors = []
            for k in range(1, n + 1):
                fraction = year_fraction(
                    loan.day_count or "", dates[k - 1], dates[k], eom_schedule=loan.eom_schedule
                )
                factors.append(1 + loan.rate * fraction)
            for factor in factors:
                growth_all *= factor
            # sum over s of prod_{k = s+1..N} (1 + r_k), accumulated from the end.
            for factor in reversed(factors):
                tail_sum += tail
                tail *= factor
            exact_instalment = principal * growth_all / tail_sum
            instalment = _pay_round(exact_instalment, loan, True)
        elif rate.exact:
            instalment = _pay_round(_annuity_exact(principal, rate.value, n, residual), loan, True)
        else:
            instalment = _pay_round(
                _annuity_approx(principal, rate.value, n, residual), loan, False
            )
    elif loan.repayment == "equal-principal":
        principal_per_period = round_certified(
            principal / n, unit, "half-up", exact=True, guard=TIE_GUARD
        )

    rows: list[dict[str, Any]] = []
    balance = principal
    cumulative_interest = Fraction(0)
    cumulative_principal = Fraction(0)
    totals = {"payments": Fraction(0), "fees": Fraction(0), "insurance": Fraction(0)}
    payments_out: list[Fraction] = []
    flows = [
        rate_metrics.Flow(
            0, dates[0], amount + loan.upfront.apr_financed_excluded - loan.upfront.apr_paid
        )
    ]
    closed_at = n
    for k in range(1, n + 1):
        opening = balance
        interest_value, interest_exact = raw_interest(k, opening)
        interest = round_certified(
            interest_value, unit, loan.interest_rounding, exact=interest_exact, guard=TIE_GUARD
        )
        last = k == n
        if loan.repayment in ("annuity", "balloon"):
            assert instalment is not None
            principal_part = opening if last else instalment - interest
            if principal_part < 0:
                raise InputError([_error("NEG_AMORTIZATION", None)])
        elif loan.repayment == "equal-principal":
            assert principal_per_period is not None
            if loan.principal_remainder == "first":
                principal_part = (
                    principal - (n - 1) * principal_per_period if k == 1 else principal_per_period
                )
            else:
                principal_part = opening if last else principal_per_period
        else:  # bullet
            principal_part = opening if last else Fraction(0)
        if not last and principal_part >= opening:
            principal_part = opening
            last = True
            closed_at = k

        fees_k = Fraction(0)
        insurance_k = Fraction(0)
        apr_items = Fraction(0)
        for fee in loan.fees:
            if fee.kind == "upfront":
                continue
            if fee.calc == "fixed":
                charge = fee.value
            elif fee.calc == "pct-original":
                charge = fee_round(amount * fee.value / 100)
            else:
                charge = fee_round(opening * fee.value / 100)
            if fee.kind == "periodic":
                fees_k += charge
            else:
                insurance_k += charge
            if fee.in_apr:
                apr_items += charge

        payment = interest + principal_part + fees_k + insurance_k
        balance = opening - principal_part
        cumulative_interest += interest
        cumulative_principal += principal_part
        totals["payments"] += payment
        totals["fees"] += fees_k
        totals["insurance"] += insurance_k
        payments_out.append(payment)
        flows.append(rate_metrics.Flow(k, dates[k], -(interest + principal_part + apr_items)))
        rows.append(
            {
                "index": k,
                "date": iso(dates[k]),
                "days": days_between(dates[k - 1], dates[k]),
                "opening": opening,
                "interestAccrued": interest,
                "interestPaid": interest,
                "principal": principal_part,
                "fees": fees_k,
                "insurance": insurance_k,
                "payment": payment,
                "closing": balance,
                "cumulativeInterest": cumulative_interest,
                "cumulativePrincipal": cumulative_principal,
            }
        )
        if last:
            break

    if closed_at < n:
        warnings.append({"code": "EARLY_CLOSE"})

    _check_invariants(rows, principal, unit)

    paid_count = len(rows)
    balloon_part: Fraction | None = None
    if loan.repayment == "balloon":
        assert instalment is not None
        final = rows[-1]
        # After an early close (SPEC §5.1) no balloon is paid.
        balloon_part = (
            Fraction(0)
            if closed_at < n
            else final["principal"] - (instalment - final["interestAccrued"])
        )

    total_paid = totals["payments"] + upfront_paid
    summary_values: dict[str, Any] = {
        "amount": amount,
        "principalFinanced": principal,
        "netProceeds": amount - upfront_paid,
        "upfrontFeesPaid": upfront_paid,
        "upfrontFeesFinanced": upfront_financed,
        "amountFinancedForRates": flows[0].amount,
        "regularInstalment": instalment,
        "principalPerPeriod": principal_per_period,
        "firstPayment": payments_out[0],
        "lastPayment": payments_out[-1],
        "maxPayment": max(payments_out),
        "paymentsCount": paid_count,
        "firstPaymentDate": rows[0]["date"],
        "payoffDate": rows[-1]["date"],
        "totalPayments": totals["payments"],
        "totalPaid": total_paid,
        "totalInterest": cumulative_interest,
        "totalPrincipal": cumulative_principal,
        "totalFees": totals["fees"] + upfront_paid + upfront_financed,
        "totalInsurance": totals["insurance"],
        "totalPenalties": Fraction(0),
        "costOfCredit": total_paid - amount,
        "balloon": balloon_part,
    }
    digits = loan.digits
    summary = {
        key: (format_fixed(value, digits) if isinstance(value, Fraction) else value)
        for key, value in summary_values.items()
    }
    out_rows = [
        {
            key: (format_fixed(value, digits) if isinstance(value, Fraction) else value)
            for key, value in row.items()
        }
        for row in rows
    ]

    rates = rate_metrics.compute_rates(
        flows=flows,
        freq=loan.freq,
        eom=loan.eom_schedule,
        nominal_pct_text=loan.rate_pct_text,
        nominal_rate=loan.rate,
        effective_rate=effective_annual(loan),
        methods=loan.methods,
    )
    rate_warnings = sorted(
        {w for value in rates.values() for w in value.get("warnings", [])}  # type: ignore[union-attr]
    )
    for code in rate_warnings:
        warnings.append({"code": code})

    return {
        "ok": True,
        "warnings": warnings,
        "summary": summary,
        "rows": out_rows,
        "rates": rates,
    }


def _check_invariants(rows: list[dict[str, Any]], principal: Fraction, unit: Fraction) -> None:
    """SPEC §8.3 I1–I9 (M1: no capitalized interest, extra principal or penalties)."""
    assert rows[0]["opening"] == principal, "I4"
    total_principal = Fraction(0)
    for index, row in enumerate(rows):
        assert row["closing"] == row["opening"] - row["principal"], "I1"
        assert row["payment"] == (
            row["interestPaid"] + row["principal"] + row["fees"] + row["insurance"]
        ), "I2"
        assert row["interestAccrued"] == row["interestPaid"], "I3"
        if index > 0:
            assert row["opening"] == rows[index - 1]["closing"], "I4"
        for key in (
            "opening",
            "interestAccrued",
            "principal",
            "fees",
            "insurance",
            "payment",
            "closing",
        ):
            assert (row[key] / unit).denominator == 1, f"I7 {key}"
        assert row["closing"] >= 0 and row["opening"] >= 0, "I9"
        total_principal += row["principal"]
    assert rows[-1]["closing"] == 0, "I5"
    assert total_principal == principal, "I6"
