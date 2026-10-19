# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""Self-tests of the reference implementation.

    python -m unittest discover -s tools/reference -p "test_*.py"

The reference is checked against published examples (SPEC §5.6, the PBOC examples, the
ISDA ACT/ACT example, the Excel XIRR example, Reg Z single-payment rules, the CCD2/MCOB
time counting), the validation rules of SPEC §13, closed-form float formulas and the ledger
invariants on randomly generated loans.
"""

from __future__ import annotations

import calendar
import random
import sys
import unittest
from datetime import date
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from loanlogic_ref import calculate_loan  # noqa: E402
from loanlogic_ref.dates import FREQUENCIES, add_months  # noqa: E402
from loanlogic_ref.daycount import year_fraction  # noqa: E402
from loanlogic_ref.numbers import NearTieError, format_fixed, round_to  # noqa: E402
from loanlogic_ref.rates import (  # noqa: E402
    compute_cashflow_rates,
    display_string,
    percent_string,
    regz_single_payment_apr,
    years_counted_back,
)

CENT = Fraction(1, 100)


def usd_loan(**overrides):
    base = {
        "currency": "USD",
        "amount": "100000.00",
        "annualRatePct": "6.5",
        "repayment": "annuity",
        "frequency": "monthly",
        "term": {"payments": 24},
        "disbursementDate": "2026-01-15",
    }
    base.update(overrides)
    return base


class RoundingTest(unittest.TestCase):
    def test_modes_at_ties_and_signs(self) -> None:
        cases = [
            ("0.125", "half-up", "0.13"),
            ("0.125", "half-even", "0.12"),
            ("0.135", "half-even", "0.14"),
            ("-0.125", "half-up", "-0.13"),
            ("-0.125", "half-even", "-0.12"),
            ("0.121", "ceil", "0.13"),
            ("-0.121", "ceil", "-0.12"),
            ("0.129", "floor", "0.12"),
            ("-0.121", "floor", "-0.13"),
            ("0.12", "ceil", "0.12"),
        ]
        for value, mode, expected in cases:
            with self.subTest(value=value, mode=mode):
                result = round_to(Fraction(value), CENT, mode)
                self.assertEqual(format_fixed(result, 2), expected)

    def test_no_negative_zero(self) -> None:
        self.assertEqual(format_fixed(round_to(Fraction("-0.001"), CENT, "half-up"), 2), "0.00")


class DateTest(unittest.TestCase):
    def test_end_of_month_rule(self) -> None:
        anchor = date(2024, 1, 31)
        self.assertEqual(add_months(anchor, 1, True), date(2024, 2, 29))
        self.assertEqual(add_months(anchor, 2, True), date(2024, 3, 31))
        self.assertEqual(add_months(anchor, 3, True), date(2024, 4, 30))
        feb = date(2026, 2, 28)
        self.assertEqual(add_months(feb, 1, True), date(2026, 3, 31))
        self.assertEqual(add_months(feb, 1, False), date(2026, 3, 28))
        self.assertEqual(add_months(date(2026, 1, 30), 1, True), date(2026, 2, 28))
        self.assertEqual(add_months(date(2026, 1, 30), 2, True), date(2026, 3, 30))


class DayCountTest(unittest.TestCase):
    def test_isda_actual_actual_example(self) -> None:
        # ISDA's classic example: 1 Nov 2003 to 1 May 2004 = 61/365 + 121/366.
        yf = year_fraction("act-act-isda", date(2003, 11, 1), date(2004, 5, 1))
        self.assertEqual(yf, Fraction(61, 365) + Fraction(121, 366))
        self.assertAlmostEqual(float(yf), 0.497724380567, places=12)
        self.assertEqual(
            year_fraction("act-365f", date(2003, 11, 1), date(2004, 5, 1)), Fraction(182, 365)
        )
        self.assertEqual(
            year_fraction("act-360", date(2003, 11, 1), date(2004, 5, 1)), Fraction(182, 360)
        )

    def test_thirty_360_variants_at_month_ends(self) -> None:
        start, end = date(2007, 2, 28), date(2007, 3, 31)
        self.assertEqual(year_fraction("30u-360", start, end, eom_schedule=True), Fraction(30, 360))
        self.assertEqual(year_fraction("30u-360", start, end), Fraction(33, 360))
        self.assertEqual(year_fraction("30-360-isda", start, end), Fraction(33, 360))
        self.assertEqual(year_fraction("30e-360", start, end), Fraction(32, 360))
        both_feb = (date(2007, 2, 28), date(2008, 2, 29))
        self.assertEqual(year_fraction("30u-360", *both_feb, eom_schedule=True), Fraction(360, 360))
        self.assertEqual(year_fraction("30e-360", *both_feb), Fraction(361, 360))
        thirty_one = (date(2007, 1, 31), date(2007, 3, 31))
        for method in ("30u-360", "30-360-isda", "30e-360"):
            self.assertEqual(year_fraction(method, *thirty_one), Fraction(60, 360))
        self.assertEqual(
            year_fraction("30-360-isda", date(2007, 1, 15), date(2007, 3, 31)), Fraction(76, 360)
        )
        self.assertEqual(
            year_fraction("30e-360", date(2007, 1, 15), date(2007, 3, 31)), Fraction(75, 360)
        )


class WorkedExamplesTest(unittest.TestCase):
    def test_e1(self) -> None:
        result = calculate_loan(usd_loan())
        summary, rows = result["summary"], result["rows"]
        self.assertEqual(summary["regularInstalment"], "4454.63")
        self.assertEqual(rows[0]["interestAccrued"], "541.67")
        self.assertEqual(rows[0]["principal"], "3912.96")
        self.assertEqual(summary["lastPayment"], "4454.51")
        self.assertEqual(summary["totalPaid"], "106911.00")
        self.assertEqual(summary["totalInterest"], "6911.00")
        self.assertEqual(summary["totalPrincipal"], "100000.00")

    def test_e2(self) -> None:
        result = calculate_loan(
            usd_loan(annualRatePct="10", repayment="equal-principal", term={"payments": 7})
        )
        self.assertEqual(result["summary"]["principalPerPeriod"], "14285.71")
        self.assertEqual(result["rows"][-1]["principal"], "14285.74")
        self.assertEqual(result["summary"]["totalInterest"], "3333.34")

    def test_e3_and_e3b(self) -> None:
        fee = {
            "id": "f",
            "kind": "upfront",
            "calc": "percent",
            "value": "2",
            "financing": "paid",
            "inApr": True,
        }
        with_fee = calculate_loan(usd_loan(annualRatePct="12", term={"payments": 12}, fees=[fee]))
        self.assertEqual(with_fee["summary"]["regularInstalment"], "8884.88")
        self.assertEqual(with_fee["summary"]["lastPayment"], "8884.85")
        self.assertEqual(with_fee["rates"]["usRegZApr"]["display"], "15.854")
        self.assertEqual(with_fee["rates"]["ukAprc"]["display"], "17.1")
        no_fee = calculate_loan(usd_loan(annualRatePct="12", term={"payments": 12}))
        self.assertEqual(no_fee["rates"]["usRegZApr"]["display"], "12.000")
        self.assertEqual(no_fee["rates"]["irrEffective"]["display"], "12.68")

    def test_e4_pboc(self) -> None:
        flows = [{"period": 0, "date": "2026-01-15", "amount": "92"}] + [
            {"period": k, "date": f"{2026 + (k // 12)}-{(k % 12) + 1:02d}-15", "amount": "-9"}
            for k in range(1, 13)
        ]
        rates = compute_cashflow_rates({"frequency": "monthly", "flows": flows})["rates"]
        self.assertEqual(rates["cnAnnualized"]["display"], "30.69")
        self.assertEqual(rates["irrEffective"]["display"], "35.39")

    def test_excel_xirr_example(self) -> None:
        flows = [
            {"date": "2008-01-01", "amount": "-10000"},
            {"date": "2008-03-01", "amount": "2750"},
            {"date": "2008-10-30", "amount": "4250"},
            {"date": "2009-02-15", "amount": "3250"},
            {"date": "2009-04-01", "amount": "2750"},
        ]
        rates = compute_cashflow_rates({"flows": flows})["rates"]
        # Microsoft shows 0.373362535; Excel iterates to about 1e-8, the reference is exact.
        self.assertAlmostEqual(float(rates["xirr"]["value"]) / 100, 0.373362535, places=8)

    def test_design_concept_figures(self) -> None:
        fee = {
            "id": "o",
            "kind": "upfront",
            "calc": "percent",
            "value": "1",
            "financing": "paid",
            "inApr": True,
        }
        result = calculate_loan(
            usd_loan(
                amount="350000.00",
                annualRatePct="6.875",
                term={"years": 30, "months": 0},
                disbursementDate="2026-11-01",
                fees=[fee],
            )
        )
        summary = result["summary"]
        self.assertEqual(summary["regularInstalment"], "2299.25")
        self.assertEqual(summary["lastPayment"], "2300.28")
        self.assertEqual(summary["totalInterest"], "477731.03")
        self.assertEqual(summary["totalPayments"], "827731.03")
        self.assertEqual(result["rates"]["usRegZApr"]["display"], "6.974")
        self.assertEqual(result["rates"]["effective"]["display"], "7.10")


class ExactTiesTest(unittest.TestCase):
    def test_interest_tie_is_exact(self) -> None:
        # 2 700.00 x 6.5 % / 12 = 14.625 exactly.
        even = calculate_loan(
            usd_loan(amount="2700.00", term={"payments": 6}, rounding={"interest": "half-even"})
        )
        up = calculate_loan(usd_loan(amount="2700.00", term={"payments": 6}))
        self.assertEqual(even["rows"][0]["interestAccrued"], "14.62")
        self.assertEqual(up["rows"][0]["interestAccrued"], "14.63")

    def test_single_payment_instalment_tie(self) -> None:
        result = calculate_loan(usd_loan(amount="1500.00", term={"payments": 1}))
        self.assertEqual(result["summary"]["regularInstalment"], "1508.13")


def annual_flows(*amounts: str) -> dict:
    return {
        "frequency": "annual",
        "flows": [
            {"period": k, "date": f"{2026 + k}-01-01", "amount": amount}
            for k, amount in enumerate(amounts)
        ],
    }


def codes(result: dict) -> set[tuple[str, str | None]]:
    return {(error["code"], error["field"]) for error in result["errors"]}


class SolverTest(unittest.TestCase):
    def test_close_roots_are_both_found(self) -> None:
        rates = compute_cashflow_rates(annual_flows("100", "-210.2", "110.46"))["rates"]
        self.assertEqual(rates["irrNominal"]["display"], "5.00")
        self.assertEqual(rates["irrNominal"]["warnings"], ["IRR_MULTIPLE"])

    def test_smallest_non_negative_root_is_chosen(self) -> None:
        rates = compute_cashflow_rates(annual_flows("100", "-230", "132"))["rates"]
        self.assertEqual(rates["irrNominal"]["display"], "10.00")

    def test_several_sign_changes_with_one_root(self) -> None:
        # 100 - 50v + 10v^2 - 70v^3 is strictly decreasing in v: one root despite three
        # sign changes, so no IRR_MULTIPLE.
        rates = compute_cashflow_rates(annual_flows("100", "-50", "10", "-70"))["rates"]
        self.assertNotIn("warnings", rates["irrNominal"])
        self.assertNotIn("warnings", rates["xirr"])

    def test_no_sign_change_fails(self) -> None:
        rates = compute_cashflow_rates(annual_flows("100", "10", "10"))["rates"]
        for metric in rates.values():
            self.assertEqual(metric, {"ok": False, "reason": "IRR_NO_CONVERGENCE"})

    def test_same_time_flows_are_summed_before_counting_sign_changes(self) -> None:
        flows = [
            {"period": 0, "date": "2026-01-15", "amount": "-50"},
            {"period": 0, "date": "2026-01-15", "amount": "1000"},
        ] + [
            {"period": k, "date": f"{2026 + (k // 12)}-{(k % 12) + 1:02d}-15", "amount": "-90"}
            for k in range(1, 13)
        ]
        rates = compute_cashflow_rates({"frequency": "monthly", "flows": flows})["rates"]
        self.assertNotIn("warnings", rates["irrNominal"])

    def test_rates_above_1000_percent_are_found(self) -> None:
        # Weekly 1 000 % nominal: the APRC is about 937 881 %, inside the 1e7 bound.
        result = calculate_loan(
            usd_loan(
                annualRatePct="1000",
                frequency="weekly",
                term={"payments": 52},
                rateMethods=["ukAprc"],
            )
        )
        contract = ((1 + 10 / 52) ** 52 - 1) * 100  # 937 880.88 %, before payment rounding
        self.assertAlmostEqual(float(result["rates"]["ukAprc"]["value"]), contract, delta=1)


class RegZSinglePaymentTest(unittest.TestCase):
    def test_payday_term_in_days(self) -> None:
        apr = regz_single_payment_apr(
            date(2026, 3, 2), date(2026, 3, 16), Fraction(300), Fraction(-345)
        )
        self.assertEqual(
            Fraction(apr).limit_denominator(10**6), Fraction(15, 100) * Fraction(365, 14)
        )

    def test_whole_months_and_month_end(self) -> None:
        one_month = regz_single_payment_apr(
            date(2026, 1, 15), date(2026, 2, 15), Fraction(1000), Fraction(-1010)
        )
        self.assertEqual(one_month, Decimal("0.12"))
        # 31 Jan -> 28 Feb is not a whole month for a single payment: 365 / 28.
        short = regz_single_payment_apr(
            date(2026, 1, 31), date(2026, 2, 28), Fraction(1000), Fraction(-1010)
        )
        self.assertAlmostEqual(float(short), 0.01 * 365 / 28, places=15)

    def test_term_over_one_year_uses_a_year_unit_period(self) -> None:
        apr = regz_single_payment_apr(
            date(2021, 4, 15), date(2023, 4, 15), Fraction(100000), Fraction(-110000)
        )
        self.assertAlmostEqual(float(apr), 1.1**0.5 - 1, places=14)
        # 18 months: (1 + 0.5 i)(1 + i) = 1.1.
        apr = regz_single_payment_apr(
            date(2026, 1, 15), date(2027, 7, 15), Fraction(1000), Fraction(-1100)
        )
        self.assertAlmostEqual(float(apr), -1.5 + (2.25 + 0.2) ** 0.5, places=14)

    def test_payday_vector_figures(self) -> None:
        fee = {
            "id": "c",
            "kind": "upfront",
            "calc": "fixed",
            "value": "45.00",
            "financing": "financed",
            "inApr": True,
        }
        result = calculate_loan(
            usd_loan(
                amount="300.00",
                annualRatePct="0",
                repayment="bullet",
                frequency="biweekly",
                term={"payments": 1},
                fees=[fee],
            )
        )
        self.assertEqual(result["rates"]["usRegZApr"]["display"], "391.071")
        self.assertEqual(result["rates"]["irrNominal"]["display"], "390.00")


class AprcTimeTest(unittest.TestCase):
    monthly = FREQUENCIES["monthly"]

    def test_months_are_counted_back_from_each_date(self) -> None:
        start = date(2026, 1, 10)
        self.assertEqual(
            years_counted_back(start, date(2026, 2, 1), self.monthly), Fraction(22, 365)
        )
        self.assertEqual(
            years_counted_back(start, date(2026, 3, 5), self.monthly),
            Fraction(1, 12) + Fraction(26, 365),
        )
        self.assertEqual(
            years_counted_back(start, date(2026, 3, 10), self.monthly), Fraction(2, 12)
        )

    def test_days_use_the_complete_year_counted_back(self) -> None:
        start = date(2028, 2, 20)
        # 5 days ending 2028-02-25: the year back to 2027-02-25 has 365 days.
        self.assertEqual(
            years_counted_back(start, date(2028, 4, 25), self.monthly),
            Fraction(2, 12) + Fraction(5, 365),
        )
        # 14 days ending 2028-03-05: the year back to 2027-03-05 contains 29 February.
        self.assertEqual(
            years_counted_back(start, date(2028, 4, 5), self.monthly),
            Fraction(1, 12) + Fraction(14, 366),
        )

    def test_months_back_clamp_the_day(self) -> None:
        # SPEC §2.1: k months back from D = addMonths(D, -k), from D for every k.
        start = date(2026, 1, 31)
        self.assertEqual(
            years_counted_back(start, date(2026, 2, 28), self.monthly), Fraction(28, 365)
        )
        self.assertEqual(
            years_counted_back(start, date(2026, 3, 31), self.monthly), Fraction(2, 12)
        )
        self.assertEqual(
            years_counted_back(start, date(2026, 4, 30), self.monthly),
            Fraction(2, 12) + Fraction(28, 365),
        )
        clamp = regz_single_payment_apr(
            date(2026, 2, 28), date(2026, 3, 31), Fraction(1000), Fraction(-1010)
        )
        self.assertEqual(clamp, Decimal("0.12"))
        days = regz_single_payment_apr(
            date(2026, 1, 31), date(2026, 2, 28), Fraction(1000), Fraction(-1010)
        )
        self.assertAlmostEqual(float(days), 0.01 * 365 / 28, places=15)

    def test_weeks(self) -> None:
        weekly = FREQUENCIES["weekly"]
        self.assertEqual(
            years_counted_back(date(2027, 12, 1), date(2028, 3, 10), weekly),
            Fraction(14, 52) + Fraction(2, 365),
        )


class ValidationTest(unittest.TestCase):
    def test_integral_floats_are_integers(self) -> None:
        self.assertTrue(calculate_loan(usd_loan(term={"payments": 12.0}))["ok"])
        for bad in (True, "12", 12.5):
            with self.subTest(bad=bad):
                result = calculate_loan(usd_loan(term={"payments": bad}))
                self.assertEqual(codes(result), {("INPUT_INVALID", "term.payments")})

    def test_type_errors_and_unknown_values(self) -> None:
        self.assertEqual(
            codes(calculate_loan(usd_loan(currency=None))), {("INPUT_INVALID", "currency")}
        )
        self.assertEqual(
            codes(calculate_loan(usd_loan(currency="XAU"))), {("CURRENCY_INVALID", "currency")}
        )
        self.assertEqual(
            codes(calculate_loan(usd_loan(disbursementDate=20260115))),
            {("INPUT_INVALID", "disbursementDate")},
        )

    def test_one_error_per_field(self) -> None:
        self.assertEqual(
            codes(calculate_loan(usd_loan(amount="-5.005"))), {("AMOUNT_RANGE", "amount")}
        )
        # Minor units are checked only against a valid currency.
        self.assertEqual(
            codes(calculate_loan(usd_loan(currency="ZZZ", amount="100.005"))),
            {("CURRENCY_INVALID", "currency")},
        )

    def test_combination_checks_wait_for_valid_fields(self) -> None:
        result = calculate_loan(usd_loan(currency="ZZZ", term={"years": 0, "months": 0}))
        self.assertEqual(codes(result), {("CURRENCY_INVALID", "currency")})

    def test_combination_checks_are_reported_together(self) -> None:
        result = calculate_loan(
            usd_loan(
                repayment="balloon",
                balloon={"kind": "percent", "value": "100"},
                term={"years": 0, "months": 0},
                accrual={"mode": "daycount", "method": "act-365f", "paymentBasis": "exact"},
            )
        )
        self.assertEqual(
            codes(result),
            {
                ("TERM_TOO_SHORT", "term"),
                ("UNSUPPORTED", "accrual.paymentBasis"),
                ("BALLOON_RANGE", "balloon.value"),
            },
        )

    def test_schedule_must_end_by_9999(self) -> None:
        result = calculate_loan(usd_loan(disbursementDate="9999-06-15", term={"payments": 12}))
        self.assertEqual(codes(result), {("DATE_INVALID", "disbursementDate")})
        result = calculate_loan(
            usd_loan(disbursementDate="9999-06-15", term={"endDate": "9999-12-31"})
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["summary"]["payoffDate"], "9999-12-15")

    def test_trailing_newlines_are_rejected(self) -> None:
        # Python's "$" matches before a final newline; JavaScript's does not.
        result = calculate_loan(usd_loan(disbursementDate="2026-01-15\n"))
        self.assertEqual(codes(result), {("DATE_INVALID", "disbursementDate")})
        result = calculate_loan(usd_loan(amount="100.00\n"))
        self.assertEqual(codes(result), {("INPUT_INVALID", "amount")})

    def test_act_act_isda_in_year_9999(self) -> None:
        result = calculate_loan(
            usd_loan(
                disbursementDate="9999-01-15",
                term={"payments": 11},
                accrual={"mode": "daycount", "method": "act-act-isda"},
            )
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["summary"]["payoffDate"], "9999-12-15")

    def test_cash_flow_periods_must_match_dates(self) -> None:
        flows = {
            "frequency": "monthly",
            "flows": [
                {"period": 0, "date": "2026-01-15", "amount": "100"},
                {"period": 1, "date": "2026-02-20", "amount": "-101"},
            ],
        }
        self.assertEqual(
            codes(compute_cashflow_rates(flows)), {("INPUT_INVALID", "flows[1].period")}
        )


class ZeroRateTest(unittest.TestCase):
    def test_zero_rate_is_exact_for_every_compounding(self) -> None:
        for compounding in ("semiannual", "continuous", "annual", "weekly"):
            with self.subTest(compounding=compounding):
                result = calculate_loan(
                    usd_loan(
                        annualRatePct="0",
                        term={"payments": 12},
                        accrual={"mode": "periodic", "compounding": compounding},
                        rounding={"interest": "ceil"},
                    )
                )
                self.assertEqual(result["summary"]["totalInterest"], "0.00")
                self.assertEqual(result["summary"]["regularInstalment"], "8333.33")


class SummaryRulesTest(unittest.TestCase):
    def test_balloon_after_early_close_is_zero(self) -> None:
        result = calculate_loan(
            usd_loan(
                amount="10.00",
                annualRatePct="1",
                repayment="balloon",
                balloon={"kind": "amount", "value": "1.00"},
                term={"payments": 12},
                rounding={"payment": "unit-ceil"},
            )
        )
        self.assertEqual(result["summary"]["paymentsCount"], 11)
        self.assertEqual(result["summary"]["balloon"], "0.00")

    def test_effective_rate_of_act_360(self) -> None:
        result = calculate_loan(
            usd_loan(
                annualRatePct="7.25",
                term={"payments": 60},
                accrual={"mode": "daycount", "method": "act-360"},
            )
        )
        expected = (1 + 0.0725 * 365 / 360 / 12) ** 12 - 1
        self.assertAlmostEqual(
            float(result["rates"]["effective"]["value"]) / 100, expected, places=13
        )

    def test_thirty_360_us_depends_on_the_dates(self) -> None:
        loan = usd_loan(
            disbursementDate="2026-01-31",
            term={"payments": 13},
            accrual={"mode": "daycount", "method": "30u-360"},
        )
        self.assertEqual(
            calculate_loan(dict(loan, endOfMonth=False)),
            calculate_loan(dict(loan, endOfMonth=True)),
        )


class FormattingTest(unittest.TestCase):
    def test_percent_strings(self) -> None:
        self.assertEqual(percent_string(Decimal("-1e-40")), "0.000000000000")
        self.assertEqual(percent_string(Decimal("6.5")), "6.500000000000")

    def test_display_guard_scales_with_the_value(self) -> None:
        self.assertEqual(display_string(Decimal("15.85449685391"), 3), "15.854")
        with self.assertRaises(NearTieError):
            display_string(Decimal("15.8545000005"), 3)
        # The guard is 10 x max(1e-7, 1e-9 x |value|): about 0.0039 pp at 391 071 %.
        with self.assertRaises(NearTieError):
            display_string(Decimal("391071.4530"), 1)
        self.assertEqual(display_string(Decimal("391071.4550"), 1), "391071.5")


def random_date(rng: random.Random) -> str:
    year, month = rng.randint(2020, 2030), rng.randint(1, 12)
    length = calendar.monthrange(year, month)[1]
    day = length if rng.random() < 0.3 else rng.randint(1, length)
    return f"{year}-{month:02d}-{day:02d}"


class RandomLoansTest(unittest.TestCase):
    """Invariants (asserted inside the engine) and float cross-checks on random loans."""

    def test_random_loans(self) -> None:
        rng = random.Random(20261019)
        currencies = [("USD", 2), ("JPY", 0), ("KWD", 3), ("EUR", 2)]
        checked = 0
        for _ in range(250):
            currency, digits = rng.choice(currencies)
            minor = rng.randint(100 * 10**digits, 5_000_000 * 10**digits)
            amount = format_fixed(Fraction(minor, 10**digits), digits)
            repayment = rng.choice(["annuity", "equal-principal", "bullet", "balloon"])
            frequency = rng.choice(
                ["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"]
            )
            rate = f"{rng.randint(-500, 4000) / 100:.2f}"
            payments = rng.randint(1, 120)
            accrual = rng.choice(
                [
                    {"mode": "periodic"},
                    {
                        "mode": "periodic",
                        "compounding": rng.choice(["monthly", "semiannual", "continuous"]),
                    },
                    {
                        "mode": "daycount",
                        "method": rng.choice(
                            [
                                "act-360",
                                "act-365f",
                                "act-act-isda",
                                "30u-360",
                                "30-360-isda",
                                "30e-360",
                            ]
                        ),
                    },
                ]
            )
            loan = {
                "currency": currency,
                "amount": amount,
                "annualRatePct": rate,
                "repayment": repayment,
                "frequency": frequency,
                "term": {"payments": payments},
                "disbursementDate": random_date(rng),
                "endOfMonth": rng.random() < 0.7,
                "accrual": accrual,
                "rounding": {
                    "interest": rng.choice(["half-up", "half-even", "ceil", "floor"]),
                    "payment": rng.choice(
                        ["minor-half-up", "minor-ceil", "unit-half-up", "unit-ceil"]
                    ),
                },
            }
            if repayment == "balloon":
                loan["balloon"] = {"kind": "percent", "value": str(rng.randint(5, 60))}
            try:
                result = calculate_loan(loan)
            except NearTieError:
                continue  # too close to a rounding boundary: unfit for a vector only
            if not result["ok"]:
                codes = {e["code"] for e in result["errors"]}
                self.assertTrue(codes <= {"NEG_AMORTIZATION", "BALLOON_RANGE"}, (loan, codes))
                continue
            checked += 1
            rows = result["rows"]
            self.assertLessEqual(len(rows), payments)
            if len(rows) < payments:
                self.assertIn("EARLY_CLOSE", [w["code"] for w in result["warnings"]])
            if repayment == "annuity" and accrual == {"mode": "periodic"} and Fraction(rate) != 0:
                # Closed-form float check of the instalment before payment rounding.
                i = (
                    float(Fraction(rate) / 100)
                    / {
                        "weekly": 52,
                        "biweekly": 26,
                        "monthly": 12,
                        "quarterly": 4,
                        "semiannual": 2,
                        "annual": 1,
                    }[frequency]
                )
                exact = float(Fraction(amount)) * i / (1 - (1 + i) ** -payments)
                step = 1.0 if loan["rounding"]["payment"].startswith("unit") else 10.0**-digits
                self.assertLessEqual(
                    abs(float(result["summary"]["regularInstalment"]) - exact), step + 1e-6 * exact
                )
            for row in rows[:-1]:
                if repayment == "annuity" and len(rows) == payments:
                    self.assertEqual(
                        Fraction(row["principal"]) + Fraction(row["interestPaid"]),
                        Fraction(result["summary"]["regularInstalment"]),
                        "I8",
                    )
        self.assertGreater(checked, 200)


if __name__ == "__main__":
    unittest.main()
