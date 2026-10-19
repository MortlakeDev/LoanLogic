# Reference implementation (`tools/reference`)

An independent implementation of [`docs/SPEC-finance.md`](../../docs/SPEC-finance.md) that
generates the golden test vectors in [`tests/vectors`](../../tests/vectors). It is written
and maintained by the architect (deliverable **R1**, see [`docs/PLAN.md`](../../docs/PLAN.md)
§7) and is deliberately separate from `src/engine`: the engine is checked against an
implementation it shares no code, language or numeric library with.

Status: **R1 delivered** — SPEC v0.2 §1–§6, §8–§10, §13–§15 (the M1 scope of T02),
revised after three independent reviews that recomputed the vectors with their own
code.

## Why it can be trusted

- **Exact ledger.** Every ledger value is an exact rational (`fractions.Fraction`) rounded
  once at a posting point. Irrational intermediates (fractional compounding powers,
  continuous compounding) use `decimal.Decimal` with 120 significant digits.
- **Guards instead of luck.** An approximated value closer than 10^−15 minor units to a
  rounding boundary, or a rate closer than ten comparison tolerances
  (`10 × max(1e−7 pp, 1e−9 × |rate|)`) to a display boundary, raises `NearTieError`:
  such inputs are never turned into vectors (SPEC §1.6, §9.4).
- **High-precision rates.** IRR, XIRR, APR and APRC are solved with 80-digit decimals
  (safeguarded Newton inside a sign-changing bracket, width 1e−45), with the sign-change
  rules and the root enumeration grid of SPEC §10.
- **Self-checks.** `test_reference.py` checks the SPEC worked examples (E1–E7), the
  PBOC examples, the ISDA ACT/ACT example, the Microsoft Excel XIRR example, the Reg Z
  single-payment rule, the CCD2/MCOB backward counting, the validation phases and field
  paths of SPEC §13, the design concept figures, closed-form float formulas, and the
  ledger invariants I1–I9 on randomly generated loans. The invariants are also asserted
  on every schedule the reference builds.

## Layout

| Path                        | Content                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `loanlogic_ref/numbers.py`  | exact parsing, rounding modes, boundary guards, formatting                |
| `loanlogic_ref/currency.py` | ISO 4217 minor units (List One, 2026-09-17)                               |
| `loanlogic_ref/dates.py`    | calendar dates, end-of-month rule, frequencies, schedule dates            |
| `loanlogic_ref/daycount.py` | exact year fractions for the six day-count methods                        |
| `loanlogic_ref/engine.py`   | validation, schedules, fees, summary, invariants                          |
| `loanlogic_ref/rates.py`    | cash flows, solvers, time measurement and all rate metrics                |
| `cases.py`                  | the inputs of the core vectors, with descriptions and sources             |
| `generate.py`               | writes `tests/vectors/core/*.json` and its index; `--check` verifies them |
| `test_reference.py`         | self-tests                                                                |

## Usage

Python 3.10 or newer, standard library only:

```sh
python tools/reference/generate.py          # regenerate tests/vectors/core
python tools/reference/generate.py --check  # fail if a vector is missing or stale
python -m unittest discover -s tools/reference -p "test_*.py"
```

Generation takes about 10 seconds; the self-tests about 20 seconds. Run them with
`python -B` (or `PYTHONDONTWRITEBYTECODE=1`) to keep `__pycache__` out of the tree; the
repository ignores it anyway.

## Rules

- Vectors are generated, never edited by hand. To add one, add a case to `cases.py`,
  run `generate.py` and commit the case together with the JSON.
- A SPEC change is made here first: update the reference, regenerate the vectors, then
  the engine follows in its task. The reference never reads `src/`.
- The reference is a test oracle, not product code: it favors obviousness over speed.
