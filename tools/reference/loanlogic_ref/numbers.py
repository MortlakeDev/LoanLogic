# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Exact numbers for the reference implementation.

Ledger values are exact rationals (``fractions.Fraction``). Irrational quantities (a
periodic rate from a fractional compounding power, continuous compounding) are evaluated
with ``decimal.Decimal`` at ``HIGH_PRECISION`` significant digits and then converted to an
exact ``Fraction`` of that approximation. Every rounding goes through ``round_to``.
"""

from __future__ import annotations

import re
from decimal import Decimal, localcontext
from fractions import Fraction

# Significant digits for irrational intermediate values. The approximation error (about
# 1e-115 relative) is far below the tie guard used for golden vectors (1e-15 minor units).
HIGH_PRECISION = 120

ROUNDING_MODES = ("half-up", "half-even", "ceil", "floor")

_DECIMAL_STRING = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$")


class NearTieError(Exception):
    """An approximated value lies too close to a rounding boundary to be certified."""


def is_decimal_string(text: object) -> bool:
    """True for a plain decimal string such as "-12.50" (no exponent, no grouping)."""
    return isinstance(text, str) and _DECIMAL_STRING.match(text) is not None


def parse_decimal(text: str) -> Fraction:
    """Parses a plain decimal string exactly."""
    if not is_decimal_string(text):
        raise ValueError(f"not a decimal string: {text!r}")
    return Fraction(Decimal(text))


def decimal_places(text: str) -> int:
    """Number of digits after the decimal point in a decimal string."""
    return len(text.split(".", 1)[1]) if "." in text else 0


def quantum(digits: int) -> Fraction:
    """10^-digits as an exact fraction."""
    return Fraction(1, 10**digits)


def round_to(value: Fraction, step: Fraction, mode: str) -> Fraction:
    """Rounds ``value`` to an integer multiple of ``step`` with one of ROUNDING_MODES.

    half-up rounds ties away from zero (decimal.js ROUND_HALF_UP), half-even rounds ties
    to the even multiple, ceil rounds towards +infinity and floor towards -infinity.
    """
    if step <= 0:
        raise ValueError("step must be positive")
    scaled = value / step
    lower = scaled.numerator // scaled.denominator  # floor
    remainder = scaled - lower  # 0 <= remainder < 1
    if mode == "floor":
        result = lower
    elif mode == "ceil":
        result = lower if remainder == 0 else lower + 1
    elif mode == "half-up":
        if remainder > Fraction(1, 2):
            result = lower + 1
        elif remainder < Fraction(1, 2):
            result = lower
        else:
            result = lower + 1 if value > 0 else lower
    elif mode == "half-even":
        if remainder > Fraction(1, 2):
            result = lower + 1
        elif remainder < Fraction(1, 2):
            result = lower
        else:
            result = lower if lower % 2 == 0 else lower + 1
    else:
        raise ValueError(f"unknown rounding mode {mode!r}")
    return result * step


def boundary_distance(value: Fraction, step: Fraction, mode: str) -> Fraction:
    """Distance, in units of ``step``, from ``value`` to the nearest rounding boundary.

    For half-up and half-even the boundaries are the half-way points; for ceil and floor
    they are the multiples of ``step`` themselves.
    """
    scaled = value / step
    if mode in ("half-up", "half-even"):
        shifted = scaled - Fraction(1, 2)
    else:
        shifted = scaled
    lower = shifted.numerator // shifted.denominator
    frac = shifted - lower
    return min(frac, 1 - frac)


def round_certified(
    value: Fraction, step: Fraction, mode: str, *, exact: bool, guard: Fraction
) -> Fraction:
    """Rounds ``value`` and, for approximated (not exact) values, certifies the result.

    An approximated value closer than ``guard`` (in units of ``step``) to a rounding
    boundary raises NearTieError: an engine computing with fewer digits could round it
    the other way, so such inputs are not used for golden vectors.
    """
    if not exact and boundary_distance(value, step, mode) < guard:
        raise NearTieError(f"{float(value)!r} is within {float(guard)} steps of a boundary")
    return round_to(value, step, mode)


def to_decimal(value: Fraction, precision: int = HIGH_PRECISION) -> Decimal:
    """Converts an exact fraction to a Decimal with ``precision`` significant digits."""
    with localcontext() as ctx:
        ctx.prec = precision
        return Decimal(value.numerator) / Decimal(value.denominator)


def format_fixed(value: Fraction, digits: int) -> str:
    """Formats an exact multiple of 10^-digits as a plain decimal string ("-0.50")."""
    scaled = value * 10**digits
    if scaled.denominator != 1:
        raise ValueError(f"{value} is not a multiple of 10^-{digits}")
    units = scaled.numerator
    sign = "-" if units < 0 else ""
    units = abs(units)
    if digits == 0:
        return f"{sign}{units}"
    text = str(units).rjust(digits + 1, "0")
    return f"{sign}{text[:-digits]}.{text[-digits:]}"


def format_rounded(value: Fraction, digits: int, mode: str = "half-up") -> str:
    """Rounds ``value`` to ``digits`` decimals and formats it."""
    return format_fixed(round_to(value, quantum(digits), mode), digits)
