# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Cost-of-credit metrics (SPEC §9) and root finding (SPEC §10).

Rates are solved in high-precision decimal arithmetic (``SOLVER_PRECISION`` digits,
bracket width ``SOLVER_TOLERANCE``), so the reference values are exact to far more digits
than the engine's double-precision results are compared against (SPEC §14).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, localcontext
from fractions import Fraction
from math import gcd
from typing import Callable, Sequence

from .dates import (
    FREQUENCIES,
    Frequency,
    add_months,
    as_int,
    days_between,
    days_in_month,
    parse_iso,
    schedule_date,
)
from .numbers import NearTieError, decimal_places, is_decimal_string, parse_decimal, to_decimal

SOLVER_PRECISION = 80
SOLVER_TOLERANCE = Decimal("1e-45")
# Sign scan of the root enumeration (SPEC §10) runs with fewer digits; roots are then
# refined with SOLVER_PRECISION.
SCAN_PRECISION = 34
# Comparison tolerance of a rate value (SPEC §14): max(1e-7 pp, 1e-9 × |value|). A display
# value is certified only when the unrounded percent lies at least ten tolerances away from
# a rounding boundary, so an engine within the tolerance always displays the same string.
TOLERANCE_PP = Decimal("1e-7")
TOLERANCE_RELATIVE = Decimal("1e-9")
GUARD_FACTOR = 10
# Root search range (SPEC §10), the same for periodic and annual rates.
LOWER = Decimal("-0.99")
UNIFORM_TO = Decimal(1)
UPPER = Decimal(10_000_000)
# Enumeration grid: uniform steps on [LOWER, UNIFORM_TO], then geometric up to UPPER.
GRID_STEP = Decimal("0.0005")
GRID_GROWTH = Decimal("1.05")
# A metric annualized from a solved rate (x × m, (1 + x)^m − 1, the single-payment APR)
# must stay within the range too: |value| ≤ 1e7, i.e. 1e9 % (SPEC §10).
MAX_RATE_PERCENT = UPPER * 100
MAX_FLOW_AMOUNT = Fraction(10**15)

# Display precision per method (SPEC §9.3, §9.4). `nominal` is handled separately.
DISPLAY_PRECISION = {
    "effective": 2,
    "irrNominal": 2,
    "irrEffective": 2,
    "xirr": 2,
    "usRegZApr": 3,
    "ukAprc": 1,
    "euAprc": 1,
    "cnAnnualized": 2,
    "uaRealAnnual": 2,
    "international": 2,
}

ALL_METHODS = (
    "nominal",
    "effective",
    "irrNominal",
    "irrEffective",
    "xirr",
    "usRegZApr",
    "ukAprc",
    "euAprc",
    "cnAnnualized",
    "uaRealAnnual",
    "international",
)


class SolverError(Exception):
    """No root found in the allowed range (SPEC §10: IRR_NO_CONVERGENCE)."""


@dataclass(frozen=True)
class Flow:
    """One borrower cash flow: +inflow at disbursement, -outflow at each payment."""

    period: int  # payment index k (0 = disbursement); -1 when not given (cash flows)
    when: date
    amount: Fraction


@dataclass
class Solved:
    value: Decimal  # the root
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------------------
# Root finding (SPEC §10).


