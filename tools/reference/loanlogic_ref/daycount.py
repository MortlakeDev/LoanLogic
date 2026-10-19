# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Day-count year fractions as exact rationals (SPEC §4)."""

from __future__ import annotations

from datetime import date
from fractions import Fraction

from .dates import days_between, is_last_day_of_february

DAY_COUNT_METHODS = ("30u-360", "30-360-isda", "30e-360", "act-360", "act-365f", "act-act-isda")


def _thirty_360(y1: int, m1: int, d1: int, y2: int, m2: int, d2: int) -> Fraction:
    return Fraction(360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1), 360)


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def year_fraction(method: str, start: date, end: date, *, eom_schedule: bool = False) -> Fraction:
    """Year fraction from ``start`` to ``end`` under ``method``.

    ``eom_schedule`` tells 30U/360 that the schedule is end-of-month anchored (rules 1–2
    of SPEC §4 apply only then).
    """
    if end < start:
        raise ValueError("start must not be after end")
    if start == end:
        return Fraction(0)
    y1, m1, d1 = start.year, start.month, start.day
    y2, m2, d2 = end.year, end.month, end.day
    if method == "30u-360":
        if eom_schedule and is_last_day_of_february(start) and is_last_day_of_february(end):
            d2 = 30
        if eom_schedule and is_last_day_of_february(start):
            d1 = 30
        if d2 == 31 and d1 >= 30:
            d2 = 30
        if d1 == 31:
            d1 = 30
        return _thirty_360(y1, m1, d1, y2, m2, d2)
    if method == "30-360-isda":
        if d1 == 31:
            d1 = 30
        if d2 == 31 and d1 == 30:
            d2 = 30
        return _thirty_360(y1, m1, d1, y2, m2, d2)
    if method == "30e-360":
        if d1 == 31:
            d1 = 30
        if d2 == 31:
            d2 = 30
        return _thirty_360(y1, m1, d1, y2, m2, d2)
    if method == "act-360":
        return Fraction(days_between(start, end), 360)
    if method == "act-365f":
        return Fraction(days_between(start, end), 365)
    if method == "act-act-isda":
        total = Fraction(0)
        cursor = start
        while cursor < end:
            # The next year's start is built only when the interval crosses into it, so
            # dates in year 9999 never need 10000-01-01.
            segment_end = end if cursor.year == end.year else date(cursor.year + 1, 1, 1)
            days = days_between(cursor, segment_end)
            total += Fraction(days, 366 if _is_leap(cursor.year) else 365)
            cursor = segment_end
        return total
    raise ValueError(f"unknown day-count method {method!r}")
