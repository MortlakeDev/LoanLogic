# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Calendar dates without time or zone (SPEC §2).

Built on ``datetime.date`` (proleptic Gregorian, no time zone), which is independent of
the engine's integer days-from-civil implementation.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

_ISO_DATE = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")

# Every date the engine handles lies in 0001-01-01 .. 9999-12-31 (SPEC §2.1, §13).
MAX_DATE = date(9999, 12, 31)


def as_int(value: object) -> int | None:
    """A JSON integer: an int, or a float with an integral value (JavaScript cannot tell
    12.0 from 12). Booleans and other values give None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def parse_iso(text: object) -> date | None:
    """Parses a strict ``YYYY-MM-DD`` string; None if malformed or not a real date."""
    if not isinstance(text, str):
        return None
    match = _ISO_DATE.match(text)
    if match is None:
        return None
    year, month, day = (int(part) for part in match.groups())
    if year < 1:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def iso(day: date) -> str:
    """Formats a date as ``YYYY-MM-DD``."""
    return f"{day.year:04d}-{day.month:02d}-{day.day:02d}"


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def is_last_day_of_month(day: date) -> bool:
    return day.day == days_in_month(day.year, day.month)


def is_last_day_of_february(day: date) -> bool:
    return day.month == 2 and is_last_day_of_month(day)


def days_between(start: date, end: date) -> int:
    """Actual number of days from ``start`` to ``end`` (negative if end is earlier)."""
    return end.toordinal() - start.toordinal()


def add_months(anchor: date, months: int, end_of_month: bool) -> date:
    """``anchor`` + ``months`` calendar months (SPEC §2.1).

    The day of month is clamped to the length of the target month. With ``end_of_month``
    and an anchor on the last day of its month, the result is the last day of the target
    month. Raises OverflowError outside years 1..9999.
    """
    index = anchor.year * 12 + (anchor.month - 1) + months
    year, month0 = divmod(index, 12)
    month = month0 + 1
    if not 1 <= year <= 9999:
        raise OverflowError("date out of range")
    length = days_in_month(year, month)
    if end_of_month and is_last_day_of_month(anchor):
        return date(year, month, length)
    return date(year, month, min(anchor.day, length))


@dataclass(frozen=True)
class Frequency:
    """A payment frequency (SPEC §2.2)."""

    id: str
    per_year: int  # m
    months: int  # period length in months (0 for week-based frequencies)
    days: int  # period length in days (0 for month-based frequencies)

    @property
    def month_based(self) -> bool:
        return self.months > 0


FREQUENCIES: dict[str, Frequency] = {
    "weekly": Frequency("weekly", 52, 0, 7),
    "biweekly": Frequency("biweekly", 26, 0, 14),
    "monthly": Frequency("monthly", 12, 1, 0),
    "quarterly": Frequency("quarterly", 4, 3, 0),
    "semiannual": Frequency("semiannual", 2, 6, 0),
    "annual": Frequency("annual", 1, 12, 0),
}


def schedule_date(anchor: date, frequency: Frequency, k: int, end_of_month: bool) -> date | None:
    """Date of payment ``k`` (k >= 0; k = 0 is the anchor itself), always from the anchor;
    None if it would fall after 9999-12-31."""
    try:
        if frequency.month_based:
            return add_months(anchor, k * frequency.months, end_of_month)
        return anchor + timedelta(days=k * frequency.days)
    except OverflowError:
        return None