def sign_changes(keyed: Sequence[tuple[Fraction, Fraction]]) -> int:
    """Sign changes of the amounts ordered by time; flows at the same time are summed
    first and zero sums are skipped, so the order of same-time flows does not matter."""
    totals: dict[Fraction, Fraction] = {}
    for key, amount in keyed:
        totals[key] = totals.get(key, Fraction(0)) + amount
    signs = [1 if a > 0 else -1 for _, a in sorted(totals.items()) if a != 0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def _find_root(
    f: Callable[[Decimal], Decimal],
    fprime: Callable[[Decimal], Decimal],
    lo: Decimal,
    hi: Decimal,
) -> Decimal:
    """Safeguarded Newton iteration inside a sign-changing bracket [lo, hi]."""
    flo = f(lo)
    fhi = f(hi)
    if flo == 0:
        return lo
    if fhi == 0:
        return hi
    if (flo < 0) == (fhi < 0):
        raise SolverError("bracket has no sign change")
    x = (lo + hi) / 2
    for _ in range(2000):
        fx = f(x)
        if fx == 0:
            return x
        if (fx < 0) == (flo < 0):
            lo, flo = x, fx
        else:
            hi, fhi = x, fx
        slope = fprime(x)
        candidate = x - fx / slope if slope != 0 else None
        if candidate is None or candidate <= lo or candidate >= hi:
            candidate = (lo + hi) / 2
        if abs(candidate - x) < SOLVER_TOLERANCE or hi - lo < SOLVER_TOLERANCE:
            return candidate
        x = candidate
    raise SolverError("no convergence")


def root_grid() -> list[Decimal]:
    """SPEC §10 enumeration grid: x = -0.99 + k/2000 while x < 1, then 1.05^k while
    below 1e7, then 1e7."""
    points = []
    k = 0
    while LOWER + GRID_STEP * k < UNIFORM_TO:
        points.append(LOWER + GRID_STEP * k)
        k += 1
    x = UNIFORM_TO
    while x < UPPER:
        points.append(x)
        x *= GRID_GROWTH
    points.append(UPPER)
    return points


def choose_root(roots: Sequence[Decimal]) -> Decimal:
    """The smallest non-negative root, else the negative root closest to zero (SPEC §10;
    MCOB 10.3.1B R(2): "the positive rate nearest to zero")."""
    non_negative = [r for r in roots if r >= 0]
    if non_negative:
        return min(non_negative)
    return max(roots)


def _solve(
    f: Callable[[Decimal], Decimal],
    fprime: Callable[[Decimal], Decimal],
    changes: int,
) -> Solved:
    """Finds the root per SPEC §10.

    No sign change: no root. One sign change: the root is unique; bracket [-0.99, 1],
    the upper end doubled up to 1e7. Several: every sign change on the enumeration grid
    is refined, ``choose_root`` picks one, and IRR_MULTIPLE is reported when more than one
    root was found.
    """
    if changes == 0:
        raise SolverError("the cash flows do not change sign")
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        if changes == 1:
            hi = UNIFORM_TO
            while True:
                try:
                    return Solved(_find_root(f, fprime, LOWER, hi))
                except SolverError:
                    if hi >= UPPER:
                        raise
                    hi = min(hi * 2, UPPER)
        points = root_grid()
        with localcontext() as scan:
            scan.prec = SCAN_PRECISION
            values = [f(p) for p in points]
        roots: list[Decimal] = []
        for index, (point, value) in enumerate(zip(points, values)):
            if value == 0:
                roots.append(point)
            elif index + 1 < len(points):
                following = values[index + 1]
                if following != 0 and (value < 0) != (following < 0):
                    roots.append(_find_root(f, fprime, point, points[index + 1]))
        if not roots:
            raise SolverError("no root")
        return Solved(choose_root(roots), ["IRR_MULTIPLE"] if len(roots) > 1 else [])


def solve_periodic(flows: Sequence[Flow]) -> Solved:
    """Periodic IRR r: sum(CF_k (1 + r)^-k) = 0 over the period indices k."""
    amounts = [to_decimal(fl.amount, SOLVER_PRECISION) for fl in flows]
    periods = [fl.period for fl in flows]

    def f(r: Decimal) -> Decimal:
        v = 1 / (1 + r)
        return sum((a * v**k for a, k in zip(amounts, periods)), Decimal(0))

    def fprime(r: Decimal) -> Decimal:
        v = 1 / (1 + r)
        return sum((-k * a * v ** (k + 1) for a, k in zip(amounts, periods)), Decimal(0))

    changes = sign_changes([(Fraction(fl.period), fl.amount) for fl in flows])
    return _solve(f, fprime, changes)


def solve_annual(times: Sequence[Fraction], flows: Sequence[Flow]) -> Solved:
    """Annual rate X: sum(CF (1 + X)^-t) = 0 with t in years.

    Times are exact fractions; with L the least common denominator,
    (1 + X)^-t = w^(t L) where w = (1 + X)^(-1/L), so each evaluation needs one ln/exp
    and integer powers only.
    """
    amounts = [to_decimal(fl.amount, SOLVER_PRECISION) for fl in flows]
    lcd = 1
    for t in times:
        lcd = lcd * t.denominator // gcd(lcd, t.denominator)
    steps = [int(t * lcd) for t in times]

    def f(x: Decimal) -> Decimal:
        w = (-(1 + x).ln() / lcd).exp()
        return sum((a * w**s for a, s in zip(amounts, steps)), Decimal(0))

    def fprime(x: Decimal) -> Decimal:
        w = (-(1 + x).ln() / lcd).exp()
        return sum(
            (-Decimal(s) / lcd * a * w**s / (1 + x) for a, s in zip(amounts, steps)), Decimal(0)
        )

    changes = sign_changes(list(zip(times, (fl.amount for fl in flows))))
    return _solve(f, fprime, changes)


# ---------------------------------------------------------------------------------------
# Time measurement.


def _back(later: date, months: int, day: int | None) -> date | None:
    """``later`` moved back ``months`` calendar months onto ``day`` (clamped to the month
    length; None = the last day of the month). None before year 1."""
    try:
        shifted = add_months(date(later.year, later.month, 1), -months, False)
    except OverflowError:
        return None
    length = days_in_month(shifted.year, shifted.month)
    return date(shifted.year, shifted.month, length if day is None else min(day, length))


def _full_months_back(start: date, later: date, day: int | None) -> int:
    """Number of full months measured back from ``later`` without passing ``start``."""
    months = 0
    while True:
        earlier = _back(later, months + 1, day)
        if earlier is None or earlier < start:
            return months
        months += 1


def regular_unit_periods(start: date, when: date, freq: Frequency, eom: bool) -> Fraction:
    """Whole periods of a loan's regular schedule from ``start`` to ``when``.

    Months are measured back from the later date on the schedule's due day; payments due
    on month ends are measured month end to month end, and for payments due on the 29th
    or 30th the last day of February is used (Reg Z App. J (b)(3)(iv)). The same counting
    gives the APRC's whole months (SPEC §9.3 b). Asserts that the date is a whole number
    of periods away, which §2.3 guarantees.
    """
    if freq.month_based:
        day = None if eom else start.day
        months = _full_months_back(start, when, day)
        if _back(when, months, day) != start or months % freq.months != 0:
            raise AssertionError("regular schedule expected: whole periods only")
        return Fraction(months, freq.months)
    days = days_between(start, when)
    if days % freq.days != 0:
        raise AssertionError("regular schedule expected: whole periods only")
    return Fraction(days, freq.days)


def years_of_period(freq: Frequency) -> Fraction:
    """Length of one payment period in years for the APRC: months / 12 or weeks / 52."""
    return Fraction(freq.months, 12) if freq.month_based else Fraction(freq.days // 7, 52)


def _complete_year_days(end: date) -> int:
    """Days of the complete year counted back from ``end`` to the same day of the previous
    year (365 or 366): Directive (EU) 2023/2225 Annex III (c), MCOB 10A.2.3 R."""
    previous = date(end.year - 1, end.month, min(end.day, days_in_month(end.year - 1, end.month)))
    return days_between(previous, end)


def years_counted_back(start: date, later: date, freq: Frequency) -> Fraction:
    """Time in years from ``start`` to ``later`` for the APRC of irregular dates (SPEC §9.3 b):
    equal periods (months for month-based frequencies, weeks otherwise) are counted back
    from ``later`` towards ``start``; the remaining days are divided by the number of days
    (365 or 366) of the complete year counted back from the last of those days."""
    if freq.month_based:
        months = _full_months_back(start, later, later.day)
        point = _back(later, months, later.day)
        assert point is not None
        whole = Fraction(months, 12)
    else:
        weeks = days_between(start, later) // 7
        point = date.fromordinal(later.toordinal() - 7 * weeks)
        whole = Fraction(weeks, 52)
    remainder = days_between(start, point)
    if remainder == 0:
        return whole
    return whole + Fraction(remainder, _complete_year_days(point))


def regz_single_payment_apr(
    start: date, when: date, inflow: Fraction, payment: Fraction
) -> Decimal:
    """APR of a single advance, single payment transaction (Reg Z App. J (b)(4)(ii),
    (b)(5)(v)-(vii)): the unit-period is the term, at most one year.

    Term under a year: one unit-period; unit-periods per year = 12 / months when the term
    is a whole number of months, else 365 / days. Longer terms: the unit-period is a year;
    full years are counted back from the payment date and the remainder is months / 12
    (whole months) or days / 365; then A_f (1 + f·i)(1 + i)^t = P.
    """
    if inflow == 0 or payment == 0 or (inflow > 0) == (payment > 0):
        raise SolverError("not a single advance and a single payment")
    ratio = -payment / inflow  # P / A_f > 0
    months = _full_months_back(start, when, when.day)
    whole_months = months > 0 and _back(when, months, when.day) == start
    if months < 12:
        # The rate of the one unit-period is held to the solver range (SPEC §9.3 a, §10).
        i = ratio - 1
        if not Fraction(LOWER) <= i <= Fraction(UPPER):
            raise SolverError("the unit-period rate is outside the solver range")
        per_year = (
            Fraction(12, months) if whole_months else Fraction(365, days_between(start, when))
        )
        with localcontext() as ctx:
            ctx.prec = SOLVER_PRECISION
            return to_decimal(i * per_year, SOLVER_PRECISION)
    years = months // 12
    point = _back(when, 12 * years, when.day)
    assert point is not None
    rest_months = months - 12 * years
    if _back(point, rest_months, when.day) == start:
        fraction = Fraction(rest_months, 12)
    else:
        fraction = Fraction(days_between(start, point), 365)
    target = to_decimal(ratio, SOLVER_PRECISION)
    f_dec = to_decimal(fraction, SOLVER_PRECISION)

    def g(i: Decimal) -> Decimal:
        return (1 + f_dec * i) * (1 + i) ** years - target

    def gprime(i: Decimal) -> Decimal:
        return f_dec * (1 + i) ** years + (1 + f_dec * i) * years * (1 + i) ** (years - 1)

    return _solve(g, gprime, 1).value


# ---------------------------------------------------------------------------------------
# Formatting of rate results.


def percent_string(value: Decimal) -> str:
    """Percent value as a plain decimal string with 12 decimals ("0.000000000000", never
    "-0.000000000000" or an exponent)."""
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        quantized = value.quantize(Decimal("1e-12"))
        if quantized == 0:
            quantized = quantized.copy_abs()
        return f"{quantized:f}"


def tolerance(value: Decimal) -> Decimal:
    """SPEC §14: an engine value matches when within max(1e-7 pp, 1e-9 × |value|)."""
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        return max(TOLERANCE_PP, TOLERANCE_RELATIVE * abs(value))


def display_string(value: Decimal, precision: int) -> str:
    """Display value: half-up (away from zero) at ``precision`` decimals; certified to lie
    at least ten tolerances away from a rounding boundary."""
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        step = Decimal(1).scaleb(-precision)
        scaled = abs(value) / step
        frac = scaled - scaled.to_integral_value(rounding="ROUND_FLOOR")
        distance = abs(frac - Decimal("0.5")) * step
        guard = GUARD_FACTOR * tolerance(value)
        if distance < guard:
            raise NearTieError(f"rate {value} is within {guard} of a display boundary")
        rounded = value.quantize(step, rounding="ROUND_HALF_UP")
        text = f"{rounded:f}"
        return "0." + "0" * precision if rounded == 0 and precision > 0 else text.lstrip("+")


def metric(value: Decimal, precision: int, warnings: list[str] | None = None) -> dict[str, object]:
    result: dict[str, object] = {
        "value": percent_string(value),
        "display": display_string(value, precision),
        "precision": precision,
    }
    if warnings:
        result["warnings"] = sorted(set(warnings))
    return result


def failed(reason: str) -> dict[str, object]:
    return {"ok": False, "reason": reason}


def annualized(
    value: Decimal, precision: int, warnings: list[str] | None = None
) -> dict[str, object]:
    """A metric annualized from a solved rate; it fails like the solvers when its value
    lies outside ±1e9 % (SPEC §10)."""
    if abs(value) > MAX_RATE_PERCENT:
        return failed("IRR_NO_CONVERGENCE")
    return metric(value, precision, warnings)


def summed_by_date(flows: Sequence[Flow]) -> list[tuple[date, Fraction]]:
    """The flows summed per date in date order, zero sums dropped."""
    totals: dict[date, Fraction] = {}
    for fl in flows:
        totals[fl.when] = totals.get(fl.when, Fraction(0)) + fl.amount
    return [(when, amount) for when, amount in sorted(totals.items()) if amount != 0]


def _with_precision(func: Callable[[], Decimal]) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        return +func()


def _periodic_metrics(
    flows: Sequence[Flow], freq: Frequency, wanted: set[str], out: dict[str, dict[str, object]]
) -> None:
    """irrNominal, irrEffective, cnAnnualized and usRegZApr from whole periods (§9.2, §9.3)."""
    names = {"irrNominal", "irrEffective", "cnAnnualized", "usRegZApr"} & wanted
    if not names:
        return
    m = freq.per_year
    try:
        solved = solve_periodic(flows)
    except SolverError:
        solved = None
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        if solved is not None:
            r = solved.value
            for name, value in (
                ("irrNominal", r * m * 100),
                ("irrEffective", ((1 + r) ** m - 1) * 100),
                ("cnAnnualized", r * m * 100),
            ):
                if name in names:
                    out[name] = annualized(value, DISPLAY_PRECISION[name], solved.warnings)
        elif names - {"usRegZApr"}:
            for name in names - {"usRegZApr"}:
                out[name] = failed("IRR_NO_CONVERGENCE")
        if "usRegZApr" in names:
            summed = summed_by_date(flows)
            if len(summed) == 2:
                # Single advance, single payment: two dates with a non-zero sum (same-date
                # flows summed, zero payments are no payments); the unit-period is the term
                # (SPEC §9.3 a). A loan qualifies by its actual payments (early close).
                (start, inflow), (when, payment) = summed
                try:
                    apr = regz_single_payment_apr(start, when, inflow, payment)
                    out["usRegZApr"] = annualized(apr * 100, 3)
                except SolverError:
                    out["usRegZApr"] = failed("IRR_NO_CONVERGENCE")
            elif solved is not None:
                out["usRegZApr"] = annualized(solved.value * m * 100, 3, solved.warnings)
            else:
                out["usRegZApr"] = failed("IRR_NO_CONVERGENCE")


def _annual_metrics(
    names: set[str],
    times: Sequence[Fraction],
    flows: Sequence[Flow],
    precision: int,
    out: dict[str, dict[str, object]],
) -> None:
    if not names:
        return
    try:
        solved = solve_annual(times, flows)
    except SolverError:
        for name in names:
            out[name] = failed("IRR_NO_CONVERGENCE")
        return
    with localcontext() as ctx:
        ctx.prec = SOLVER_PRECISION
        for name in sorted(names):
            out[name] = metric(solved.value * 100, precision, solved.warnings)


def compute_rates(
    *,
    flows: Sequence[Flow],
    freq: Frequency,
    eom: bool,
    nominal_pct_text: str,
    nominal_rate: Fraction,
    effective_rate: Callable[[], Decimal],
    methods: Sequence[str],
) -> dict[str, dict[str, object]]:
    """All requested rate metrics for a loan's regular schedule (SPEC §9.2, §9.3 a–f)."""
    start = flows[0].when
    out: dict[str, dict[str, object]] = {}
    wanted = set(methods)

    if "nominal" in wanted:
        # The contract rate as entered, padded to at least 2 decimals: it is never rounded,
        # so it needs no display guard (SPEC §9.2), and zero has no sign (§9.6).
        places = decimal_places(nominal_pct_text)
        text = nominal_pct_text.lstrip("-") if nominal_rate == 0 else nominal_pct_text
        if places < 2:
            text = (text if places else text + ".") + "0" * (2 - places)
        out["nominal"] = {
            "value": percent_string(to_decimal(nominal_rate * 100, SOLVER_PRECISION)),
            "display": text,
            "precision": max(2, places),
        }
    if "effective" in wanted:
        out["effective"] = metric(_with_precision(effective_rate) * 100, 2)

    # Every payment of a regular schedule is a whole number of periods after D0.
    for fl in flows:
        if regular_unit_periods(start, fl.when, freq, eom) != fl.period:
            raise AssertionError("schedule dates and period indices disagree")
    _periodic_metrics(flows, freq, wanted, out)

    period_years = years_of_period(freq)
    _annual_metrics(
        {"ukAprc", "euAprc"} & wanted, [fl.period * period_years for fl in flows], flows, 1, out
    )
    _annual_metrics(
        {"xirr", "uaRealAnnual", "international"} & wanted,
        [Fraction(days_between(start, fl.when), 365) for fl in flows],
        flows,
        2,
        out,
    )
    return {name: out[name] for name in ALL_METHODS if name in out}


# ---------------------------------------------------------------------------------------
# Explicit cash flows (SPEC §15, vectors of kind "cashflows").


def _validate_flows(
    raw: object,
) -> tuple[list[Flow], Frequency | None, list[dict[str, object]]]:
    """SPEC §13/§15 rules for explicit cash flows: returns flows, frequency and errors."""
    errors: list[dict[str, object]] = []

    def error(code: str, path: str | None) -> None:
        errors.append({"code": code, "field": path})

    if not isinstance(raw, dict):
        error("INPUT_INVALID", None)
        return [], None, errors
    freq: Frequency | None = None
    if "frequency" in raw:
        value = raw["frequency"]
        freq = FREQUENCIES.get(value) if isinstance(value, str) else None
        if freq is None:
            error("INPUT_INVALID", "frequency")
    raw_flows = raw.get("flows")
    if not isinstance(raw_flows, list) or len(raw_flows) < 2:
        error("INPUT_INVALID", "flows")
        return [], freq, errors
    # Periods are given on every flow or on none, as flows[0] decides (a flow that is not
    # an object has none): a flow that disagrees is the error. The period values are
    # checked only when every object flow agrees, and a missing frequency is an error only
    # when every flow has a period (SPEC §13).
    objects = [item if isinstance(item, dict) else None for item in raw_flows]
    with_period = objects[0] is not None and "period" in objects[0]
    agree = all(item is None or ("period" in item) == with_period for item in objects)
    check_periods = with_period and agree
    if all(item is not None and "period" in item for item in objects) and "frequency" not in raw:
        error("INPUT_INVALID", "frequency")
    flows: list[Flow] = []
    previous_date: date | None = None
    previous_period: int | None = None
    for index, item in enumerate(raw_flows):
        path = f"flows[{index}]"
        if not isinstance(item, dict):
            error("INPUT_INVALID", path)
            previous_date = previous_period = None
            continue
        before = len(errors)
        when: date | None = None
        if not isinstance(item.get("date"), str):
            error("INPUT_INVALID", f"{path}.date")
        else:
            when = parse_iso(item["date"])
            if when is None:
                error("DATE_INVALID", f"{path}.date")
            elif previous_date is not None and when < previous_date:
                error("INPUT_INVALID", f"{path}.date")
        amount: Fraction | None = None
        if not is_decimal_string(item.get("amount")):
            error("INPUT_INVALID", f"{path}.amount")
        else:
            amount = parse_decimal(item["amount"])
            if abs(amount) > MAX_FLOW_AMOUNT:
                error("AMOUNT_RANGE", f"{path}.amount")
        period = -1
        if ("period" in item) != with_period:
            error("INPUT_INVALID", f"{path}.period")
            previous_period = None
        elif check_periods:
            value = as_int(item.get("period"))
            if (
                value is None
                or value < 0
                or (index == 0 and value != 0)
                or (previous_period is not None and value < previous_period)
            ):
                error("INPUT_INVALID", f"{path}.period")
                value = None
            previous_period = value
            period = -1 if value is None else value
        previous_date = when
        if len(errors) == before:
            assert when is not None and amount is not None
            flows.append(Flow(period, when, amount))
    if errors:
        return flows, freq, errors
    # Phase 2: the last flow must be later than the first; periods must match the dates.
    last = len(flows) - 1
    if flows[last].when == flows[0].when:
        error("INPUT_INVALID", f"flows[{last}].date")
    if with_period and freq is not None:
        start = flows[0].when
        for index, fl in enumerate(flows):
            expected = {schedule_date(start, freq, fl.period, eom) for eom in (True, False)}
            if fl.when not in expected:
                error("INPUT_INVALID", f"flows[{index}].period")
    return flows, freq, errors


def compute_cashflow_rates(raw: object) -> dict[str, object]:
    """Rate metrics of an explicit cash-flow list (SPEC §9.7, §15).

    ``raw`` = {"frequency"?: id, "flows": [{"date", "amount", "period"?}, ...]} with dates
    in non-decreasing order; times are measured from the first flow.

    - always: xirr, uaRealAnnual, international (days / 365);
    - with a frequency and a period on every flow (dates = first date + period periods):
      irrNominal, irrEffective, cnAnnualized, usRegZApr from the periods, and the APRC
      from whole periods, exactly as for a loan;
    - with a frequency and no periods: the APRC with equal periods and days counted back
      from each date (§9.3 b).
    """
    flows, freq, errors = _validate_flows(raw)
    if errors:
        return {"ok": False, "errors": errors}
    start = flows[0].when
    out: dict[str, dict[str, object]] = {}
    if freq is not None:
        if all(fl.period >= 0 for fl in flows):
            _periodic_metrics(flows, freq, set(ALL_METHODS), out)
            period_years = years_of_period(freq)
            times = [fl.period * period_years for fl in flows]
        else:
            times = [years_counted_back(start, fl.when, freq) for fl in flows]
        _annual_metrics({"ukAprc", "euAprc"}, times, flows, 1, out)
    _annual_metrics(
        {"xirr", "uaRealAnnual", "international"},
        [Fraction(days_between(start, fl.when), 365) for fl in flows],
        flows,
        2,
        out,
    )
    return {"ok": True, "rates": {name: out[name] for name in ALL_METHODS if name in out}}
