# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mortlake
"""LoanLogic reference implementation (deliverable R1).

An independent implementation of docs/SPEC-finance.md used to generate the golden test
vectors in tests/vectors. It shares no code with src/engine and uses only the Python
standard library.
"""

from .engine import calculate_loan

__all__ = ["calculate_loan"]
